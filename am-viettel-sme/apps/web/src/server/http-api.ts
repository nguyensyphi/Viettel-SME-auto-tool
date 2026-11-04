import { randomUUID } from "node:crypto";
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
import type { InMemoryImportApi } from "./import-api.js";

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
  readonly sessionCookie: {
    readonly secure: boolean;
    readonly maxAgeSeconds: number;
  };
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
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/u.test(error.message)
        ? error.message
        : "INTERNAL_ERROR";
  const status =
    code === "UNAUTHENTICATED"
      ? 401
      : code === "FORBIDDEN"
        ? 403
        : code.includes("NOT_FOUND")
          ? 404
          : [
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
    return new URL(origin).origin === new URL(request.url).origin;
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
      return response(
        await services.leads.listLeads(principal, listFilters(url)),
      );
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
      return response(detail);
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

    return response({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    const mapped = safeError(error);
    return response({ error: mapped.code }, mapped.status);
  }
}

export type { AuthPrincipal, AuthRole };
