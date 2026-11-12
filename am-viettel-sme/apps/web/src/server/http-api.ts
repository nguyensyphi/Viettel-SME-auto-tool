import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import {
  ApiAuthError,
  canReadAudit,
  formatSessionCookie,
  clearSessionCookie,
  requireRole,
  type HttpAuthGuard,
  type AuthPrincipal,
  type AuthRole,
  type LocalAuthService,
} from "@am-sme/auth";
import type {
  CreateLeadInput,
  LeadWorkspaceRepository as LeadRepository,
} from "@am-sme/database/lead-workspace";
import type { TaskRepository as TasksRepository } from "@am-sme/database/tasks";
import type { DeduplicationLead } from "@am-sme/excel-import";
import {
  classifyCustomerLead,
  matchProductsForCustomer,
  computeLeadScore,
} from "@am-sme/domain";
import type { GoogleConnectionRepository } from "@am-sme/database/google-connections";
import type { ContentLibraryRepository } from "@am-sme/database/content-library";
import {
  TopicClassifier,
  parseStructuredPosts,
  validateMediaCandidate,
  rankAndMatchMedia,
  validateContentForPublishing,
  preparePlatformContent,
  evaluatePublishingSchedule,
  type GoogleOAuthService,
  type GoogleDriveConnector,
  type GoogleDocsSyncService,
  type PublishPlatform,
  type MediaAssetStatus,
  type SocialAccountStatus,
} from "@am-sme/content-library";
import type { InMemoryImportApi } from "./import-api.js";
import { WorkspaceOperationsHub } from "./operations-hub.js";

export interface SqlPort {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, values?: readonly unknown[]): Promise<void>;
  transaction<T>(work: (transaction: SqlPort) => Promise<T>): Promise<T>;
}

export interface ApiServices {
  readonly auth: LocalAuthService;
  readonly guard: HttpAuthGuard;
  readonly leads: LeadRepository;
  readonly tasks: TasksRepository;
  readonly imports: InMemoryImportApi;
  readonly db: SqlPort;
  readonly operations?: WorkspaceOperationsHub | undefined;
  readonly googleConnections?: GoogleConnectionRepository | undefined;
  readonly googleOAuth?: GoogleOAuthService | undefined;
  readonly googleDrive?: GoogleDriveConnector | undefined;
  readonly contentLibrary?: ContentLibraryRepository | undefined;
  readonly googleDocsSync?: GoogleDocsSyncService | undefined;
  readonly sessionCookie: {
    readonly secure: boolean;
    readonly maxAgeSeconds: number;
  };
}

const fallbackOperationsByServices = new WeakMap<
  ApiServices,
  WorkspaceOperationsHub
>();

function operationsFor(services: ApiServices): WorkspaceOperationsHub {
  if (services.operations) return services.operations;
  let hub = fallbackOperationsByServices.get(services);
  if (!hub) {
    hub = new WorkspaceOperationsHub();
    fallbackOperationsByServices.set(services, hub);
  }
  return hub;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const roles: readonly AuthRole[] = ["AM", "MANAGER", "ADMIN"];
const stages = [
  "PENDING_REVIEW",
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "MEETING_SET",
  "PROPOSAL",
  "WON",
  "LOST",
] as const;
const contactabilityStatuses = [
  "UNKNOWN",
  "REVIEW_REQUIRED",
  "ALLOWED_FOR_RECORDED_PURPOSE",
  "OPTED_OUT",
  "SUPPRESSED",
] as const;
const taskStatuses = [
  "OPEN",
  "IN_PROGRESS",
  "DONE",
  "DEFERRED",
  "CANCELLED",
] as const;

function response(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });
}

function csvCell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^[\s]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ].join("\r\n");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("INVALID_REQUEST");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code = "INVALID_REQUEST"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("INVALID_REQUEST");
  return value;
}

function safeError(error: unknown): { status: number; code: string } {
  if (error instanceof ApiAuthError)
    return { status: error.statusCode, code: error.code };
  const rawMessage = error instanceof Error ? error.message : "";
  const prefixCode = rawMessage.split(":")[0]?.trim() ?? "";
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : /^[A-Z][A-Z0-9_]{1,79}$/u.test(rawMessage)
        ? rawMessage
        : /^[A-Z][A-Z0-9_]{1,79}$/u.test(prefixCode)
          ? prefixCode
          : "INTERNAL_ERROR";
  const status =
    code === "UNAUTHENTICATED"
      ? 401
      : code === "FORBIDDEN"
        ? 403
        : code.includes("NOT_FOUND")
          ? 404
          : code.startsWith("DUPLICATE_") ||
              code.includes("ALREADY_") ||
              [
                "CONTACT_TASK_BLOCKED",
                "INVALID_STAGE_TRANSITION",
                "LOCKED_BLOCK_CONFLICT",
                "DUPLICATE_FILE_CHECKSUM",
                "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_FILE",
              ].includes(code)
            ? 409
            : code === "INTERNAL_ERROR"
              ? 500
              : 400;
  return { status, code };
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const r = new URL(request.url);
    if (o.origin === r.origin) return true;
    const loopbacks = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (
      loopbacks.has(o.hostname) &&
      loopbacks.has(r.hostname) &&
      o.port === r.port &&
      o.protocol === r.protocol
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function sessionToken(
  cookieHeader: string | null,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return null;
  try {
    return decodeURIComponent(matches[0]!.slice(cookieName.length + 1));
  } catch {
    return null;
  }
}

function principalDto(principal: AuthPrincipal): AuthPrincipal {
  return {
    userId: principal.userId,
    workspaceId: principal.workspaceId,
    role: principal.role,
    teamId: principal.teamId,
  };
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") throw new Error("JSON_REQUIRED");
  return record(await request.json());
}

async function multipartFile(request: Request): Promise<File | null> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data")
  )
    throw new Error("MULTIPART_REQUIRED");
  const length = request.headers.get("content-length");
  if (length && Number(length) > 5 * 1024 * 1024 + 64 * 1024)
    throw new Error("FILE_TOO_LARGE");
  const form = await request.formData();
  if ([...form.keys()].some((key) => key !== "file"))
    throw new Error("UNKNOWN_FIELD");
  const file = form.get("file");
  return file instanceof File ? file : null;
}

function optionalDateInput(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_DATE");
  return date;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function assertFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("UNKNOWN_FIELD");
}

function routeParams(path: readonly string[]): {
  area: string;
  rest: string[];
} {
  const segments = [...path];
  if (segments[0] === "api") segments.shift();
  if (segments[0] === "v1") segments.shift();
  return { area: segments.shift() ?? "", rest: segments };
}

function listFilters(url: URL): {
  limit: number;
  offset: number;
  search?: string;
  stage?: (typeof stages)[number];
  contactabilityStatus?: (typeof contactabilityStatuses)[number];
  ownerUserId?: string;
} {
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const offsetRaw = Number(url.searchParams.get("offset") ?? "0");
  if (
    !Number.isSafeInteger(limitRaw) ||
    limitRaw < 1 ||
    limitRaw > 100 ||
    !Number.isSafeInteger(offsetRaw) ||
    offsetRaw < 0
  )
    throw new Error("INVALID_PAGINATION");
  const stage = url.searchParams.get("stage") ?? undefined;
  if (stage && !stages.includes(stage as (typeof stages)[number]))
    throw new Error("INVALID_STAGE");
  const contactabilityStatus =
    url.searchParams.get("contactabilityStatus") ?? undefined;
  if (
    contactabilityStatus &&
    !contactabilityStatuses.includes(
      contactabilityStatus as (typeof contactabilityStatuses)[number],
    )
  )
    throw new Error("INVALID_CONTACTABILITY_STATUS");
  const search = url.searchParams.get("search") ?? undefined;
  return {
    limit: limitRaw,
    offset: offsetRaw,
    ...(search ? { search } : {}),
    ...(stage ? { stage: stage as (typeof stages)[number] } : {}),
    ...(contactabilityStatus
      ? {
          contactabilityStatus:
            contactabilityStatus as (typeof contactabilityStatuses)[number],
        }
      : {}),
    ...(url.searchParams.get("ownerUserId")
      ? { ownerUserId: url.searchParams.get("ownerUserId")! }
      : {}),
  };
}

async function loadImportCandidates(
  db: SqlPort,
  principal: AuthPrincipal,
): Promise<readonly (DeduplicationLead & { readonly id: string })[]> {
  const sql = `SELECT l."id", l."companyName", l."district", c."contactName", c."phoneNormalized", c."emailNormalized", COALESCE(cons."consentStatus", 'UNKNOWN') AS "consentStatus", CASE WHEN COALESCE(supp."hasSuppression", false) THEN 'SUPPRESSED' ELSE COALESCE(c."contactabilityStatus", 'UNKNOWN') END AS "contactabilityStatus", COALESCE(cons."evidenceReferences", ARRAY[]::text[]) AS "consentEvidenceReferences", CASE WHEN COALESCE(supp."hasOptOut", false) THEN '[{"required":true,"reason":"OPT_OUT","scope":"ALL_CHANNELS"}]'::jsonb ELSE '[]'::jsonb END AS "suppressionInstructions" FROM "Lead" l LEFT JOIN "TeamMembership" owner_tm ON owner_tm."workspaceId" = l."workspaceId" AND owner_tm."userId" = l."ownerUserId" LEFT JOIN LATERAL (SELECT lc."contactName", lc."phoneNormalized", lc."emailNormalized", lc."contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" lc WHERE lc."workspaceId" = l."workspaceId" AND lc."leadId" = l."id" ORDER BY lc."createdAt", lc."id" LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT CASE WHEN bool_or(cr."status" = 'OPTED_OUT') THEN 'OPTED_OUT' WHEN bool_or(cr."status" = 'REVIEW_REQUIRED') THEN 'REVIEW_REQUIRED' WHEN bool_or(cr."status" = 'UNKNOWN') THEN 'UNKNOWN' WHEN bool_or(cr."status" = 'ALLOWED_FOR_RECORDED_PURPOSE') THEN 'ALLOWED_FOR_RECORDED_PURPOSE' ELSE 'UNKNOWN' END AS "consentStatus", array_remove(array_agg(cr."evidenceReference"), NULL) AS "evidenceReferences" FROM "ConsentRecord" cr WHERE cr."workspaceId" = l."workspaceId" AND cr."leadContactId" = (SELECT lc2."id" FROM "LeadContact" lc2 WHERE lc2."workspaceId" = l."workspaceId" AND lc2."leadId" = l."id" ORDER BY lc2."createdAt", lc2."id" LIMIT 1)) cons ON true LEFT JOIN LATERAL (SELECT bool_or(sr."reason" = 'OPT_OUT') AS "hasOptOut", count(*) > 0 AS "hasSuppression" FROM "SuppressionRecord" sr JOIN "LeadContact" slc ON slc."workspaceId" = sr."workspaceId" AND slc."id" = sr."leadContactId" WHERE sr."workspaceId" = l."workspaceId" AND slc."leadId" = l."id") supp ON true WHERE l."workspaceId" = $1 AND (($2 = 'ADMIN') OR ($2 = 'AM' AND l."ownerUserId" = $3) OR ($2 = 'MANAGER' AND $4::uuid IS NOT NULL AND owner_tm."teamId" = $4))`;
  const rows = await db.query<Record<string, unknown>>(sql, [
    principal.workspaceId,
    principal.role,
    principal.userId,
    principal.teamId,
  ]);
  return rows.map((row) => ({
    id: String(row.id),
    companyName: String(row.companyName),
    contactName: typeof row.contactName === "string" ? row.contactName : null,
    district: typeof row.district === "string" ? row.district : null,
    phoneNormalized:
      typeof row.phoneNormalized === "string" ? row.phoneNormalized : null,
    emailNormalized:
      typeof row.emailNormalized === "string" ? row.emailNormalized : null,
    consentStatus: String(
      row.consentStatus,
    ) as DeduplicationLead["consentStatus"],
    contactabilityStatus: String(
      row.contactabilityStatus,
    ) as DeduplicationLead["contactabilityStatus"],
    consentEvidenceReferences: Array.isArray(row.consentEvidenceReferences)
      ? row.consentEvidenceReferences.map(String)
      : [],
    auditEvidenceReferences: [],
    suppressionInstructions: Array.isArray(row.suppressionInstructions)
      ? (row.suppressionInstructions as NonNullable<
          DeduplicationLead["suppressionInstructions"]
        >)
      : [],
  }));
}

function importResponse(
  result: {
    readonly success: boolean;
    readonly value?: unknown;
    readonly errorCode?: string;
    readonly rowNumber?: number;
  },
  status = 200,
): Response {
  return result.success
    ? response(result.value, status)
    : response(
        {
          error: result.errorCode,
          ...(result.rowNumber === undefined
            ? {}
            : { rowNumber: result.rowNumber }),
        },
        result.errorCode === "IMPORT_NOT_FOUND"
          ? 404
          : result.errorCode === "PREVIEW_EXPIRED"
            ? 410
            : result.errorCode === "ACTIVE_IMPORT_LIMIT_REACHED"
              ? 429
              : 400,
      );
}

export async function handleApiRequest(
  request: Request,
  path: readonly string[],
  services: ApiServices,
): Promise<Response> {
  try {
    const { area, rest } = routeParams(path);
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (area === "auth" && rest[0] === "login" && method === "POST") {
      if (!sameOrigin(request))
        return response({ error: "CSRF_ORIGIN_REJECTED" }, 403);
      const body = await jsonBody(request);
      assertFields(body, ["workspaceId", "email", "password"]);
      const result = await services.auth.authenticatePassword({
        workspaceId: requiredString(body.workspaceId),
        email: requiredString(body.email),
        password: requiredString(body.password),
      });
      if (!result) return response({ error: "INVALID_CREDENTIALS" }, 401);
      const cookie = formatSessionCookie(
        result.sessionToken,
        services.sessionCookie,
      );
      return response({ user: principalDto(result.principal) }, 200, {
        "set-cookie": cookie,
      });
    }

    if (
      area === "auth" &&
      rest[0] === "invitations" &&
      rest[1] === "accept" &&
      method === "POST"
    ) {
      if (!sameOrigin(request))
        return response({ error: "CSRF_ORIGIN_REJECTED" }, 403);
      const body = await jsonBody(request);
      assertFields(body, ["token", "password", "displayName"]);
      const principal = await services.auth.acceptInvitation({
        token: requiredString(body.token),
        password: requiredString(body.password),
        displayName: requiredString(body.displayName),
      });
      return response({ user: principalDto(principal) }, 201);
    }

    if (area === "auth" && rest[0] === "logout" && method === "POST") {
      if (!sameOrigin(request))
        return response({ error: "CSRF_ORIGIN_REJECTED" }, 403);
      const cookieName = services.sessionCookie.secure
        ? "__Host-am_sme_session"
        : "am_sme_session";
      const token = sessionToken(request.headers.get("cookie"), cookieName);
      if (token) await services.auth.revokeSession(token);
      return response({ ok: true }, 200, {
        "set-cookie": clearSessionCookie(services.sessionCookie.secure),
      });
    }

    if (method !== "GET" && method !== "HEAD" && !sameOrigin(request)) {
      return response({ error: "CSRF_ORIGIN_REJECTED" }, 403);
    }

    const principal = await services.guard.authenticate({
      headers: {
        ...(request.headers.get("cookie")
          ? { cookie: request.headers.get("cookie")! }
          : {}),
      },
    });

    if (area === "auth" && rest[0] === "me" && method === "GET")
      return response({ user: principalDto(principal) });

    if (area === "leads" && rest.length === 0 && method === "GET") {
      const result = await services.leads.listLeads(principal, listFilters(url));
      const enrichedItems = result.items.map((lead) => ({
        ...lead,
        leadScore: computeLeadScore({
          taxCode: (lead as { taxCode?: string }).taxCode ?? "",
          companyName: lead.companyName,
          ...(lead.industry ? { industry: lead.industry } : {}),
          hasPhone: Boolean(lead.contacts && lead.contacts.some((c) => c.phone)),
          hasEmail: Boolean(lead.contacts && lead.contacts.some((c) => c.email)),
        }),
      }));
      return response({
        ...result,
        items: enrichedItems,
      });
    }
    if (area === "leads" && rest[0] === "evaluate-score" && rest.length === 1 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, [
        "taxCode",
        "companyName",
        "establishedYear",
        "industry",
        "employeeCount",
        "hasPhone",
        "hasEmail",
        "hasWebsite",
        "recentBusinessSignals",
      ]);
      const score = computeLeadScore({
        taxCode: String(body.taxCode || ""),
        companyName: requiredString(body.companyName),
        ...(typeof body.establishedYear === "number" ? { establishedYear: body.establishedYear } : {}),
        ...(typeof body.industry === "string" ? { industry: body.industry } : {}),
        ...(typeof body.employeeCount === "number" ? { employeeCount: body.employeeCount } : {}),
        hasPhone: Boolean(body.hasPhone),
        hasEmail: Boolean(body.hasEmail),
        ...(typeof body.hasWebsite === "boolean" ? { hasWebsite: body.hasWebsite } : {}),
        ...(Array.isArray(body.recentBusinessSignals)
          ? { recentBusinessSignals: body.recentBusinessSignals.map(String) }
          : {}),
      });
      return response(score);
    }
    if (area === "leads" && rest.length === 0 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, [
        "companyName",
        "industry",
        "district",
        "province",
        "website",
        "businessAddress",
        "ownerUserId",
        "contact",
        "source",
      ]);
      let contact: CreateLeadInput["contact"];
      if (body.contact !== undefined && body.contact !== null) {
        const value = record(body.contact);
        assertFields(value, [
          "contactName",
          "jobTitle",
          "phoneNormalized",
          "emailNormalized",
        ]);
        const contactName = optionalString(value.contactName);
        const jobTitle = optionalString(value.jobTitle);
        const phoneNormalized = optionalString(value.phoneNormalized);
        const emailNormalized = optionalString(value.emailNormalized);
        contact = {
          ...(contactName === undefined ? {} : { contactName }),
          ...(jobTitle === undefined ? {} : { jobTitle }),
          ...(phoneNormalized === undefined ? {} : { phoneNormalized }),
          ...(emailNormalized === undefined ? {} : { emailNormalized }),
        };
      }
      let source: CreateLeadInput["source"];
      if (body.source !== undefined && body.source !== null) {
        const value = record(body.source);
        assertFields(value, [
          "sourceType",
          "sourceLabel",
          "sourceUrl",
          "contactBasis",
          "collectedAt",
        ]);
        const sourceLabel = optionalString(value.sourceLabel);
        const sourceUrl = optionalString(value.sourceUrl);
        const collectedAt = optionalDateInput(
          optionalString(value.collectedAt),
        );
        source = {
          leadId: "",
          sourceType: requiredString(value.sourceType) as never,
          contactBasis: requiredString(value.contactBasis) as never,
          ...(sourceLabel === undefined ? {} : { sourceLabel }),
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
          ...(collectedAt === undefined ? {} : { collectedAt }),
        };
      }
      const industry = optionalString(body.industry);
      const district = optionalString(body.district);
      const province = optionalString(body.province);
      const website = optionalString(body.website);
      const businessAddress = optionalString(body.businessAddress);
      const ownerUserId = optionalString(body.ownerUserId);
      const created = await services.leads.createLead(principal, {
        companyName: requiredString(body.companyName),
        ...(industry === undefined ? {} : { industry }),
        ...(district === undefined ? {} : { district }),
        ...(province === undefined ? {} : { province }),
        ...(website === undefined ? {} : { website }),
        ...(businessAddress === undefined ? {} : { businessAddress }),
        ...(ownerUserId === undefined ? {} : { ownerUserId }),
        ...(contact === undefined ? {} : { contact }),
        ...(source === undefined ? {} : { source }),
      });
      return response(created, 201);
    }
    if (area === "leads" && rest[0] && rest.length === 1 && method === "GET") {
      const detail = await services.leads.getLeadDetail(principal, rest[0]);
      await services.db.execute(
        'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "changedFieldNames") VALUES ($1,$2,$3,$4,\'LEAD_VIEWED\',\'Lead\',$5,ARRAY[]::text[])',
        [
          randomUUID(),
          principal.workspaceId,
          principal.userId,
          principal.role,
          rest[0],
        ],
      );
      let classification: unknown = undefined;
      let productMatches: unknown = undefined;
      let leadScore: unknown = undefined;
      if (detail.companyName) {
        const cls = classifyCustomerLead({
          taxCode: (detail as { taxCode?: string }).taxCode ?? "",
          businessName: detail.companyName,
          ...(detail.industry ? { industry: detail.industry } : {}),
          isNewlyEstablished: true,
        });
        classification = cls;
        productMatches = matchProductsForCustomer({
          segment: cls.segment,
        });
        leadScore = computeLeadScore({
          taxCode: (detail as { taxCode?: string }).taxCode ?? "",
          companyName: detail.companyName,
          ...(detail.industry ? { industry: detail.industry } : {}),
          hasPhone: Boolean(detail.contacts && detail.contacts.some((c) => c.phone)),
          hasEmail: Boolean(detail.contacts && detail.contacts.some((c) => c.email)),
          hasWebsite: Boolean(detail.website),
        });
      }
      return response({
        ...detail,
        ...(classification ? { classification, productMatches, leadScore } : {}),
      });
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest.length === 1 &&
      method === "PATCH"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "companyName",
        "industry",
        "district",
        "province",
        "website",
        "businessAddress",
        "contact",
      ]);
      await services.leads.updateLead(principal, rest[0], body);
      return response({ ok: true });
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest[1] === "stage" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["stage"]);
      await services.leads.transitionStage(
        principal,
        rest[0],
        requiredString(body.stage) as never,
      );
      return response({ ok: true });
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest[1] === "assign" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["ownerUserId"]);
      await services.leads.assignLead(
        principal,
        rest[0],
        requiredString(body.ownerUserId),
      );
      return response({ ok: true });
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest[1] === "notes" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["content"]);
      return response(
        await services.leads.addNote(
          principal,
          rest[0],
          requiredString(body.content),
        ),
        201,
      );
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest[1] === "notes" &&
      rest[2] &&
      method === "PATCH"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["content"]);
      await services.leads.updateNote(
        principal,
        rest[0],
        rest[2],
        requiredString(body.content),
      );
      return response({ ok: true });
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest[1] === "contactability" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "contactId",
        "status",
        "channel",
        "purpose",
        "evidenceReference",
        "capturedAt",
      ]);
      const evidenceReference = optionalString(body.evidenceReference);
      const capturedAt = optionalDateInput(optionalString(body.capturedAt));
      await services.leads.reviewContactability(principal, {
        leadId: rest[0],
        contactId: requiredString(body.contactId),
        status: requiredString(body.status) as never,
        channel: requiredString(body.channel) as never,
        purpose: requiredString(body.purpose),
        ...(evidenceReference === undefined ? {} : { evidenceReference }),
        ...(capturedAt === undefined ? {} : { capturedAt }),
      });
      return response({ ok: true });
    }
    if (
      area === "leads" &&
      rest[0] &&
      rest[1] === "suppressions" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["contactId", "reason"]);
      await services.leads.suppressContact(principal, {
        leadId: rest[0],
        contactId: requiredString(body.contactId),
        reason: requiredString(body.reason) as never,
      });
      return response({ ok: true }, 201);
    }

    if (area === "import-template" && method === "GET") {
      const templatePath = nodePath.resolve(
        process.cwd(),
        "storage/DNMTL_T7_2026_Standard_Template.xlsx",
      );
      if (fs.existsSync(templatePath)) {
        const fileBytes = fs.readFileSync(templatePath);
        return new Response(fileBytes, {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition":
              'attachment; filename="DNMTL_T7_2026_Standard_Template.xlsx"',
          },
        });
      }
      return response({ error: "TEMPLATE_NOT_FOUND" }, 404);
    }

    if (area === "import-jobs" && rest.length === 0 && method === "POST") {
      const file = await multipartFile(request);
      if (!file) return response({ error: "FILE_REQUIRED" }, 400);
      if (file.size > 5 * 1024 * 1024)
        return response({ error: "FILE_TOO_LARGE" }, 413);
      const result = services.imports.upload({
        actor: principal,
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return importResponse(result, 201);
    }
    if (
      area === "import-jobs" &&
      rest[0] &&
      rest.length === 1 &&
      method === "GET"
    ) {
      const active = services.imports.get(principal, rest[0]);
      if (
        active.success ||
        active.errorCode !== "IMPORT_NOT_FOUND" ||
        !isUuid(rest[0])
      )
        return importResponse(active);
      const rows = await services.db.query<Record<string, unknown>>(
        'SELECT j."id", j."status"::text AS "status", j."totalRows", j."validRows", j."invalidRows", j."duplicateRows", j."failureReasonCode", j."createdAt", j."updatedAt", j."completedAt" FROM "ImportJob" j WHERE j."workspaceId" = $1 AND j."id" = $2::uuid AND (($3 = \'ADMIN\') OR ($3 = \'AM\' AND j."uploaderUserId" = $4) OR ($3 = \'MANAGER\' AND $5::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM "TeamMembership" tm WHERE tm."workspaceId" = j."workspaceId" AND tm."userId" = j."uploaderUserId" AND tm."teamId" = $5)))',
        [
          principal.workspaceId,
          rest[0],
          principal.role,
          principal.userId,
          principal.teamId,
        ],
      );
      return rows[0] ? response(rows[0]) : importResponse(active);
    }
    if (
      area === "import-jobs" &&
      rest[0] &&
      rest[1] === "mapping" &&
      method === "PUT"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["mapping"]);
      if (!Array.isArray(body.mapping))
        throw new Error("HEADER_MAPPING_INVALID");
      for (const item of body.mapping)
        assertFields(record(item), ["sourceColumnIndex", "targetField"]);
      return importResponse(
        services.imports.setMapping(principal, rest[0], body.mapping as never),
      );
    }
    if (
      area === "import-jobs" &&
      rest[0] &&
      rest[1] === "validate" &&
      method === "POST"
    ) {
      const file = await multipartFile(request);
      if (!file) return response({ error: "FILE_REQUIRED" }, 400);
      if (file.size > 5 * 1024 * 1024)
        return response({ error: "FILE_TOO_LARGE" }, 413);
      const candidates = await loadImportCandidates(services.db, principal);
      const result = services.imports.validate({
        actor: principal,
        handle: rest[0],
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        existingLeads: candidates,
      });
      return importResponse(result);
    }
    if (
      area === "import-jobs" &&
      rest[0] &&
      rest[1] === "approve" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["decisions", "confirmIgnoredColumns"]);
      if (!Array.isArray(body.decisions))
        throw new Error("REVIEW_DECISION_REQUIRED");
      for (const item of body.decisions)
        assertFields(record(item), ["rowNumber", "action", "targetLeadId"]);
      if (
        body.confirmIgnoredColumns !== undefined &&
        typeof body.confirmIgnoredColumns !== "boolean"
      )
        throw new Error("INVALID_REQUEST");
      return importResponse(
        services.imports.approve({
          actor: principal,
          handle: rest[0],
          decisions: body.decisions as never,
          ...(body.confirmIgnoredColumns === undefined
            ? {}
            : { confirmIgnoredColumns: body.confirmIgnoredColumns === true }),
        }),
      );
    }
    if (
      area === "import-jobs" &&
      rest[0] &&
      rest[1] === "commit" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["idempotencyKey"]);
      const result = await services.imports.commit({
        actor: principal,
        handle: rest[0],
        idempotencyKey: requiredString(body.idempotencyKey),
      });
      return importResponse(result);
    }

    if (area === "tasks" && rest.length === 0 && method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      if (
        status &&
        !taskStatuses.includes(status as (typeof taskStatuses)[number])
      )
        throw new Error("INVALID_TASK_STATUS");
      const assigneeUserId =
        url.searchParams.get("assigneeUserId") ?? undefined;
      return response(
        await services.tasks.listTasks(principal, {
          ...(status
            ? { status: status as (typeof taskStatuses)[number] }
            : {}),
          ...(assigneeUserId ? { assigneeUserId } : {}),
        }),
      );
    }
    if (area === "tasks" && rest.length === 0 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, [
        "assigneeUserId",
        "type",
        "leadId",
        "leadContactId",
        "contactChannel",
        "outcomeGoal",
        "estimatedMinutes",
        "dueAt",
        "priorityReason",
        "nextAction",
      ]);
      const leadId = optionalString(body.leadId);
      const leadContactId = optionalString(body.leadContactId);
      const contactChannel = optionalString(body.contactChannel);
      const nextAction = optionalString(body.nextAction);
      const dueAt = new Date(requiredString(body.dueAt));
      if (!Number.isFinite(dueAt.getTime())) throw new Error("INVALID_DATE");
      return response(
        await services.tasks.createTask(principal, {
          assigneeUserId: requiredString(body.assigneeUserId),
          type: requiredString(body.type) as never,
          ...(leadId === undefined ? {} : { leadId }),
          ...(leadContactId === undefined ? {} : { leadContactId }),
          ...(contactChannel === undefined
            ? {}
            : { contactChannel: contactChannel as never }),
          outcomeGoal: requiredString(body.outcomeGoal),
          estimatedMinutes: Number(body.estimatedMinutes),
          dueAt,
          priorityReason: requiredString(body.priorityReason),
          ...(nextAction === undefined ? {} : { nextAction }),
        }),
        201,
      );
    }
    if (area === "tasks" && rest.length === 0 && method === "PATCH") {
      const body = await jsonBody(request);
      assertFields(body, ["taskId", "action", "assigneeUserId", "reason"]);
      const taskId = requiredString(body.taskId);
      const action = requiredString(body.action);
      if (action === "assign")
        return response(
          await services.tasks.assignTask(
            principal,
            taskId,
            requiredString(body.assigneeUserId),
          ),
        );
      if (action === "approveContact")
        return response(
          await services.tasks.approveProposedContactTask(principal, taskId),
        );
      if (action === "cancel")
        return response(
          await services.tasks.cancelTask(
            principal,
            taskId,
            requiredString(body.reason),
          ),
        );
      throw new Error("INVALID_TASK_ACTION");
    }
    if (
      area === "tasks" &&
      rest[0] &&
      rest[1] === "complete" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["outcome", "nextAction"]);
      const nextAction = optionalString(body.nextAction);
      return response(
        await services.tasks.completeTask(principal, rest[0], {
          outcome: requiredString(body.outcome),
          ...(nextAction === undefined ? {} : { nextAction }),
        }),
      );
    }
    if (
      area === "tasks" &&
      rest[0] &&
      rest[1] === "defer" &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["reason", "proposedNextTask"]);
      return response(
        await services.tasks.deferTask(principal, rest[0], {
          reason: requiredString(body.reason),
          ...(body.proposedNextTask === undefined
            ? {}
            : { proposedNextTask: body.proposedNextTask as never }),
        }),
      );
    }
    if (area === "planner" && rest[0] === "today" && method === "GET") {
      const day = requiredString(url.searchParams.get("day"));
      const windowStart = requiredString(url.searchParams.get("windowStart"));
      const windowEnd = requiredString(url.searchParams.get("windowEnd"));
      return response(
        await services.tasks.getDailyPlan(principal, {
          day,
          windowStart,
          windowEnd,
        }),
      );
    }
    if (
      area === "locked-time-blocks" &&
      rest.length === 0 &&
      method === "GET"
    ) {
      const from = new Date(requiredString(url.searchParams.get("from")));
      const to = new Date(requiredString(url.searchParams.get("to")));
      const userId = url.searchParams.get("userId") ?? undefined;
      return response(
        await services.tasks.listLockedTimeBlocks(principal, {
          from,
          to,
          ...(userId ? { userId } : {}),
        }),
      );
    }
    if (
      area === "locked-time-blocks" &&
      rest.length === 0 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["userId", "startsAt", "endsAt", "label", "reason"]);
      const label = optionalString(body.label);
      const reason = optionalString(body.reason);
      return response(
        await services.tasks.createLockedTimeBlock(principal, {
          userId: requiredString(body.userId),
          startsAt: new Date(requiredString(body.startsAt)),
          endsAt: new Date(requiredString(body.endsAt)),
          ...(label === undefined ? {} : { label }),
          ...(reason === undefined ? {} : { reason }),
        }),
        201,
      );
    }

    if (area === "teams" && rest.length === 0 && method === "GET") {
      requireRole(principal, ["MANAGER", "ADMIN"]);
      const rows =
        principal.role === "ADMIN"
          ? await services.db.query<Record<string, unknown>>(
              'SELECT t."id", t."name", count(tm."userId")::int AS "memberCount" FROM "Team" t LEFT JOIN "TeamMembership" tm ON tm."workspaceId" = t."workspaceId" AND tm."teamId" = t."id" WHERE t."workspaceId" = $1 GROUP BY t."id", t."name" ORDER BY t."name"',
              [principal.workspaceId],
            )
          : await services.db.query<Record<string, unknown>>(
              'SELECT t."id", t."name", count(tm."userId")::int AS "memberCount" FROM "Team" t LEFT JOIN "TeamMembership" tm ON tm."workspaceId" = t."workspaceId" AND tm."teamId" = t."id" WHERE t."workspaceId" = $1 AND t."id" = $2 GROUP BY t."id", t."name" ORDER BY t."name"',
              [principal.workspaceId, principal.teamId],
            );
      return response(rows);
    }
    if (area === "users" && rest.length === 0 && method === "GET") {
      requireRole(principal, ["MANAGER", "ADMIN"]);
      const rows =
        principal.role === "ADMIN"
          ? await services.db.query<Record<string, unknown>>(
              'SELECT u."id", u."displayName", tm."role"::text AS "role", tm."teamId", u."status"::text AS "status" FROM "User" u JOIN "TeamMembership" tm ON tm."workspaceId" = u."workspaceId" AND tm."userId" = u."id" WHERE u."workspaceId" = $1 ORDER BY u."displayName", u."id"',
              [principal.workspaceId],
            )
          : await services.db.query<Record<string, unknown>>(
              'SELECT u."id", u."displayName", tm."role"::text AS "role", tm."teamId", u."status"::text AS "status" FROM "User" u JOIN "TeamMembership" tm ON tm."workspaceId" = u."workspaceId" AND tm."userId" = u."id" WHERE u."workspaceId" = $1 AND tm."teamId" = $2 ORDER BY u."displayName", u."id"',
              [principal.workspaceId, principal.teamId],
            );
      return response(rows);
    }
    if (area === "users" && rest.length === 0 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, ["email", "role", "teamId"]);
      const role = requiredString(body.role);
      if (!roles.includes(role as AuthRole)) throw new Error("INVALID_ROLE");
      const invite = await services.auth.createInvitation(principal, {
        email: requiredString(body.email),
        role: role as AuthRole,
        teamId: optionalString(body.teamId) ?? null,
      });
      return response(
        {
          userId: invite.userId,
          invitationUrl: invite.url,
          expiresAt: invite.expiresAt,
        },
        201,
      );
    }
    if (area === "users" && rest[0] && method === "PATCH") {
      const body = await jsonBody(request);
      assertFields(body, ["role", "teamId"]);
      const role = requiredString(body.role);
      if (!roles.includes(role as AuthRole)) throw new Error("INVALID_ROLE");
      await services.auth.changeMembershipRole(principal, {
        targetUserId: rest[0],
        role: role as AuthRole,
        teamId: optionalString(body.teamId) ?? null,
      });
      return response({ ok: true });
    }

    if (area === "audit-events" && method === "GET") {
      if (!canReadAudit(principal)) throw new ApiAuthError(403, "FORBIDDEN");
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        throw new Error("INVALID_PAGINATION");
      const scopeClause =
        principal.role === "ADMIN"
          ? ""
          : ` AND (a."actorId" = $5 OR (a."entityType" = 'Lead' AND EXISTS (SELECT 1 FROM "Lead" l JOIN "TeamMembership" lm ON lm."workspaceId" = l."workspaceId" AND lm."userId" = l."ownerUserId" WHERE l."workspaceId" = a."workspaceId" AND l."id" = a."entityId" AND lm."teamId" = $4)) OR (a."entityType" = 'Task' AND EXISTS (SELECT 1 FROM "Task" t JOIN "TeamMembership" tm ON tm."workspaceId" = t."workspaceId" AND tm."userId" = t."assigneeUserId" WHERE t."workspaceId" = a."workspaceId" AND t."id" = a."entityId" AND tm."teamId" = $4)))`;
      const isExport = url.searchParams.get("format") === "csv";
      if (isExport) {
        await services.db.execute(
          'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "changedFieldNames") VALUES ($1,$2,$3,$4,\'AUDIT_EXPORTED\',\'AuditEvent\',$5,ARRAY[]::text[])',
          [
            randomUUID(),
            principal.workspaceId,
            principal.userId,
            principal.role,
            principal.workspaceId,
          ],
        );
      }
      const values =
        principal.role === "ADMIN"
          ? [principal.workspaceId, limit, offset]
          : [
              principal.workspaceId,
              limit,
              offset,
              principal.teamId,
              principal.userId,
            ];
      const rows = await services.db.query<Record<string, unknown>>(
        `SELECT a."id", a."actorId", a."actorRole"::text AS "actorRole", a."action", a."entityType", a."entityId", a."changedFieldNames", a."beforeStage"::text AS "beforeStage", a."afterStage"::text AS "afterStage", a."beforeContactabilityStatus"::text AS "beforeContactabilityStatus", a."afterContactabilityStatus"::text AS "afterContactabilityStatus", a."beforeConsentStatus"::text AS "beforeConsentStatus", a."afterConsentStatus"::text AS "afterConsentStatus", a."createdAt" FROM "AuditEvent" a WHERE a."workspaceId" = $1${scopeClause} ORDER BY a."createdAt" DESC, a."id" DESC LIMIT $2 OFFSET $3`,
        values,
      );
      if (isExport)
        return new Response(
          csv(rows, [
            "id",
            "actorId",
            "actorRole",
            "action",
            "entityType",
            "entityId",
            "changedFieldNames",
            "beforeStage",
            "afterStage",
            "beforeContactabilityStatus",
            "afterContactabilityStatus",
            "beforeConsentStatus",
            "afterConsentStatus",
            "createdAt",
          ]),
          {
            status: 200,
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": "attachment; filename=am-sme-audit.csv",
              "cache-control": "no-store",
            },
          },
        );
      return response({ items: rows, limit, offset });
    }

    const operations = operationsFor(services);

    if (area === "social-accounts" && rest.length === 0 && method === "GET") {
      return response({
        items: operations.listSocialAccounts(principal.workspaceId),
      });
    }
    if (
      area === "social-accounts" &&
      rest[0] &&
      rest[1] === "qr-login" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["platform"]);
      const platform = requiredString(body.platform);
      if (platform !== "ZALO" && platform !== "FACEBOOK") {
        throw new Error("INVALID_PLATFORM");
      }
      return response(
        operations.requestQrLogin(
          principal.workspaceId,
          rest[0],
          platform,
          principal.userId,
        ),
      );
    }
    if (
      area === "social-accounts" &&
      rest.length === 0 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["accountId", "platform"]);
      const platform = requiredString(body.platform);
      if (platform !== "ZALO" && platform !== "FACEBOOK") {
        throw new Error("INVALID_PLATFORM");
      }
      return response(
        operations.declareSocialAccount(
          principal.workspaceId,
          {
            accountId: requiredString(body.accountId),
            platform,
          },
          principal.userId,
        ),
        201,
      );
    }
    if (
      area === "social-accounts" &&
      rest[0] &&
      rest[1] === "connect" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["platform"]);
      const platform = requiredString(body.platform);
      if (platform !== "ZALO" && platform !== "FACEBOOK") {
        throw new Error("INVALID_PLATFORM");
      }
      return response(
        operations.connectSocialAccount(
          principal.workspaceId,
          rest[0],
          platform,
          principal.userId,
        ),
      );
    }
    if (
      area === "social-accounts" &&
      rest[0] === "sync-fb-poster" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const accounts = operations.syncFacebookAccountsFromSessions(principal.workspaceId);
      return response({ accounts });
    }
    if (
      area === "social-accounts" &&
      rest[0] === "launch-browser" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["accountId", "platform"]);
      const platform = body.platform === "ZALO" ? "ZALO" : "FACEBOOK";
      const result = operations.launchAccountDesktopBrowser(
        principal.workspaceId,
        requiredString(body.accountId),
        platform,
      );
      return response(result);
    }
    if (
      area === "social-accounts" &&
      rest[0] &&
      rest[1] === "launch-browser" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const result = operations.launchAccountDesktopBrowser(
        principal.workspaceId,
        rest[0],
        "FACEBOOK",
      );
      return response(result);
    }
    if (
      area === "social-accounts" &&
      rest[0] === "declare-and-launch" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["accountName", "platform"]);
      const platform = body.platform === "ZALO" ? "ZALO" : "FACEBOOK";
      const result = operations.declareAndLaunchAccount(
        principal.workspaceId,
        {
          accountName: requiredString(body.accountName),
          platform,
        },
        principal.userId,
      );
      return response(result, 201);
    }
    if (
      area === "social-accounts" &&
      rest[0] &&
      rest[1] === "reset-circuit" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["platform"]);
      const platform = requiredString(body.platform);
      if (platform !== "ZALO" && platform !== "FACEBOOK") {
        throw new Error("INVALID_PLATFORM");
      }
      return response(
        operations.resetAccountCircuit(
          principal.workspaceId,
          rest[0],
          platform,
          principal.userId ?? "user-am",
        ),
      );
    }

    if (area === "ops" && rest[0] === "status" && rest.length === 1 && method === "GET") {
      return response(operations.getOpsStatus(principal.workspaceId));
    }
    if (area === "ops" && rest[0] === "kill-switch" && rest.length === 1 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, ["active", "reason"]);
      const reason = optionalString(body.reason);
      return response(
        operations.setKillSwitch(
          principal.workspaceId,
          Boolean(body.active),
          principal.userId ?? "user-am",
          reason ?? undefined,
        ),
      );
    }

    if (
      area === "publishing-calendar" &&
      rest.length === 0 &&
      method === "GET"
    ) {
      return response({
        items: operations.listCalendarPosts(principal.workspaceId),
      });
    }
    if (
      area === "publishing-calendar" &&
      rest.length === 0 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "contentId",
        "topic",
        "platform",
        "mode",
        "publishTime",
        "content",
      ]);
      const platform = requiredString(body.platform);
      if (platform !== "ZALO" && platform !== "FACEBOOK") {
        throw new Error("INVALID_PLATFORM");
      }
      const mode = requiredString(body.mode);
      if (mode !== "FULL_AUTO" && mode !== "SEMI_AUTO") {
        throw new Error("INVALID_MODE");
      }
      const created = operations.createCalendarDraft(principal.workspaceId, {
        contentId: requiredString(body.contentId),
        topic: requiredString(body.topic),
        platform,
        mode,
        publishTime: requiredString(body.publishTime),
        content: requiredString(body.content),
      });
      return response(created, 201);
    }
    if (
      area === "publishing-calendar" &&
      rest[0] &&
      rest[1] === "approve" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, []);
      const approved = operations.approveCalendarPost(
        principal.workspaceId,
        rest[0],
        principal.userId,
      );
      return response(approved);
    }

    if (
      area === "campaigns-overview" &&
      rest.length === 0 &&
      method === "GET"
    ) {
      return response(operations.getCampaignsOverview(principal.workspaceId));
    }

    if (area === "groups" && rest.length === 0 && method === "GET") {
      const category = url.searchParams.get("category") ?? undefined;
      const platform = url.searchParams.get("platform") ?? undefined;
      const groups = operations.listGroups(principal.workspaceId, {
        ...(category ? { categories: [category as never] } : {}),
        ...(platform ? { platform: platform as never } : {}),
      });
      return response({ groups });
    }
    if (area === "groups" && rest.length === 0 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, [
        "groupId",
        "platform",
        "name",
        "url",
        "postingPermission",
        "category",
        "minHoursBetweenPosts",
        "active",
      ]);
      const created = operations.registerGroup(principal.workspaceId, {
        groupId: requiredString(body.groupId),
        platform: requiredString(body.platform) as never,
        name: requiredString(body.name),
        url: requiredString(body.url),
        postingPermission: requiredString(body.postingPermission) as never,
        ...(typeof body.category === "string"
          ? { category: body.category as never }
          : {}),
        ...(typeof body.minHoursBetweenPosts === "number"
          ? { minHoursBetweenPosts: body.minHoursBetweenPosts }
          : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      });
      return response(created, 201);
    }
    if (
      area === "groups" &&
      rest[0] === "bulk-import" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["urls", "platform"]);
      const urls = Array.isArray(body.urls) ? body.urls.map(String) : [];
      const platform = (optionalString(body.platform) as any) ?? "FACEBOOK";
      const result = operations.bulkRegisterGroups(
        principal.workspaceId,
        urls,
        platform,
      );
      return response(result);
    }

    if (
      area === "groups" &&
      rest[0] &&
      rest[1] === "check-eligibility" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const result = operations.checkGroupEligibility(
        principal.workspaceId,
        rest[0],
      );
      return response(result);
    }

    if (area === "groups" && rest.length === 1 && method === "DELETE") {
      const deleted = operations.deleteGroup(principal.workspaceId, rest[0]!);
      return response({ success: deleted, groupId: rest[0] });
    }

    if (area === "campaigns" && rest.length === 0 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, [
        "campaignId",
        "name",
        "campaignType",
        "targetCategories",
        "contentTemplate",
        "mediaPaths",
      ]);
      const created = operations.createCampaign(principal.workspaceId, {
        campaignId: requiredString(body.campaignId),
        name: requiredString(body.name),
        campaignType: requiredString(body.campaignType) as never,
        targetCategories: Array.isArray(body.targetCategories)
          ? (body.targetCategories as never)
          : [],
        contentTemplate: requiredString(body.contentTemplate),
        ...(Array.isArray(body.mediaPaths)
          ? { mediaPaths: body.mediaPaths.map(String) }
          : {}),
      });
      return response(created, 201);
    }
    if (
      area === "campaigns" &&
      rest[0] &&
      rest[1] === "approve" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const approved = operations.approveCampaign(
        principal.workspaceId,
        rest[0],
        principal.userId ?? "user-am",
      );
      return response(approved);
    }
    if (
      area === "campaigns" &&
      rest[0] === "group-jobs" &&
      rest.length === 1 &&
      method === "GET"
    ) {
      const jobs = operations.listGroupPostingJobs(principal.workspaceId);
      return response({ jobs });
    }
    if (
      area === "campaigns" &&
      rest[0] === "group-jobs" &&
      rest[1] &&
      rest[2] === "run" &&
      rest.length === 3 &&
      method === "POST"
    ) {
      const updated = await operations.executeGroupPostingJob(
        principal.workspaceId,
        rest[1],
      );
      return response(updated);
    }
    if (
      area === "campaigns" &&
      rest[0] &&
      rest[1] === "dispatch" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["accountId", "dispatchDate", "groupIds"]);
      const dispatchDate = optionalDateInput(optionalString(body.dispatchDate));
      const targetGroupIds = Array.isArray(body.groupIds)
        ? body.groupIds.map(String)
        : undefined;
      const dispatched = await operations.dispatchCampaignJobs(
        principal.workspaceId,
        rest[0],
        requiredString(body.accountId),
        dispatchDate ?? new Date(),
        targetGroupIds,
      );
      return response(dispatched);
    }
    if (
      area === "fb-poster" &&
      rest[0] === "dispatch-post" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "accountId",
        "postId",
        "postTitle",
        "content",
        "groupIds",
        "mediaPaths",
        "delaySeconds",
      ]);
      const result = operations.dispatchDirectGroupPost(
        principal.workspaceId,
        {
          accountId: requiredString(body.accountId),
          postTitle: requiredString(body.postTitle),
          content: requiredString(body.content),
          groupIds: Array.isArray(body.groupIds) ? body.groupIds.map(String) : [],
          ...(Array.isArray(body.mediaPaths)
            ? { mediaPaths: body.mediaPaths.map(String) }
            : {}),
        },
      );
      return response(result);
    }
    if (
      area === "fb-poster" &&
      rest[0] === "dispatch-page-post" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "accountId",
        "postId",
        "postTitle",
        "content",
        "targetType",
        "targetUrl",
        "mediaPaths",
        "callToActionUrl",
      ]);
      const result = operations.dispatchPageOrWallPost(
        principal.workspaceId,
        {
          accountId: requiredString(body.accountId),
          postTitle: requiredString(body.postTitle),
          content: requiredString(body.content),
          targetType: (body.targetType === "FANPAGE" ? "FANPAGE" : "PERSONAL_WALL") as any,
          ...(typeof body.targetUrl === "string" ? { targetUrl: body.targetUrl } : {}),
          ...(Array.isArray(body.mediaPaths)
            ? { mediaPaths: body.mediaPaths.map(String) }
            : {}),
          ...(typeof body.callToActionUrl === "string"
            ? { callToActionUrl: body.callToActionUrl }
            : {}),
        },
      );
      return response(result);
    }
    if (
      area === "fb-poster" &&
      rest[0] === "sync-accounts" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const accounts = operations.syncFacebookAccountsFromSessions(principal.workspaceId);
      return response({ accounts });
    }

    if (area === "partners" && rest.length === 0 && method === "GET") {
      return response({ partners: operations.listPartners(principal.workspaceId) });
    }
    if (area === "partners" && rest.length === 0 && method === "POST") {
      const body = await jsonBody(request);
      assertFields(body, [
        "partnerId",
        "fullName",
        "phone",
        "profession",
        "sourceGroupId",
        "notes",
      ]);
      const registered = operations.registerPartner(principal.workspaceId, {
        partnerId: requiredString(body.partnerId),
        fullName: requiredString(body.fullName),
        phone: requiredString(body.phone),
        profession: requiredString(body.profession) as never,
        ...(typeof body.sourceGroupId === "string"
          ? { sourceGroupId: body.sourceGroupId }
          : {}),
        ...(typeof body.notes === "string" ? { notes: body.notes } : {}),
      });
      return response(registered, 201);
    }
    if (
      area === "partners" &&
      rest[0] &&
      rest[1] === "stage" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["newStage"]);
      const updated = operations.transitionPartnerStage(
        principal.workspaceId,
        rest[0],
        requiredString(body.newStage) as never,
        principal.userId ?? "user-am",
      );
      return response(updated);
    }
    if (
      area === "partners" &&
      rest[0] &&
      rest[1] === "referrals" &&
      rest.length === 2 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "referralId",
        "companyName",
        "taxCode",
        "productCodes",
      ]);
      const referral = operations.recordPartnerReferral(principal.workspaceId, {
        referralId: requiredString(body.referralId),
        partnerId: rest[0],
        companyName: requiredString(body.companyName),
        taxCode: requiredString(body.taxCode),
        productCodes: Array.isArray(body.productCodes)
          ? body.productCodes.map(String)
          : [],
      });
      return response(referral, 201);
    }
    if (
      area === "partners" &&
      rest[0] &&
      rest[1] === "reconciliation" &&
      rest.length === 2 &&
      method === "GET"
    ) {
      return response(
        operations.getPartnerReconciliation(principal.workspaceId, rest[0]),
      );
    }
    if (
      area === "partners" &&
      rest[0] === "conversions" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "conversionId",
        "referralId",
        "contractRevenueVnd",
        "commissionRatePercent",
        "commissionPolicyConfirmedByAmId",
        "policyReferenceNote",
      ]);
      const conversion = operations.recordPartnerConversion(
        principal.workspaceId,
        {
          conversionId: requiredString(body.conversionId),
          referralId: requiredString(body.referralId),
          contractRevenueVnd: Number(body.contractRevenueVnd),
          commissionRatePercent: Number(body.commissionRatePercent),
          commissionPolicyConfirmedByAmId:
            typeof body.commissionPolicyConfirmedByAmId === "string" &&
            body.commissionPolicyConfirmedByAmId.trim()
              ? body.commissionPolicyConfirmedByAmId.trim()
              : (principal.userId ?? "user-am"),
          ...(typeof body.policyReferenceNote === "string"
            ? { policyReferenceNote: body.policyReferenceNote }
            : {}),
        },
      );
      return response(conversion, 201);
    }
    if (
      area === "partners" &&
      rest[0] === "conversions" &&
      rest[1] &&
      rest[2] === "payout" &&
      rest.length === 3 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, ["payoutReference"]);
      const updated = operations.markPartnerConversionPaid(
        principal.workspaceId,
        rest[1],
        requiredString(body.payoutReference),
        principal.userId ?? "user-finance",
      );
      return response(updated);
    }

    if (
      area === "outreach" &&
      rest[0] === "batches" &&
      rest.length === 1 &&
      method === "POST"
    ) {
      const body = await jsonBody(request);
      assertFields(body, [
        "batchName",
        "leadIds",
        "templateCode",
        "action",
        "accountId",
      ]);
      const batchName = requiredString(body.batchName);
      const leadIds = Array.isArray(body.leadIds)
        ? (body.leadIds as string[])
        : [];
      const templateCode = requiredString(body.templateCode);
      const action = (body.action as string) ?? "ADD_FRIEND_AND_SEND_MESSAGE";
      const accountId = (body.accountId as string) ?? "zalo-dian-am01";

      const leadsList = await services.leads.listLeads(principal);
      const matchedLeads = leadsList.items.filter((l) => leadIds.includes(l.id));

      const outreachService = operations.getZaloOutreachService(
        principal.workspaceId,
      );
      const batch = outreachService.createOutreachBatch({
        batchName,
        leads: matchedLeads.map((l) => ({
          id: l.id,
          companyName: l.companyName,
          phone: l.contacts[0]?.phone ?? "",
          contactName: l.contacts[0]?.contactName ?? undefined,
          industry: l.industry ?? undefined,
          province: l.province ?? undefined,
          contactabilityStatus: l.contacts[0]?.contactabilityStatus ?? "ELIGIBLE",
        })),
        templateCode,
        amProfile: {
          name: "Lê Văn AM",
          phone: "0976543210",
        },
        accountId,
        action: action as never,
      });

      const summary = outreachService.getBatchSummary(batch.batchId);
      return response({ batch, summary }, 201);
    }

    if (
      area === "outreach" &&
      rest[0] === "batches" &&
      rest[1] &&
      rest[2] === "run-next" &&
      method === "POST"
    ) {
      const batchId = rest[1];
      const outreachService = operations.getZaloOutreachService(
        principal.workspaceId,
      );

      const runnerResult = await outreachService.executeNextQueuedTask(
        batchId,
        async (input) => {
          return {
            status: "MESSAGE_SENT",
            phone: input.phone,
            details: `Đã kết nối và gửi tin nhắn Zalo tới ${input.phone}`,
          };
        },
      );

      const summary = outreachService.getBatchSummary(batchId);
      const batch = outreachService.getBatch(batchId);
      return response({ result: runnerResult, summary, batch });
    }

    if (
      area === "outreach" &&
      rest[0] === "batches" &&
      rest[1] &&
      method === "GET"
    ) {
      const batchId = rest[1];
      const outreachService = operations.getZaloOutreachService(
        principal.workspaceId,
      );
      const batch = outreachService.getBatch(batchId);
      if (!batch) return response({ error: "BATCH_NOT_FOUND" }, 404);
      const summary = outreachService.getBatchSummary(batchId);
      return response({ batch, summary });
    }

    if (area === "google") {
      const googleRepo = services.googleConnections;
      const googleOAuth = services.googleOAuth;
      const googleDrive = services.googleDrive;

      // POST /api/v1/google/oauth/url
      if (rest[0] === "oauth" && rest[1] === "url" && method === "POST") {
        if (!googleOAuth) return response({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" }, 501);
        const generated = googleOAuth.generateAuthUrl(principal.workspaceId);
        return response(generated);
      }

      // POST /api/v1/google/oauth/callback
      if (rest[0] === "oauth" && rest[1] === "callback" && method === "POST") {
        if (!googleOAuth || !googleRepo) return response({ error: "GOOGLE_SERVICE_NOT_CONFIGURED" }, 501);
        const body = await jsonBody(request);
        const code = requiredString(body.code);
        const state = requiredString(body.state);

        if (!googleOAuth.verifyState(state, principal.workspaceId)) {
          return response({ error: "INVALID_OAUTH_STATE" }, 400);
        }

        const tokens = await googleOAuth.exchangeCode(code);
        const conn = await googleRepo.createConnection({
          workspaceId: principal.workspaceId,
          accountEmail: tokens.accountEmail,
          scopes: tokens.scopes,
          encryptedRefreshToken: tokens.refreshToken ?? null,
          expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        });

        // Strip tokens before returning to client
        const { encryptedRefreshToken, ...sanitized } = conn;
        return response(sanitized, 201);
      }

      // GET /api/v1/google/connections
      if (rest[0] === "connections" && rest.length === 1 && method === "GET") {
        if (!googleRepo) return response([]);
        const list = await googleRepo.listConnections(principal.workspaceId);
        const sanitized = list.map(({ encryptedRefreshToken, ...restItem }) => restItem);
        return response(sanitized);
      }

      // DELETE /api/v1/google/connections/:id
      if (rest[0] === "connections" && rest[1] && rest.length === 2 && method === "DELETE") {
        const id = rest[1];
        if (!googleRepo) return response({ error: "GOOGLE_SERVICE_NOT_CONFIGURED" }, 501);
        const conn = await googleRepo.getConnectionById(principal.workspaceId, id);
        if (!conn) return response({ error: "CONNECTION_NOT_FOUND" }, 404);

        if (conn.encryptedRefreshToken && googleOAuth) {
          await googleOAuth.revokeToken(conn.encryptedRefreshToken).catch(() => {});
        }
        await googleRepo.revokeConnection(principal.workspaceId, id);
        return response({ ok: true });
      }

      // POST /api/v1/google/folders
      if (rest[0] === "folders" && rest.length === 1 && method === "POST") {
        if (!googleRepo || !googleDrive) return response({ error: "GOOGLE_SERVICE_NOT_CONFIGURED" }, 501);
        const body = await jsonBody(request);
        assertFields(body, ["connectionId", "driveFolderId", "folderName", "folderType", "pathHint"]);
        const connectionId = requiredString(body.connectionId);
        const driveFolderId = requiredString(body.driveFolderId);
        const folderName = requiredString(body.folderName);
        const folderType = requiredString(body.folderType);
        const pathHint = optionalString(body.pathHint);

        const conn = await googleRepo.getConnectionById(principal.workspaceId, connectionId);
        if (!conn) return response({ error: "CONNECTION_NOT_FOUND" }, 404);

        // Validate folder in Drive
        await googleDrive.inspectFolder(driveFolderId);

        const registered = await googleRepo.registerFolder({
          connectionId,
          driveFolderId,
          folderName,
          folderType: folderType as never,
          ...(pathHint !== undefined ? { pathHint } : {}),
        });
        return response(registered, 201);
      }

      // GET /api/v1/google/folders/:id/files
      if (rest[0] === "folders" && rest[1] && rest[2] === "files" && method === "GET") {
        const folderId = rest[1];
        if (!googleDrive) return response({ error: "GOOGLE_DRIVE_NOT_CONFIGURED" }, 501);
        const mimeType = url.searchParams.get("mimeType") ?? undefined;
        const mimeTypePrefix = url.searchParams.get("mimeTypePrefix") ?? undefined;
        const files = await googleDrive.listFolderChildren(folderId, {
          ...(mimeType ? { mimeType } : {}),
          ...(mimeTypePrefix ? { mimeTypePrefix } : {}),
        });
        return response(files);
      }

      // POST /api/v1/google/sync
      if (rest[0] === "sync" && rest.length === 1 && method === "POST") {
        if (!googleRepo) return response({ error: "GOOGLE_SERVICE_NOT_CONFIGURED" }, 501);
        const body = await jsonBody(request);
        assertFields(body, [
          "connectionId",
          "entityId",
          "syncType",
          "syncStatus",
          "itemsSynced",
          "errorMessage",
        ]);
        const errorMsg = optionalString(body.errorMessage);
        const log = await googleRepo.appendSyncLog({
          connectionId: requiredString(body.connectionId),
          entityId: requiredString(body.entityId),
          syncType: requiredString(body.syncType),
          syncStatus: (body.syncStatus as any) ?? "SUCCESS",
          itemsSynced: Number(body.itemsSynced ?? 0),
          ...(errorMsg !== undefined ? { errorMessage: errorMsg } : {}),
        });
        return response(log, 201);
      }

      // GET /api/v1/google/sync/:id
      if (rest[0] === "sync" && rest[1] && method === "GET") {
        if (!googleRepo) return response([]);
        const logs = await googleRepo.listSyncLogs(rest[1]);
        return response(logs);
      }

      // POST /api/v1/google/sync-documents
      if (rest[0] === "sync-documents" && method === "POST") {
        if (!services.googleDocsSync) return response({ error: "GOOGLE_DOCS_SYNC_NOT_CONFIGURED" }, 501);
        const body = await jsonBody(request);
        assertFields(body, ["connectionId", "documentId"]);
        const connectionId = requiredString(body.connectionId);
        const documentId = requiredString(body.documentId);
        const syncResult = await services.googleDocsSync.syncDocument({
          workspaceId: principal.workspaceId,
          connectionId,
          documentId,
        });
        if (!syncResult.success) {
          return response({ error: syncResult.errorCode, message: syncResult.errorMessage }, 400);
        }
        return response(syncResult, 200);
      }

      // GET /api/v1/google/documents
      if (rest[0] === "documents" && method === "GET") {
        if (!services.contentLibrary) return response({ items: [] });
        const connectionId = url.searchParams.get("connectionId") ?? "";
        const docs = await services.contentLibrary.listGoogleDocuments(connectionId);
        return response({ items: docs });
      }
    }

    if (area === "contents") {
      const contentRepo = services.contentLibrary;

      // GET /api/v1/contents
      if (rest.length === 0 && method === "GET") {
        if (!contentRepo) return response({ items: [] });
        const topicCode = url.searchParams.get("topicCode") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        const documentId = url.searchParams.get("documentId") ?? undefined;
        const items = await contentRepo.listPosts(principal.workspaceId, {
          ...(topicCode ? { topicCode } : {}),
          ...(status ? { status } : {}),
          ...(documentId ? { documentId } : {}),
        });
        const enrichedItems = items.map((p: any) => ({
          ...p,
          mediaPaths: Array.isArray(p.mediaPaths) && p.mediaPaths.length > 0
            ? p.mediaPaths
            : p.mediaHint && typeof p.mediaHint === "string" && p.mediaHint !== "AUTO"
              ? [p.mediaHint]
              : [
                  p.topicCode === "CHU_KY_SO"
                    ? "https://images.unsplash.com/photo-1450133064473-71024230f91b?w=600&auto=format&fit=crop&q=80"
                    : p.topicCode === "HOA_DON_DIEN_TU"
                      ? "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&auto=format&fit=crop&q=80"
                      : "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&auto=format&fit=crop&q=80"
                ],
        }));
        return response({ items: enrichedItems });
      }

      // POST /api/v1/contents
      if (rest.length === 0 && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const body = await jsonBody(request);
        assertFields(body, ["title", "content", "topic", "platforms", "postCode", "mediaPaths", "mediaHint"]);
        const title = requiredString(body.title);
        const content = requiredString(body.content);
        const postCode =
          typeof body.postCode === "string" && body.postCode.trim()
            ? body.postCode.trim()
            : `POST-FB-${Date.now().toString(36).toUpperCase()}`;
        const topicCode =
          typeof body.topic === "string" && body.topic.trim()
            ? body.topic.trim()
            : "CHU_KY_SO";
        const platforms = Array.isArray(body.platforms)
          ? body.platforms.map(String)
          : ["FACEBOOK"];
        const mediaPaths = Array.isArray(body.mediaPaths) ? body.mediaPaths.map(String) : [];
        const mediaHint = typeof body.mediaHint === "string" ? body.mediaHint : (mediaPaths[0] ?? null);
        const saved = await contentRepo.upsertPost({
          workspaceId: principal.workspaceId,
          postCode,
          title,
          body: content,
          topicCode,
          targetAudience: "BUSINESS_OWNER",
          platforms,
          status: "APPROVED",
          priority: "NORMAL",
          mediaHint,
          hashtags: ["#Viettel", "#SME"],
          contentHash: "",
        });
        return response({ post: { ...saved, mediaPaths } }, 201);
      }

      // POST /api/v1/contents/import-text
      if (rest[0] === "import-text" && rest.length === 1 && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const body = await jsonBody(request);
        assertFields(body, ["rawText"]);
        const rawText = requiredString(body.rawText);
        let parsedPosts;
        try {
          parsedPosts = parseStructuredPosts(rawText);
        } catch (err) {
          return response(
            {
              error: "INVALID_DOCUMENT_FORMAT",
              message: err instanceof Error ? err.message : "PARSE_ERROR",
            },
            400,
          );
        }
        const classifier = new TopicClassifier();
        const imported = [];
        for (const post of parsedPosts) {
          const classified = post.topic
            ? post.topic
            : classifier.classify({
                title: post.title,
                content: post.content,
              }).topic;
          const saved = await contentRepo.upsertPost({
            workspaceId: principal.workspaceId,
            postCode: post.postId ?? post.contentId,
            title: post.title ?? post.contentId,
            body: post.content,
            topicCode: classified,
            targetAudience: post.target ?? "BUSINESS_OWNER",
            platforms: [...post.platforms],
            status: post.status ?? "DRAFT",
            priority: post.publishPriority ?? "NORMAL",
            mediaHint: post.media ?? null,
            hashtags: [...(post.hashtags ?? [])],
            contentHash: post.contentHash ?? "",
            validFrom: post.publishFrom ?? null,
            validUntil: post.publishUntil ?? null,
          });
          imported.push(saved);
        }
        return response(
          { importedCount: imported.length, items: imported },
          201,
        );
      }

      // GET /api/v1/contents/:id
      if (rest[0] && rest.length === 1 && method === "GET") {
        if (!contentRepo) return response({ error: "CONTENT_NOT_FOUND" }, 404);
        const id = rest[0];
        const post = await contentRepo.getPostById(principal.workspaceId, id);
        if (!post) return response({ error: "CONTENT_NOT_FOUND" }, 404);
        const versions = await contentRepo.listPostVersions(id);
        return response({ post, versions });
      }

      // GET /api/v1/contents/:id/versions
      if (rest[0] && rest[1] === "versions" && method === "GET") {
        if (!contentRepo) return response({ versions: [], approvals: [] });
        const id = rest[0];
        const versions = await contentRepo.listPostVersions(id);
        const approvals = contentRepo.listContentApprovals
          ? await contentRepo.listContentApprovals(id)
          : [];
        return response({ versions, approvals });
      }

      // POST /api/v1/contents/:id/match-media
      if (rest[0] && rest[1] === "match-media" && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const id = rest[0];
        const post = await contentRepo.getPostById(principal.workspaceId, id);
        if (!post) return response({ error: "CONTENT_NOT_FOUND" }, 404);

        const allAssets = contentRepo.listMediaAssets
          ? await contentRepo.listMediaAssets(principal.workspaceId)
          : [];

        const matchResult = rankAndMatchMedia(
          {
            postCode: post.postCode,
            topicCode: post.topicCode,
            platforms: post.platforms as PublishPlatform[],
            mediaRequired: post.mediaHint !== null && post.mediaHint !== "NONE",
            explicitMediaHint: post.mediaHint,
          },
          allAssets.map((a) => ({
            id: a.id,
            driveFileId: a.driveFileId,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            checksum: a.checksum,
            topicCode: a.topicCode,
            postCodeHint: a.postCodeHint,
            platforms: a.platforms as PublishPlatform[],
            status: a.status as MediaAssetStatus,
            version: a.version,
            isSharedMedia: a.isSharedMedia,
          })),
        );

        let link = null;
        if (matchResult.selectedMedia && contentRepo.linkMediaToContent) {
          const topScore = matchResult.candidates[0]?.score ?? 1.0;
          link = await contentRepo.linkMediaToContent({
            contentId: post.id,
            mediaId: matchResult.selectedMedia.id,
            position: 0,
            matchMethod: matchResult.matchMethod,
            matchScore: topScore,
          });
        }

        return response({
          match: {
            ...matchResult,
            matchedBy: matchResult.matchMethod,
          },
          link,
        });
      }

      // POST /api/v1/contents/:id/validate
      if (rest[0] && rest[1] === "validate" && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const id = rest[0];
        const post = await contentRepo.getPostById(principal.workspaceId, id);
        if (!post) return response({ error: "CONTENT_NOT_FOUND" }, 404);

        const linkedMedia = contentRepo.listMediaForContent
          ? await contentRepo.listMediaForContent(post.id)
          : [];

        const validation = validateContentForPublishing({
          postCode: post.postCode,
          title: post.title,
          body: post.body,
          topicCode: post.topicCode,
          platforms: post.platforms as PublishPlatform[],
          status: post.status,
          contentHash: post.contentHash,
          mediaRequired: post.mediaHint !== null && post.mediaHint !== "NONE",
          linkedMedia: linkedMedia.map((m) => ({
            id: m.id,
            topicCode: m.topicCode,
            status: m.status,
            isSharedMedia: m.isSharedMedia,
          })),
          validFrom: post.validFrom,
          validUntil: post.validUntil,
        });

        const expiredIssue = validation.issues.find((i) => i.code === "POST_EXPIRED");
        const statusOut = expiredIssue ? "POST_EXPIRED" : validation.status;

        return response({
          valid: validation.valid,
          status: statusOut,
          issues: validation.issues,
          linkedMediaCount: linkedMedia.length,
        });
      }

      // POST /api/v1/contents/:id/approve
      if (rest[0] && rest[1] === "approve" && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const id = rest[0];
        let body: Record<string, unknown> = {};
        try {
          body = await jsonBody(request);
        } catch {
          body = {};
        }

        const post = await contentRepo.getPostById(principal.workspaceId, id);
        const targetStatus =
          typeof body.status === "string" && body.status.trim()
            ? body.status.trim()
            : "APPROVED";

        const updated = await contentRepo.updatePostStatus(
          principal.workspaceId,
          id,
          targetStatus,
        );
        if (!updated) return response({ error: "CONTENT_NOT_FOUND" }, 404);

        let approval = undefined;
        if (contentRepo.recordContentApproval) {
          const linkedMedia = contentRepo.listMediaForContent
            ? await contentRepo.listMediaForContent(id)
            : [];
          const primaryMedia = linkedMedia[0];
          const approvedPlatforms = Array.isArray(body.approvedPlatforms)
            ? body.approvedPlatforms.map(String)
            : (post?.platforms ?? ["ZALO", "FACEBOOK"]);
          const notes = typeof body.notes === "string" ? body.notes : null;

          approval = await contentRepo.recordContentApproval({
            workspaceId: principal.workspaceId,
            contentId: id,
            contentVersion: post?.version ?? 1,
            mediaVersion: primaryMedia?.version ?? null,
            approvedBy: principal.userId,
            status: targetStatus,
            approvedPlatforms,
            notes,
          });
        }

        return response(approval ? { ...updated, approval } : updated);
      }

      // POST /api/v1/contents/:id/reject
      if (rest[0] && rest[1] === "reject" && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const id = rest[0];
        let body: Record<string, unknown> = {};
        try {
          body = await jsonBody(request);
        } catch {
          body = {};
        }
        const post = await contentRepo.getPostById(principal.workspaceId, id);
        const updated = await contentRepo.updatePostStatus(principal.workspaceId, id, "REJECTED");
        if (!updated) return response({ error: "CONTENT_NOT_FOUND" }, 404);

        let approval = undefined;
        if (contentRepo.recordContentApproval) {
          const notes = typeof body.notes === "string" ? body.notes : null;
          approval = await contentRepo.recordContentApproval({
            workspaceId: principal.workspaceId,
            contentId: id,
            contentVersion: post?.version ?? 1,
            mediaVersion: null,
            approvedBy: principal.userId,
            status: "REJECTED",
            approvedPlatforms: [],
            notes,
          });
        }
        return response(approval ? { ...updated, approval } : updated);
      }

      // POST /api/v1/contents/:id/classify
      if (rest[0] && rest[1] === "classify" && method === "POST") {
        if (!contentRepo) return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        const id = rest[0];
        const post = await contentRepo.getPostById(principal.workspaceId, id);
        if (!post) return response({ error: "CONTENT_NOT_FOUND" }, 404);
        const classifier = new TopicClassifier();
        const classified = classifier.classifyPostTopic({ title: post.title, content: post.body });
        const updated = await contentRepo.upsertPost({
          workspaceId: principal.workspaceId,
          documentId: post.documentId,
          postCode: post.postCode,
          title: post.title,
          body: post.body,
          topicCode: classified.topic,
          targetAudience: post.targetAudience,
          platforms: post.platforms,
          status: post.status,
          priority: post.priority,
          mediaHint: post.mediaHint,
          hashtags: post.hashtags,
          contentHash: post.contentHash,
          validFrom: post.validFrom,
          validUntil: post.validUntil,
        });
        return response({ post: updated, classification: classified });
      }
    }

    if (area === "media") {
      const contentRepo = services.contentLibrary;

      // GET /api/v1/media
      if (rest.length === 0 && method === "GET") {
        if (!contentRepo?.listMediaAssets) return response({ items: [] });
        const topicCode = url.searchParams.get("topicCode") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        const items = await contentRepo.listMediaAssets(principal.workspaceId, {
          ...(topicCode ? { topicCode } : {}),
          ...(status ? { status } : {}),
        });
        return response({ items });
      }

      // POST /api/v1/media/sync
      if (rest[0] === "sync" && rest.length === 1 && method === "POST") {
        if (!contentRepo?.upsertMediaAsset) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const body = await jsonBody(request);
        const driveFileId = requiredString(body.driveFileId);
        const fileName = requiredString(body.fileName);
        const mimeType = requiredString(body.mimeType);
        const sizeBytes = Number(body.sizeBytes ?? 0);
        const checksum = requiredString(body.checksum);
        const topicCode = requiredString(body.topicCode);
        const connectionId = optionalString(body.connectionId) ?? null;
        const postCodeHint = optionalString(body.postCodeHint) ?? null;
        const isSharedMedia = Boolean(body.isSharedMedia) || topicCode.toUpperCase() === "SHARED_MEDIA";
        const platforms = Array.isArray(body.platforms)
          ? body.platforms.map(String)
          : ["ZALO", "FACEBOOK"];

        const existingByChecksum = contentRepo.findMediaByChecksum
          ? await contentRepo.findMediaByChecksum(principal.workspaceId, checksum)
          : null;
        const existingChecksums =
          existingByChecksum && existingByChecksum.driveFileId !== driveFileId
            ? new Set([checksum])
            : new Set<string>();

        const validation = validateMediaCandidate(
          { fileName, mimeType, sizeBytes, checksum },
          { existingChecksums },
        );

        if (!validation.valid) {
          const errorCode =
            validation.errorCode === "INVALID_MEDIA_MIME_TYPE"
              ? "UNSUPPORTED_MEDIA_TYPE"
              : (validation.errorCode ?? "INVALID_MEDIA");
          return response({ error: errorCode }, 400);
        }

        const media = await contentRepo.upsertMediaAsset({
          workspaceId: principal.workspaceId,
          connectionId,
          driveFileId,
          fileName,
          mimeType,
          sizeBytes,
          checksum,
          topicCode,
          postCodeHint,
          platforms,
          status: typeof body.status === "string" ? body.status : "APPROVED",
          isSharedMedia,
        });

        return response({ media }, 201);
      }

      // GET /api/v1/media/:id/preview
      if (rest[0] && rest[1] === "preview" && method === "GET") {
        if (!contentRepo?.getMediaById) return response({ error: "MEDIA_NOT_FOUND" }, 404);
        const id = rest[0];
        const media = await contentRepo.getMediaById(principal.workspaceId, id);
        if (!media) return response({ error: "MEDIA_NOT_FOUND" }, 404);
        return response({
          mediaId: media.id,
          driveFileId: media.driveFileId,
          fileName: media.fileName,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
          topicCode: media.topicCode,
          status: media.status,
          previewUrl: `/api/v1/media/${media.id}/preview?raw=1`,
        });
      }

      // POST /api/v1/media/:id/approve
      if (rest[0] && rest[1] === "approve" && method === "POST") {
        if (!contentRepo?.updateMediaStatus) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const id = rest[0];
        const updated = await contentRepo.updateMediaStatus(
          principal.workspaceId,
          id,
          "APPROVED",
        );
        if (!updated) return response({ error: "MEDIA_NOT_FOUND" }, 404);
        return response(updated);
      }

      // GET /api/v1/media/:id
      if (rest[0] && rest.length === 1 && method === "GET") {
        if (!contentRepo?.getMediaById) return response({ error: "MEDIA_NOT_FOUND" }, 404);
        const id = rest[0];
        const media = await contentRepo.getMediaById(principal.workspaceId, id);
        if (!media) return response({ error: "MEDIA_NOT_FOUND" }, 404);
        const versions = contentRepo.listMediaVersions
          ? await contentRepo.listMediaVersions(id)
          : [];
        return response({ media, versions });
      }
    }

    if (area === "accounts") {
      const contentRepo = services.contentLibrary;

      // GET /api/v1/accounts
      if (rest.length === 0 && method === "GET") {
        if (!contentRepo?.listSocialAccounts) return response({ items: [] });
        const platform = url.searchParams.get("platform") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        const items = await contentRepo.listSocialAccounts(principal.workspaceId, {
          ...(platform ? { platform } : {}),
          ...(status ? { status } : {}),
        });
        return response({ items });
      }

      // POST /api/v1/accounts
      if (rest.length === 0 && method === "POST") {
        if (!contentRepo?.upsertSocialAccount) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const body = await jsonBody(request);
        const accountCode = requiredString(body.accountCode);
        const platform = requiredString(body.platform);
        if (platform !== "ZALO" && platform !== "FACEBOOK") {
          return response({ error: "INVALID_PLATFORM" }, 400);
        }
        const displayName = requiredString(body.displayName);
        const assignedTopics = Array.isArray(body.assignedTopics)
          ? body.assignedTopics.map(String)
          : [];
        const preferredWindows = Array.isArray(body.preferredWindows)
          ? body.preferredWindows.map(String)
          : [];
        const maxPostsPerDay =
          typeof body.maxPostsPerDay === "number" ? body.maxPostsPerDay : 2;
        const minIntervalMinutes =
          typeof body.minIntervalMinutes === "number" ? body.minIntervalMinutes : 180;
        const status =
          typeof body.status === "string" && body.status.trim()
            ? body.status.trim()
            : "ACTIVE";

        const account = await contentRepo.upsertSocialAccount({
          workspaceId: principal.workspaceId,
          accountCode,
          platform,
          displayName,
          ownerUserId: principal.userId,
          assignedTopics,
          preferredWindows,
          maxPostsPerDay,
          minIntervalMinutes,
          status,
        });
        return response({ account }, 201);
      }

      // POST /api/v1/accounts/:id/check-session
      if (rest[0] && rest[1] === "check-session" && method === "POST") {
        if (!contentRepo?.updateSocialAccount) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const id = rest[0];
        let body: Record<string, unknown> = {};
        try {
          body = await jsonBody(request);
        } catch {
          body = {};
        }
        const nextStatus =
          typeof body.status === "string" && body.status.trim()
            ? body.status.trim()
            : undefined;
        const updated = await contentRepo.updateSocialAccount(principal.workspaceId, id, {
          ...(nextStatus ? { status: nextStatus } : {}),
          lastSessionCheckAt: new Date(),
        });
        if (!updated) return response({ error: "ACCOUNT_NOT_FOUND" }, 404);
        return response({ account: updated });
      }

      // POST /api/v1/accounts/:id/pause
      if (rest[0] && rest[1] === "pause" && method === "POST") {
        if (!contentRepo?.updateSocialAccount) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const updated = await contentRepo.updateSocialAccount(
          principal.workspaceId,
          rest[0],
          { status: "PAUSED" },
        );
        if (!updated) return response({ error: "ACCOUNT_NOT_FOUND" }, 404);
        return response(updated);
      }

      // POST /api/v1/accounts/:id/resume
      if (rest[0] && rest[1] === "resume" && method === "POST") {
        if (!contentRepo?.updateSocialAccount) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const updated = await contentRepo.updateSocialAccount(
          principal.workspaceId,
          rest[0],
          { status: "ACTIVE" },
        );
        if (!updated) return response({ error: "ACCOUNT_NOT_FOUND" }, 404);
        return response(updated);
      }

      // PATCH /api/v1/accounts/:id
      if (rest[0] && rest.length === 1 && method === "PATCH") {
        if (!contentRepo?.updateSocialAccount) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const body = await jsonBody(request);
        const updated = await contentRepo.updateSocialAccount(
          principal.workspaceId,
          rest[0],
          {
            ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
            ...(Array.isArray(body.assignedTopics)
              ? { assignedTopics: body.assignedTopics.map(String) }
              : {}),
            ...(typeof body.maxPostsPerDay === "number"
              ? { maxPostsPerDay: body.maxPostsPerDay }
              : {}),
            ...(typeof body.minIntervalMinutes === "number"
              ? { minIntervalMinutes: body.minIntervalMinutes }
              : {}),
            ...(Array.isArray(body.preferredWindows)
              ? { preferredWindows: body.preferredWindows.map(String) }
              : {}),
            ...(typeof body.status === "string" ? { status: body.status } : {}),
          },
        );
        if (!updated) return response({ error: "ACCOUNT_NOT_FOUND" }, 404);
        return response({ account: updated });
      }

      // GET /api/v1/accounts/:id
      if (rest[0] && rest.length === 1 && method === "GET") {
        if (!contentRepo?.getSocialAccountById) {
          return response({ error: "ACCOUNT_NOT_FOUND" }, 404);
        }
        const account = await contentRepo.getSocialAccountById(
          principal.workspaceId,
          rest[0],
        );
        if (!account) return response({ error: "ACCOUNT_NOT_FOUND" }, 404);
        return response({ account });
      }
    }

    if (area === "publishing") {
      const contentRepo = services.contentLibrary;

      // GET /api/v1/publishing/calendar
      if (rest[0] === "calendar" && rest.length === 1 && method === "GET") {
        if (!contentRepo?.listPublishingSchedules) {
          return response({ schedules: [], campaigns: [] });
        }
        const accountId = url.searchParams.get("accountId") ?? undefined;
        const schedules = await contentRepo.listPublishingSchedules(
          principal.workspaceId,
          accountId ? { accountId } : undefined,
        );
        const campaigns = contentRepo.listPublishingCampaigns
          ? await contentRepo.listPublishingCampaigns(principal.workspaceId)
          : [];
        return response({ schedules, campaigns });
      }

      // POST /api/v1/publishing/campaigns
      if (rest[0] === "campaigns" && rest.length === 1 && method === "POST") {
        if (!contentRepo?.createPublishingCampaign) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const body = await jsonBody(request);
        const name = requiredString(body.name);
        const topicCodes = Array.isArray(body.topicCodes)
          ? body.topicCodes.map(String)
          : [];
        const accountIds = Array.isArray(body.accountIds)
          ? body.accountIds.map(String)
          : [];
        const startDate = optionalString(body.startDate) ?? null;
        const endDate = optionalString(body.endDate) ?? null;

        const campaign = await contentRepo.createPublishingCampaign({
          workspaceId: principal.workspaceId,
          name,
          topicCodes,
          accountIds,
          startDate,
          endDate,
          status: typeof body.status === "string" ? body.status : "ACTIVE",
        });
        return response({ campaign }, 201);
      }

      // POST /api/v1/publishing/schedule
      if (rest[0] === "schedule" && rest.length === 1 && method === "POST") {
        if (
          !contentRepo?.getPostById ||
          !contentRepo?.getSocialAccountById ||
          !contentRepo?.createPublishingSchedule ||
          !contentRepo?.createPublishingJob
        ) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const body = await jsonBody(request);
        const contentId = requiredString(body.contentId);
        const accountId = requiredString(body.accountId);
        const scheduledAtStr = requiredString(body.scheduledAt);
        const scheduledAt = new Date(scheduledAtStr);
        if (!Number.isFinite(scheduledAt.getTime())) {
          return response({ error: "INVALID_DATE" }, 400);
        }
        const publishMode =
          typeof body.publishMode === "string" && body.publishMode.trim()
            ? body.publishMode.trim()
            : "ASSISTED_PUBLISH";
        const campaignId = optionalString(body.campaignId) ?? null;

        const post = await contentRepo.getPostById(principal.workspaceId, contentId);
        if (!post) return response({ error: "CONTENT_NOT_FOUND" }, 404);

        const account = await contentRepo.getSocialAccountById(
          principal.workspaceId,
          accountId,
        );
        if (!account) return response({ error: "ACCOUNT_NOT_FOUND" }, 404);

        const existingJobs = contentRepo.listPublishingJobs
          ? await contentRepo.listPublishingJobs(principal.workspaceId, {
              accountId: account.id,
            })
          : [];

        const historyEntries = await Promise.all(
          existingJobs.map(async (j) => {
            const p = await contentRepo.getPostById(principal.workspaceId, j.contentId);
            return {
              jobId: j.id,
              accountId: j.accountId,
              platform: j.platform as PublishPlatform,
              contentId: j.contentId,
              contentHash: p?.contentHash ?? "",
              topicCode: p?.topicCode ?? "",
              scheduledAt: j.scheduledAt,
              status: j.status,
            };
          }),
        );

        const policyResult = evaluatePublishingSchedule({
          post: {
            contentId: post.id,
            postCode: post.postCode,
            topicCode: post.topicCode,
            status: post.status,
            platforms: post.platforms as PublishPlatform[],
            contentHash: post.contentHash,
            validFrom: post.validFrom,
            validUntil: post.validUntil,
          },
          account: {
            accountId: account.id,
            platform: account.platform as PublishPlatform,
            status: account.status as SocialAccountStatus,
            maxPostsPerDay: account.maxPostsPerDay,
            minIntervalMinutes: account.minIntervalMinutes,
            minReuseDays: 30,
          },
          scheduledAt,
          existingHistory: historyEntries,
        });

        if (!policyResult.allowed) {
          const statusOut =
            policyResult.errorCode === "DUPLICATE_CONTENT_ON_ACCOUNT" ? 409 : 400;
          return response(
            {
              error: policyResult.errorCode,
              message: policyResult.message,
            },
            statusOut,
          );
        }

        const schedule = await contentRepo.createPublishingSchedule({
          workspaceId: principal.workspaceId,
          campaignId,
          contentId: post.id,
          accountId: account.id,
          platform: account.platform,
          scheduledAt: scheduledAt.toISOString(),
          publishMode,
          status: "SCHEDULED",
        });

        const idempotencyKey = `pub:${post.id}:${account.id}:${scheduledAt.toISOString()}`;
        const job = await contentRepo.createPublishingJob({
          workspaceId: principal.workspaceId,
          scheduleId: schedule.id,
          contentId: post.id,
          accountId: account.id,
          platform: account.platform,
          publishMode,
          scheduledAt: scheduledAt.toISOString(),
          idempotencyKey,
          status: "QUEUED",
        });

        if (contentRepo.appendPublishingJobStep) {
          await contentRepo.appendPublishingJobStep({
            jobId: job.id,
            stepName: "VALIDATE_CONTENT",
            status: "SUCCESS",
            details: `Scheduled post ${post.postCode} on ${account.accountCode} (${account.platform}).`,
          });
        }

        const preparedContent = preparePlatformContent(
          {
            title: post.title,
            body: post.body,
            hashtags: post.hashtags,
          },
          account.platform as PublishPlatform,
        );

        return response({ schedule, job, preparedContent }, 201);
      }

      // GET /api/v1/publishing/jobs
      if (rest[0] === "jobs" && rest.length === 1 && method === "GET") {
        if (!contentRepo?.listPublishingJobs) return response({ items: [] });
        const accountId = url.searchParams.get("accountId") ?? undefined;
        const status = url.searchParams.get("status") ?? undefined;
        const items = await contentRepo.listPublishingJobs(principal.workspaceId, {
          ...(accountId ? { accountId } : {}),
          ...(status ? { status } : {}),
        });
        return response({ items });
      }

      // POST /api/v1/publishing/jobs/:id/approve
      if (rest[0] === "jobs" && rest[1] && rest[2] === "approve" && method === "POST") {
        if (!contentRepo?.updatePublishingJobStatus) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const jobId = rest[1];
        const updated = await contentRepo.updatePublishingJobStatus(
          principal.workspaceId,
          jobId,
          { status: "WAITING_CONFIRMATION" },
        );
        if (!updated) return response({ error: "JOB_NOT_FOUND" }, 404);
        if (contentRepo.appendPublishingJobStep) {
          await contentRepo.appendPublishingJobStep({
            jobId,
            stepName: "PREPARE_COMPOSER",
            status: "SUCCESS",
            details: "Job approved and composer prepared for AM review.",
          });
        }
        return response({ job: updated });
      }

      // POST /api/v1/publishing/jobs/:id/confirm-assisted
      if (
        rest[0] === "jobs" &&
        rest[1] &&
        rest[2] === "confirm-assisted" &&
        method === "POST"
      ) {
        if (
          !contentRepo?.getPublishingJobById ||
          !contentRepo?.updatePublishingJobStatus ||
          !contentRepo?.recordPublishingResult
        ) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const jobId = rest[1];
        let body: Record<string, unknown> = {};
        try {
          body = await jsonBody(request);
        } catch {
          body = {};
        }

        const existingJob = await contentRepo.getPublishingJobById(
          principal.workspaceId,
          jobId,
        );
        if (!existingJob) return response({ error: "JOB_NOT_FOUND" }, 404);

        const updatedJob = await contentRepo.updatePublishingJobStatus(
          principal.workspaceId,
          jobId,
          { status: "PUBLISHED" },
        );

        if (contentRepo.appendPublishingJobStep) {
          await contentRepo.appendPublishingJobStep({
            jobId,
            stepName: "SUBMIT_POST",
            status: "SUCCESS",
            details: `Confirmed assisted publish by ${principal.userId}.`,
          });
        }

        const result = await contentRepo.recordPublishingResult({
          jobId,
          workspaceId: principal.workspaceId,
          contentId: existingJob.contentId,
          accountId: existingJob.accountId,
          platform: existingJob.platform,
          status: "PUBLISHED",
          publishedUrl: optionalString(body.publishedUrl) ?? null,
          screenshotPath: optionalString(body.screenshotPath) ?? null,
          confirmedBy: principal.userId,
        });

        return response({ job: updatedJob, result });
      }

      // POST /api/v1/publishing/jobs/:id/cancel
      if (rest[0] === "jobs" && rest[1] && rest[2] === "cancel" && method === "POST") {
        if (!contentRepo?.updatePublishingJobStatus) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const jobId = rest[1];
        const updated = await contentRepo.updatePublishingJobStatus(
          principal.workspaceId,
          jobId,
          { status: "CANCELLED" },
        );
        if (!updated) return response({ error: "JOB_NOT_FOUND" }, 404);
        return response({ job: updated });
      }

      // POST /api/v1/publishing/jobs/:id/retry
      if (rest[0] === "jobs" && rest[1] && rest[2] === "retry" && method === "POST") {
        if (
          !contentRepo?.getPublishingJobById ||
          !contentRepo?.updatePublishingJobStatus
        ) {
          return response({ error: "SERVICE_NOT_CONFIGURED" }, 501);
        }
        const jobId = rest[1];
        const existingJob = await contentRepo.getPublishingJobById(
          principal.workspaceId,
          jobId,
        );
        if (!existingJob) return response({ error: "JOB_NOT_FOUND" }, 404);

        const updated = await contentRepo.updatePublishingJobStatus(
          principal.workspaceId,
          jobId,
          {
            status: "QUEUED",
            errorCode: null,
            errorMessage: null,
            retryCount: existingJob.retryCount + 1,
          },
        );
        return response({ job: updated });
      }

      // GET /api/v1/publishing/jobs/:id
      if (rest[0] === "jobs" && rest[1] && rest.length === 2 && method === "GET") {
        if (!contentRepo?.getPublishingJobById) {
          return response({ error: "JOB_NOT_FOUND" }, 404);
        }
        const jobId = rest[1];
        const job = await contentRepo.getPublishingJobById(
          principal.workspaceId,
          jobId,
        );
        if (!job) return response({ error: "JOB_NOT_FOUND" }, 404);
        const steps = contentRepo.listPublishingJobSteps
          ? await contentRepo.listPublishingJobSteps(jobId)
          : [];
        const result = contentRepo.getPublishingResultByJobId
          ? await contentRepo.getPublishingResultByJobId(jobId)
          : null;
        return response({ job, steps, result });
      }
    }

    if (area === "analytics") {
      const contentRepo = services.contentLibrary;

      // GET /api/v1/analytics/publishing-summary
      if (rest[0] === "publishing-summary" && rest.length === 1 && method === "GET") {
        const posts = contentRepo?.listPosts
          ? await contentRepo.listPosts(principal.workspaceId)
          : [];
        const media = contentRepo?.listMediaAssets
          ? await contentRepo.listMediaAssets(principal.workspaceId)
          : [];
        const accounts = contentRepo?.listSocialAccounts
          ? await contentRepo.listSocialAccounts(principal.workspaceId)
          : [];
        const jobs = contentRepo?.listPublishingJobs
          ? await contentRepo.listPublishingJobs(principal.workspaceId)
          : [];

        return response({
          posts: {
            total: posts.length,
            approved: posts.filter((p) => p.status === "APPROVED").length,
            draft: posts.filter((p) => p.status === "DRAFT").length,
            rejected: posts.filter((p) => p.status === "REJECTED").length,
          },
          media: {
            total: media.length,
            approved: media.filter((m) => m.status === "APPROVED").length,
            pending: media.filter((m) => m.status === "PENDING").length,
          },
          accounts: {
            total: accounts.length,
            active: accounts.filter(
              (a) => a.status === "ACTIVE" || a.status === "CONNECTED",
            ).length,
            needsAuth: accounts.filter(
              (a) =>
                a.status === "SESSION_EXPIRED" ||
                a.status === "NEEDS_AUTH" ||
                a.status === "NEEDS_LOGIN",
            ).length,
          },
          jobs: {
            total: jobs.length,
            queued: jobs.filter((j) => j.status === "QUEUED").length,
            waitingConfirmation: jobs.filter(
              (j) => j.status === "WAITING_CONFIRMATION",
            ).length,
            published: jobs.filter((j) => j.status === "PUBLISHED").length,
            failed: jobs.filter((j) => j.status === "FAILED").length,
          },
        });
      }

      // GET /api/v1/analytics/topics
      if (rest[0] === "topics" && rest.length === 1 && method === "GET") {
        const posts = contentRepo?.listPosts
          ? await contentRepo.listPosts(principal.workspaceId)
          : [];
        const jobs = contentRepo?.listPublishingJobs
          ? await contentRepo.listPublishingJobs(principal.workspaceId)
          : [];

        const postById = new Map(posts.map((p) => [p.id, p]));
        const topicMap = new Map<
          string,
          {
            topicCode: string;
            totalPosts: number;
            approvedPosts: number;
            publishedJobs: number;
          }
        >();

        for (const post of posts) {
          const entry = topicMap.get(post.topicCode) ?? {
            topicCode: post.topicCode,
            totalPosts: 0,
            approvedPosts: 0,
            publishedJobs: 0,
          };
          entry.totalPosts += 1;
          if (post.status === "APPROVED") entry.approvedPosts += 1;
          topicMap.set(post.topicCode, entry);
        }

        for (const job of jobs) {
          if (job.status !== "PUBLISHED") continue;
          const post = postById.get(job.contentId);
          if (!post) continue;
          const entry = topicMap.get(post.topicCode) ?? {
            topicCode: post.topicCode,
            totalPosts: 0,
            approvedPosts: 0,
            publishedJobs: 0,
          };
          entry.publishedJobs += 1;
          topicMap.set(post.topicCode, entry);
        }

        return response({ topics: Array.from(topicMap.values()) });
      }

      // GET /api/v1/analytics/accounts
      if (rest[0] === "accounts" && rest.length === 1 && method === "GET") {
        const accounts = contentRepo?.listSocialAccounts
          ? await contentRepo.listSocialAccounts(principal.workspaceId)
          : [];
        const jobs = contentRepo?.listPublishingJobs
          ? await contentRepo.listPublishingJobs(principal.workspaceId)
          : [];

        const accountStats = accounts.map((acc) => {
          const accJobs = jobs.filter((j) => j.accountId === acc.id);
          return {
            accountId: acc.id,
            accountCode: acc.accountCode,
            platform: acc.platform,
            displayName: acc.displayName,
            status: acc.status,
            totalJobs: accJobs.length,
            publishedCount: accJobs.filter((j) => j.status === "PUBLISHED").length,
            waitingConfirmationCount: accJobs.filter(
              (j) => j.status === "WAITING_CONFIRMATION",
            ).length,
            failedCount: accJobs.filter((j) => j.status === "FAILED").length,
          };
        });

        return response({ accounts: accountStats });
      }

      // GET /api/v1/analytics/partners
      if (rest[0] === "partners" && rest.length === 1 && method === "GET") {
        return response(
          operations.getPartnerChannelAnalytics(principal.workspaceId),
        );
      }
    }

    return response({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    const mapped = safeError(error);
    return response({ error: mapped.code }, mapped.status);
  }
}

export type { AuthPrincipal, AuthRole };
