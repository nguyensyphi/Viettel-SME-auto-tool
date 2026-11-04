import { randomUUID } from "node:crypto";
import type { AuthPrincipal, AuthRole } from "@am-sme/auth";
import {
  evaluateContactTaskEligibility,
  type ContactTaskEligibility,
  type ContactabilityStatus,
} from "@am-sme/domain/contactability";

export interface LeadWorkspaceSqlDatabase {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, values?: readonly unknown[]): Promise<void>;
  transaction<T>(
    work: (transaction: LeadWorkspaceSqlDatabase) => Promise<T>,
  ): Promise<T>;
}

interface PrismaRawExecutor {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

interface PrismaTransactionHost extends PrismaRawExecutor {
  $transaction<T>(
    work: (transaction: PrismaRawExecutor) => Promise<T>,
  ): Promise<T>;
}

/** Adapt Prisma's interactive transaction API to the SQL port used by this package. */
export function createPrismaLeadWorkspaceDatabase(
  client: PrismaTransactionHost,
): LeadWorkspaceSqlDatabase {
  const wrap = (executor: PrismaRawExecutor): LeadWorkspaceSqlDatabase => ({
    async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
      return (await executor.$queryRawUnsafe<T[]>(sql, ...values)) as T[];
    },
    async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
      await executor.$executeRawUnsafe(sql, ...values);
    },
    async transaction<T>(
      work: (transaction: LeadWorkspaceSqlDatabase) => Promise<T>,
    ): Promise<T> {
      if (!("$transaction" in executor)) {
        throw new Error(
          "A root Prisma client is required to begin a transaction",
        );
      }
      return (executor as PrismaTransactionHost).$transaction((transaction) =>
        work(wrap(transaction)),
      );
    },
  });
  return wrap(client);
}

export type LeadStage =
  | "PENDING_REVIEW"
  | "NEW"
  | "QUALIFIED"
  | "CONTACTED"
  | "MEETING_SET"
  | "PROPOSAL"
  | "WON"
  | "LOST";
export type LeadSourceType =
  | "AM_ENTERED"
  | "CUSTOMER_REQUEST"
  | "REFERRAL"
  | "WEB_SOURCE"
  | "IMPORTED"
  | "OTHER";
export type ContactBasis =
  | "UNKNOWN"
  | "CUSTOMER_REQUEST"
  | "EXISTING_RELATIONSHIP"
  | "CONSENT_RECORDED"
  | "OTHER_REVIEW_REQUIRED";
export type ContactChannel = "PHONE" | "EMAIL" | "SMS" | "ZALO" | "TELEGRAM";
export type SuppressionReason =
  "OPT_OUT" | "COMPLAINT" | "LEGAL_REQUEST" | "ADMINISTRATIVE" | "OTHER";
export type ProductInterestStatus = "UNREVIEWED" | "AM_CONFIRMED" | "REJECTED";

export class LeadWorkspaceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LeadWorkspaceError";
  }
}

export interface CreateLeadInput {
  readonly companyName: string;
  readonly industry?: string | null;
  readonly district?: string | null;
  readonly province?: string | null;
  readonly website?: string | null;
  readonly businessAddress?: string | null;
  readonly ownerUserId?: string | null;
  readonly contact?: {
    readonly contactName?: string | null;
    readonly jobTitle?: string | null;
    readonly phoneNormalized?: string | null;
    readonly emailNormalized?: string | null;
  };
  readonly source?: AddLeadSourceInput;
}

export interface UpdateLeadInput {
  readonly companyName?: string;
  readonly industry?: string | null;
  readonly district?: string | null;
  readonly province?: string | null;
  readonly website?: string | null;
  readonly businessAddress?: string | null;
  readonly contact?: {
    readonly contactId: string;
    readonly contactName?: string | null;
    readonly jobTitle?: string | null;
    readonly phoneNormalized?: string | null;
    readonly emailNormalized?: string | null;
  };
}

export interface AddLeadSourceInput {
  readonly leadId: string;
  readonly sourceType: LeadSourceType;
  readonly sourceLabel?: string | null;
  readonly sourceUrl?: string | null;
  readonly collectedAt?: Date | null;
  readonly contactBasis: ContactBasis;
}

export interface ReviewContactabilityInput {
  readonly leadId: string;
  readonly contactId: string;
  readonly channel: ContactChannel;
  readonly status: "REVIEW_REQUIRED" | "ALLOWED_FOR_RECORDED_PURPOSE";
  readonly purpose: string;
  readonly evidenceReference?: string | null;
  readonly capturedAt?: Date | null;
}

export interface SuppressContactInput {
  readonly leadId: string;
  readonly contactId: string;
  readonly reason: SuppressionReason;
}

export interface ListLeadsFilter {
  readonly search?: string;
  readonly stage?: LeadStage;
  readonly ownerUserId?: string;
  readonly contactabilityStatus?: ContactabilityStatus;
  readonly sourceType?: LeadSourceType;
  readonly limit?: number;
  readonly offset?: number;
}

export interface LeadListItem {
  readonly id: string;
  readonly companyName: string;
  readonly industry: string | null;
  readonly district: string | null;
  readonly province: string | null;
  readonly stage: LeadStage;
  readonly ownerUserId: string | null;
  readonly ownerName: string | null;
  readonly contacts: readonly MaskedLeadContact[];
  readonly updatedAt: Date;
}

export interface MaskedLeadContact {
  readonly id: string;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly contactabilityStatus: ContactabilityStatus;
}

export interface LeadTimelineItem {
  readonly kind:
    | "STAGE_CHANGED"
    | "AUDIT"
    | "SOURCE_ADDED"
    | "NOTE_ADDED"
    | "NOTE_UPDATED"
    | "PRODUCT_INTEREST_UPDATED";
  readonly id: string;
  readonly action: string;
  readonly at: Date;
  readonly actorId: string | null;
  readonly changedFieldNames: readonly string[];
  readonly beforeStage?: LeadStage | null;
  readonly afterStage?: LeadStage | null;
  readonly beforeContactabilityStatus?: ContactabilityStatus | null;
  readonly afterContactabilityStatus?: ContactabilityStatus | null;
}

export interface LeadDetail {
  readonly id: string;
  readonly companyName: string;
  readonly industry: string | null;
  readonly district: string | null;
  readonly province: string | null;
  readonly website: string | null;
  readonly businessAddress: string | null;
  readonly stage: LeadStage;
  readonly ownerUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly contacts: readonly MaskedLeadContact[];
  readonly sources: readonly {
    readonly id: string;
    readonly sourceType: LeadSourceType;
    readonly sourceLabel: string | null;
    readonly sourceUrl: string | null;
    readonly collectedAt: Date | null;
    readonly contactBasis: ContactBasis;
    readonly recordedByUserId: string;
    readonly createdAt: Date;
  }[];
  readonly consentReviews: readonly {
    readonly contactId: string;
    readonly channel: ContactChannel;
    readonly purpose: string;
    readonly status: string;
    readonly capturedAt: Date | null;
    readonly evidencePresent: boolean;
    readonly recordedByUserId: string;
    readonly createdAt: Date;
  }[];
  readonly suppressions: readonly {
    readonly contactId: string;
    readonly channel: ContactChannel;
    readonly reason: SuppressionReason;
    readonly createdAt: Date;
  }[];
  readonly notes: readonly {
    readonly id: string;
    readonly content: string;
    readonly authorUserId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }[];
  readonly productInterests: readonly {
    readonly id: string;
    readonly productCode: string | null;
    readonly productName: string;
    readonly status: ProductInterestStatus;
    readonly recordedByUserId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }[];
  readonly timeline: readonly LeadTimelineItem[];
}

interface ActorContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: AuthRole;
  readonly teamId: string | null;
}

interface ActorRow {
  role: AuthRole;
  teamId: string | null;
}

interface LeadScopeRow {
  id: string;
  workspaceId: string;
  companyName: string;
  normalizedCompanyName: string;
  industry: string | null;
  district: string | null;
  province: string | null;
  website: string | null;
  businessAddress: string | null;
  stage: LeadStage;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerTeamId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactRow {
  id: string;
  leadId: string;
  contactName: string | null;
  jobTitle?: string | null;
  phoneNormalized: string | null;
  emailNormalized: string | null;
  contactabilityStatus: ContactabilityStatus;
}

interface AuditOptions {
  readonly beforeStage?: LeadStage | null;
  readonly afterStage?: LeadStage | null;
  readonly beforeContactabilityStatus?: ContactabilityStatus | null;
  readonly afterContactabilityStatus?: ContactabilityStatus | null;
  readonly beforeConsentStatus?: string | null;
  readonly afterConsentStatus?: string | null;
}

const STAGES = new Set<LeadStage>([
  "PENDING_REVIEW",
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "MEETING_SET",
  "PROPOSAL",
  "WON",
  "LOST",
]);
const SOURCE_TYPES = new Set<LeadSourceType>([
  "AM_ENTERED",
  "CUSTOMER_REQUEST",
  "REFERRAL",
  "WEB_SOURCE",
  "IMPORTED",
  "OTHER",
]);
const CONTACT_BASES = new Set<ContactBasis>([
  "UNKNOWN",
  "CUSTOMER_REQUEST",
  "EXISTING_RELATIONSHIP",
  "CONSENT_RECORDED",
  "OTHER_REVIEW_REQUIRED",
]);
const CONTACT_CHANNELS: readonly ContactChannel[] = [
  "PHONE",
  "EMAIL",
  "SMS",
  "ZALO",
  "TELEGRAM",
];
const SUPPRESSION_REASONS = new Set<SuppressionReason>([
  "OPT_OUT",
  "COMPLAINT",
  "LEGAL_REQUEST",
  "ADMINISTRATIVE",
  "OTHER",
]);
const PRODUCT_STATUSES = new Set<ProductInterestStatus>([
  "UNREVIEWED",
  "AM_CONFIRMED",
  "REJECTED",
]);
const ACTIONABLE_BASES = new Set<ContactBasis>([
  "CUSTOMER_REQUEST",
  "EXISTING_RELATIONSHIP",
  "CONSENT_RECORDED",
]);
const STAGE_EDGES: Readonly<Record<LeadStage, readonly LeadStage[]>> = {
  PENDING_REVIEW: ["NEW"],
  NEW: ["QUALIFIED"],
  QUALIFIED: ["CONTACTED"],
  CONTACTED: ["MEETING_SET"],
  MEETING_SET: ["PROPOSAL"],
  PROPOSAL: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

function fail(code: string): never {
  throw new LeadWorkspaceError(code);
}

function boundedText(
  value: string | null | undefined,
  max: number,
  code: string,
  required = false,
): string | null {
  if (value === null || value === undefined) {
    if (required) fail(code);
    return null;
  }
  const trimmed = value.trim();
  if ((!trimmed && required) || trimmed.length > max) fail(code);
  return trimmed || null;
}

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("vi-VN");
}

function validateUrl(value: string | null): void {
  if (value === null) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("INVALID_SOURCE_URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail("INVALID_SOURCE_URL");
  }
}

function validateDate(
  value: Date | null | undefined,
  code: string,
): Date | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail(code);
  return value;
}

function validateContactRoute(
  phone: string | null | undefined,
  email: string | null | undefined,
): { phone: string | null; email: string | null } {
  const normalizedPhone = boundedText(phone, 32, "INVALID_PHONE");
  const normalizedEmail = boundedText(email, 320, "INVALID_EMAIL");
  if (normalizedPhone && !/^\+[1-9]\d{7,14}$/u.test(normalizedPhone)) {
    fail("INVALID_PHONE");
  }
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)) {
    fail("INVALID_EMAIL");
  }
  return {
    phone: normalizedPhone,
    email: normalizedEmail?.toLowerCase() ?? null,
  };
}

function maskName(value: string | null): string | null {
  if (!value) return null;
  const words = value.trim().split(/\s+/u);
  if (!words[0]) return null;
  const first = `${Array.from(words[0])[0] ?? "*"}***`;
  return [first, ...words.slice(1)].join(" ");
}

function maskPhone(value: string | null): string | null {
  if (!value) return null;
  const prefix = value.startsWith("+84") ? "+84" : value.slice(0, 2);
  const suffix = value.slice(-4);
  return `${prefix}${"•".repeat(Math.max(4, value.length - prefix.length - 4))}${suffix}`;
}

function maskEmail(value: string | null): string | null {
  if (!value) return null;
  const [local, domain] = value.split("@");
  if (!local || !domain) return "••••";
  const first = Array.from(local)[0] ?? "•";
  const last = Array.from(local).at(-1) ?? "•";
  return `${first}${"*".repeat(Math.max(3, Array.from(local).length - 2))}${last}@${domain}`;
}

function maskContact(row: ContactRow): MaskedLeadContact {
  return {
    id: row.id,
    contactName: maskName(row.contactName),
    phone: maskPhone(row.phoneNormalized),
    email: maskEmail(row.emailNormalized),
    contactabilityStatus: row.contactabilityStatus,
  };
}

function sourceUrlOrNull(value: string | null | undefined): string | null {
  const normalized = boundedText(value, 1000, "INVALID_SOURCE_URL");
  validateUrl(normalized);
  return normalized;
}

export class LeadWorkspaceRepository {
  constructor(private readonly database: LeadWorkspaceSqlDatabase) {}

  private async actor(principal: AuthPrincipal): Promise<ActorContext> {
    if (!principal?.userId || !principal.workspaceId) fail("FORBIDDEN");
    const rows = await this.database.query<ActorRow>(
      'SELECT tm."role"::text AS "role", tm."teamId" AS "teamId" FROM "User" u JOIN "TeamMembership" tm ON tm."workspaceId" = u."workspaceId" AND tm."userId" = u."id" WHERE u."workspaceId" = $1 AND u."id" = $2 AND u."status" = \'ACTIVE\'',
      [principal.workspaceId, principal.userId],
    );
    const row = rows[0];
    if (
      !row ||
      row.role !== principal.role ||
      row.teamId !== principal.teamId
    ) {
      fail("FORBIDDEN");
    }
    return {
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      role: row.role,
      teamId: row.teamId,
    };
  }

  private async leadInScope(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    leadId: string,
    lock = false,
  ): Promise<LeadScopeRow> {
    const rows = await database.query<LeadScopeRow>(
      `SELECT l."id", l."workspaceId", l."companyName", l."normalizedCompanyName", l."industry", l."district", l."province", l."website", l."businessAddress", l."stage"::text AS "stage", l."ownerUserId", owner."displayName" AS "ownerName", ownerMembership."teamId" AS "ownerTeamId", l."createdAt", l."updatedAt" FROM "Lead" l LEFT JOIN "User" owner ON owner."workspaceId" = l."workspaceId" AND owner."id" = l."ownerUserId" LEFT JOIN "TeamMembership" ownerMembership ON ownerMembership."workspaceId" = l."workspaceId" AND ownerMembership."userId" = l."ownerUserId" WHERE l."workspaceId" = $1 AND l."id" = $2${lock ? " FOR UPDATE OF l" : ""}`,
      [actor.workspaceId, leadId],
    );
    const lead = rows[0];
    if (!lead) fail("NOT_FOUND_OR_FORBIDDEN");
    const allowed =
      actor.role === "ADMIN" ||
      (actor.role === "AM" && lead.ownerUserId === actor.userId) ||
      (actor.role === "MANAGER" &&
        actor.teamId !== null &&
        lead.ownerTeamId === actor.teamId);
    if (!allowed) fail("NOT_FOUND_OR_FORBIDDEN");
    return lead;
  }

  private async audit(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    input: {
      readonly action: string;
      readonly entityType:
        "Lead" | "LeadContact" | "ConsentRecord" | "SuppressionRecord";
      readonly entityId: string;
      readonly changedFieldNames: readonly string[];
    } & AuditOptions,
  ): Promise<string> {
    const id = randomUUID();
    await database.execute(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "changedFieldNames", "beforeStage", "afterStage", "beforeContactabilityStatus", "afterContactabilityStatus", "beforeConsentStatus", "afterConsentStatus") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [
        id,
        actor.workspaceId,
        actor.userId,
        actor.role,
        input.action,
        input.entityType,
        input.entityId,
        [...input.changedFieldNames],
        input.beforeStage ?? null,
        input.afterStage ?? null,
        input.beforeContactabilityStatus ?? null,
        input.afterContactabilityStatus ?? null,
        input.beforeConsentStatus ?? null,
        input.afterConsentStatus ?? null,
      ],
    );
    return id;
  }

  private async assertAssignable(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    ownerUserId: string,
  ): Promise<void> {
    const rows = await database.query<{ teamId: string | null }>(
      'SELECT tm."teamId" AS "teamId" FROM "User" u JOIN "TeamMembership" tm ON tm."workspaceId" = u."workspaceId" AND tm."userId" = u."id" WHERE u."workspaceId" = $1 AND u."id" = $2 AND u."status" = \'ACTIVE\' AND tm."role" = \'AM\'',
      [actor.workspaceId, ownerUserId],
    );
    const target = rows[0];
    if (!target) fail("ASSIGNMENT_TARGET_INVALID");
    if (
      actor.role === "MANAGER" &&
      (actor.teamId === null || target.teamId !== actor.teamId)
    ) {
      fail("ASSIGNMENT_OUT_OF_SCOPE");
    }
    if (actor.role === "AM") fail("FORBIDDEN");
  }

  private async insertSource(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    input: AddLeadSourceInput,
  ): Promise<string> {
    if (
      !SOURCE_TYPES.has(input.sourceType) ||
      !CONTACT_BASES.has(input.contactBasis)
    ) {
      fail("INVALID_SOURCE");
    }
    const sourceLabel = boundedText(input.sourceLabel, 160, "INVALID_SOURCE");
    const sourceUrl = sourceUrlOrNull(input.sourceUrl);
    if (input.sourceType === "WEB_SOURCE" && !sourceUrl)
      fail("INVALID_SOURCE_URL");
    const collectedAt = validateDate(input.collectedAt, "INVALID_SOURCE_DATE");
    const sourceId = randomUUID();
    await database.execute(
      'INSERT INTO "LeadSource" ("id", "workspaceId", "leadId", "sourceType", "sourceLabel", "sourceUrl", "collectedAt", "contactBasis", "recordedByUserId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        sourceId,
        actor.workspaceId,
        input.leadId,
        input.sourceType,
        sourceLabel,
        sourceUrl,
        collectedAt,
        input.contactBasis,
        actor.userId,
      ],
    );
    await this.audit(database, actor, {
      action: "LEAD_SOURCE_ADDED",
      entityType: "Lead",
      entityId: input.leadId,
      changedFieldNames: [
        "sourceType",
        "sourceLabel",
        "sourceUrl",
        "contactBasis",
      ],
    });
    return sourceId;
  }

  async createLead(
    principal: AuthPrincipal,
    input: CreateLeadInput,
  ): Promise<{ leadId: string; contactId: string | null }> {
    const actor = await this.actor(principal);
    const companyName = boundedText(
      input.companyName,
      200,
      "INVALID_COMPANY_NAME",
      true,
    )!;
    const normalizedCompanyName = normalizeCompanyName(companyName);
    if (!normalizedCompanyName || normalizedCompanyName.length > 200)
      fail("INVALID_COMPANY_NAME");
    const industry = boundedText(input.industry, 120, "INVALID_INDUSTRY");
    const district = boundedText(input.district, 120, "INVALID_DISTRICT");
    const province = boundedText(input.province, 120, "INVALID_PROVINCE");
    const website = sourceUrlOrNull(input.website);
    const businessAddress = boundedText(
      input.businessAddress,
      500,
      "INVALID_BUSINESS_ADDRESS",
    );
    let ownerUserId: string | null;
    if (actor.role === "AM") {
      if (input.ownerUserId && input.ownerUserId !== actor.userId)
        fail("FORBIDDEN");
      ownerUserId = actor.userId;
    } else if (actor.role === "MANAGER") {
      if (!input.ownerUserId) fail("ASSIGNMENT_TARGET_REQUIRED");
      ownerUserId = input.ownerUserId;
    } else {
      ownerUserId = input.ownerUserId ?? null;
    }
    const leadId = randomUUID();
    let contactId: string | null = null;
    await this.database.transaction(async (transaction) => {
      if (ownerUserId && actor.role !== "AM") {
        await this.assertAssignable(transaction, actor, ownerUserId);
      }
      await transaction.execute(
        'INSERT INTO "Lead" ("id", "workspaceId", "companyName", "normalizedCompanyName", "industry", "district", "province", "website", "businessAddress", "stage", "ownerUserId", "createdByUserId", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, \'PENDING_REVIEW\', $10, $11, CURRENT_TIMESTAMP)',
        [
          leadId,
          actor.workspaceId,
          companyName,
          normalizedCompanyName,
          industry,
          district,
          province,
          website,
          businessAddress,
          ownerUserId,
          actor.userId,
        ],
      );
      if (input.contact) {
        const contactName = boundedText(
          input.contact.contactName,
          160,
          "INVALID_CONTACT",
        );
        const jobTitle = boundedText(
          input.contact.jobTitle,
          120,
          "INVALID_CONTACT",
        );
        const routes = validateContactRoute(
          input.contact.phoneNormalized,
          input.contact.emailNormalized,
        );
        if (!contactName && !jobTitle && !routes.phone && !routes.email)
          fail("INVALID_CONTACT");
        contactId = randomUUID();
        await transaction.execute(
          'INSERT INTO "LeadContact" ("id", "workspaceId", "leadId", "contactName", "jobTitle", "phoneNormalized", "emailNormalized", "contactabilityStatus", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, \'UNKNOWN\', CURRENT_TIMESTAMP)',
          [
            contactId,
            actor.workspaceId,
            leadId,
            contactName,
            jobTitle,
            routes.phone,
            routes.email,
          ],
        );
      }
      if (input.source)
        await this.insertSource(transaction, actor, {
          ...input.source,
          leadId,
        });
      await this.audit(transaction, actor, {
        action: "LEAD_CREATED",
        entityType: "Lead",
        entityId: leadId,
        changedFieldNames: [
          "companyName",
          "industry",
          "district",
          "province",
          "website",
          "businessAddress",
          "ownerUserId",
          ...(contactId ? ["contact"] : []),
        ],
      });
    });
    return { leadId, contactId };
  }

  async listLeads(
    principal: AuthPrincipal,
    filter: ListLeadsFilter = {},
  ): Promise<{
    items: readonly LeadListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const actor = await this.actor(principal);
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      fail("INVALID_PAGINATION");
    }
    if (filter.stage && !STAGES.has(filter.stage)) fail("INVALID_STAGE");
    if (filter.sourceType && !SOURCE_TYPES.has(filter.sourceType))
      fail("INVALID_SOURCE");
    const where = [
      'l."workspaceId" = $1',
      "(($2 = 'ADMIN') OR ($2 = 'AM' AND l.\"ownerUserId\" = $3) OR ($2 = 'MANAGER' AND $4::uuid IS NOT NULL AND ownerMembership.\"teamId\" = $4))",
    ];
    const values: unknown[] = [
      actor.workspaceId,
      actor.role,
      actor.userId,
      actor.teamId,
    ];
    const addFilter = (clause: string, value: unknown): void => {
      values.push(value);
      where.push(clause.replace("?", `$${values.length}`));
    };
    if (filter.stage) addFilter('l."stage" = ?::"LeadStage"', filter.stage);
    if (filter.ownerUserId)
      addFilter('l."ownerUserId" = ?::uuid', filter.ownerUserId);
    if (filter.contactabilityStatus) {
      addFilter(
        'EXISTS (SELECT 1 FROM "LeadContact" c WHERE c."workspaceId" = l."workspaceId" AND c."leadId" = l."id" AND c."contactabilityStatus" = ?::"ContactabilityStatus")',
        filter.contactabilityStatus,
      );
    }
    if (filter.sourceType) {
      addFilter(
        'EXISTS (SELECT 1 FROM "LeadSource" s WHERE s."workspaceId" = l."workspaceId" AND s."leadId" = l."id" AND s."sourceType" = ?::"LeadSourceType")',
        filter.sourceType,
      );
    }
    if (filter.search?.trim()) {
      const query = `%${filter.search.trim().replace(/[\\%_]/gu, "\\$&")}%`;
      values.push(query);
      const placeholder = `$${values.length}`;
      where.push(
        `(l."companyName" ILIKE ${placeholder} ESCAPE E'\\\\' OR COALESCE(l."industry", '') ILIKE ${placeholder} ESCAPE E'\\\\' OR COALESCE(l."district", '') ILIKE ${placeholder} ESCAPE E'\\\\' OR EXISTS (SELECT 1 FROM "LeadSource" s WHERE s."workspaceId" = l."workspaceId" AND s."leadId" = l."id" AND COALESCE(s."sourceLabel", '') ILIKE ${placeholder} ESCAPE E'\\\\'))`,
      );
    }
    const whereSql = where.join(" AND ");
    const countRows = await this.database.query<{ total: number }>(
      `SELECT count(*)::int AS "total" FROM "Lead" l LEFT JOIN "TeamMembership" ownerMembership ON ownerMembership."workspaceId" = l."workspaceId" AND ownerMembership."userId" = l."ownerUserId" WHERE ${whereSql}`,
      values,
    );
    const pageValues = [...values, limit, offset];
    const pageRows = await this.database.query<LeadScopeRow>(
      `SELECT l."id", l."workspaceId", l."companyName", l."normalizedCompanyName", l."industry", l."district", l."province", l."website", l."businessAddress", l."stage"::text AS "stage", l."ownerUserId", owner."displayName" AS "ownerName", ownerMembership."teamId" AS "ownerTeamId", l."createdAt", l."updatedAt" FROM "Lead" l LEFT JOIN "User" owner ON owner."workspaceId" = l."workspaceId" AND owner."id" = l."ownerUserId" LEFT JOIN "TeamMembership" ownerMembership ON ownerMembership."workspaceId" = l."workspaceId" AND ownerMembership."userId" = l."ownerUserId" WHERE ${whereSql} ORDER BY l."updatedAt" DESC, l."id" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    );
    const ids = pageRows.map((row) => row.id);
    const contacts = ids.length
      ? await this.database.query<ContactRow>(
          'SELECT "id", "leadId", "contactName", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = ANY($2::uuid[]) ORDER BY "createdAt"',
          [actor.workspaceId, ids],
        )
      : [];
    const byLead = new Map<string, MaskedLeadContact[]>();
    for (const contact of contacts) {
      const bucket = byLead.get(contact.leadId) ?? [];
      bucket.push(maskContact(contact));
      byLead.set(contact.leadId, bucket);
    }
    return {
      items: pageRows.map((lead) => ({
        id: lead.id,
        companyName: lead.companyName,
        industry: lead.industry,
        district: lead.district,
        province: lead.province,
        stage: lead.stage,
        ownerUserId: lead.ownerUserId,
        ownerName: lead.ownerName,
        contacts: byLead.get(lead.id) ?? [],
        updatedAt: lead.updatedAt,
      })),
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    };
  }

  async getLeadDetail(
    principal: AuthPrincipal,
    leadId: string,
  ): Promise<LeadDetail> {
    const actor = await this.actor(principal);
    const lead = await this.leadInScope(this.database, actor, leadId);
    const [
      contactRows,
      sourceRows,
      consentRows,
      suppressionRows,
      noteRows,
      interestRows,
    ] = await Promise.all([
      this.database.query<ContactRow>(
        'SELECT "id", "leadId", "contactName", "jobTitle", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 ORDER BY "createdAt"',
        [actor.workspaceId, leadId],
      ),
      this.database.query<LeadDetail["sources"][number]>(
        'SELECT "id", "sourceType"::text AS "sourceType", "sourceLabel", "sourceUrl", "collectedAt", "contactBasis"::text AS "contactBasis", "recordedByUserId", "createdAt" FROM "LeadSource" WHERE "workspaceId" = $1 AND "leadId" = $2 ORDER BY "createdAt" DESC',
        [actor.workspaceId, leadId],
      ),
      this.database.query<{
        contactId: string;
        channel: ContactChannel;
        purpose: string;
        status: string;
        capturedAt: Date | null;
        evidencePresent: boolean;
        recordedByUserId: string;
        createdAt: Date;
      }>(
        'SELECT cr."leadContactId" AS "contactId", cr."channel"::text AS "channel", cr."purpose", cr."status"::text AS "status", cr."capturedAt", (cr."evidenceReference" IS NOT NULL AND cr."evidenceReference" <> \'\') AS "evidencePresent", cr."recordedByUserId", cr."createdAt" FROM "ConsentRecord" cr WHERE cr."workspaceId" = $1 AND cr."leadContactId" IN (SELECT c."id" FROM "LeadContact" c WHERE c."workspaceId" = $1 AND c."leadId" = $2) ORDER BY cr."createdAt" DESC',
        [actor.workspaceId, leadId],
      ),
      this.database.query<{
        contactId: string;
        channel: ContactChannel;
        reason: SuppressionReason;
        createdAt: Date;
      }>(
        'SELECT sr."leadContactId" AS "contactId", sr."channel"::text AS "channel", sr."reason"::text AS "reason", sr."createdAt" FROM "SuppressionRecord" sr WHERE sr."workspaceId" = $1 AND sr."leadContactId" IN (SELECT c."id" FROM "LeadContact" c WHERE c."workspaceId" = $1 AND c."leadId" = $2) ORDER BY sr."createdAt" DESC',
        [actor.workspaceId, leadId],
      ),
      this.database.query<LeadDetail["notes"][number]>(
        'SELECT "id", "content", "authorUserId", "createdAt", "updatedAt" FROM "LeadNote" WHERE "workspaceId" = $1 AND "leadId" = $2 ORDER BY "createdAt" DESC',
        [actor.workspaceId, leadId],
      ),
      this.database.query<LeadDetail["productInterests"][number]>(
        'SELECT "id", "productCode", "productName", "status"::text AS "status", "recordedByUserId", "createdAt", "updatedAt" FROM "ProductInterest" WHERE "workspaceId" = $1 AND "leadId" = $2 ORDER BY "updatedAt" DESC',
        [actor.workspaceId, leadId],
      ),
    ]);
    const entityIds = [leadId, ...contactRows.map((contact) => contact.id)];
    const auditRows = entityIds.length
      ? await this.database.query<{
          id: string;
          action: string;
          entityType: string;
          entityId: string;
          actorId: string | null;
          changedFieldNames: string[];
          beforeStage: LeadStage | null;
          afterStage: LeadStage | null;
          beforeContactabilityStatus: ContactabilityStatus | null;
          afterContactabilityStatus: ContactabilityStatus | null;
          createdAt: Date;
        }>(
          'SELECT "id", "action", "entityType", "entityId", "actorId", "changedFieldNames", "beforeStage"::text AS "beforeStage", "afterStage"::text AS "afterStage", "beforeContactabilityStatus"::text AS "beforeContactabilityStatus", "afterContactabilityStatus"::text AS "afterContactabilityStatus", "createdAt" FROM "AuditEvent" WHERE "workspaceId" = $1 AND (("entityType" = \'Lead\' AND "entityId" = $2) OR ("entityType" = \'LeadContact\' AND "entityId" = ANY($3::text[]))) ORDER BY "createdAt" DESC',
          [actor.workspaceId, leadId, contactRows.map((contact) => contact.id)],
        )
      : [];
    const timeline: LeadTimelineItem[] = [
      ...auditRows.map((event) => ({
        kind:
          event.beforeStage || event.afterStage
            ? ("STAGE_CHANGED" as const)
            : event.action === "LEAD_SOURCE_ADDED"
              ? ("SOURCE_ADDED" as const)
              : event.action === "LEAD_NOTE_ADDED"
                ? ("NOTE_ADDED" as const)
                : event.action === "LEAD_NOTE_UPDATED"
                  ? ("NOTE_UPDATED" as const)
                  : event.action === "PRODUCT_INTEREST_UPDATED"
                    ? ("PRODUCT_INTEREST_UPDATED" as const)
                    : ("AUDIT" as const),
        id: event.id,
        action: event.action,
        at: event.createdAt,
        actorId: event.actorId,
        changedFieldNames: event.changedFieldNames,
        ...(event.beforeStage !== null
          ? { beforeStage: event.beforeStage }
          : {}),
        ...(event.afterStage !== null ? { afterStage: event.afterStage } : {}),
        ...(event.beforeContactabilityStatus !== null
          ? { beforeContactabilityStatus: event.beforeContactabilityStatus }
          : {}),
        ...(event.afterContactabilityStatus !== null
          ? { afterContactabilityStatus: event.afterContactabilityStatus }
          : {}),
      })),
    ].sort((left, right) => right.at.getTime() - left.at.getTime());
    return {
      id: lead.id,
      companyName: lead.companyName,
      industry: lead.industry,
      district: lead.district,
      province: lead.province,
      website: lead.website,
      businessAddress: lead.businessAddress,
      stage: lead.stage,
      ownerUserId: lead.ownerUserId,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      contacts: contactRows.map(maskContact),
      sources: sourceRows,
      consentReviews: consentRows,
      suppressions: suppressionRows,
      notes: noteRows,
      productInterests: interestRows,
      timeline,
    };
  }

  async updateLead(
    principal: AuthPrincipal,
    leadId: string,
    input: UpdateLeadInput,
  ): Promise<void> {
    const actor = await this.actor(principal);
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, leadId, true);
      const assignments: string[] = [];
      const values: unknown[] = [actor.workspaceId, leadId];
      const fields: string[] = [];
      const set = (column: string, fieldName: string, value: unknown): void => {
        values.push(value);
        assignments.push(`"${column}" = $${values.length}`);
        fields.push(fieldName);
      };
      if (input.companyName !== undefined) {
        const companyName = boundedText(
          input.companyName,
          200,
          "INVALID_COMPANY_NAME",
          true,
        )!;
        const normalized = normalizeCompanyName(companyName);
        if (!normalized || normalized.length > 200)
          fail("INVALID_COMPANY_NAME");
        set("companyName", "companyName", companyName);
        set("normalizedCompanyName", "normalizedCompanyName", normalized);
      }
      if (input.industry !== undefined)
        set(
          "industry",
          "industry",
          boundedText(input.industry, 120, "INVALID_INDUSTRY"),
        );
      if (input.district !== undefined)
        set(
          "district",
          "district",
          boundedText(input.district, 120, "INVALID_DISTRICT"),
        );
      if (input.province !== undefined)
        set(
          "province",
          "province",
          boundedText(input.province, 120, "INVALID_PROVINCE"),
        );
      if (input.website !== undefined)
        set("website", "website", sourceUrlOrNull(input.website));
      if (input.businessAddress !== undefined)
        set(
          "businessAddress",
          "businessAddress",
          boundedText(input.businessAddress, 500, "INVALID_BUSINESS_ADDRESS"),
        );
      if (assignments.length) {
        assignments.push('"updatedAt" = CURRENT_TIMESTAMP');
        await transaction.execute(
          `UPDATE "Lead" SET ${assignments.join(", ")} WHERE "workspaceId" = $1 AND "id" = $2`,
          values,
        );
      }
      if (input.contact) {
        const current = await transaction.query<ContactRow>(
          'SELECT "id", "leadId", "contactName", "jobTitle", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3 FOR UPDATE',
          [actor.workspaceId, leadId, input.contact.contactId],
        );
        const contact = current[0];
        if (!contact) fail("NOT_FOUND_OR_FORBIDDEN");
        const contactAssignments: string[] = [];
        const contactValues: unknown[] = [
          actor.workspaceId,
          leadId,
          contact.id,
        ];
        const setContact = (
          column: string,
          fieldName: string,
          value: unknown,
        ): void => {
          contactValues.push(value);
          contactAssignments.push(`"${column}" = $${contactValues.length}`);
          fields.push(fieldName);
        };
        if (input.contact.contactName !== undefined)
          setContact(
            "contactName",
            "contactName",
            boundedText(input.contact.contactName, 160, "INVALID_CONTACT"),
          );
        if (input.contact.jobTitle !== undefined)
          setContact(
            "jobTitle",
            "jobTitle",
            boundedText(input.contact.jobTitle, 120, "INVALID_CONTACT"),
          );
        const routes = validateContactRoute(
          input.contact.phoneNormalized,
          input.contact.emailNormalized,
        );
        if (input.contact.phoneNormalized !== undefined)
          setContact("phoneNormalized", "phoneNormalized", routes.phone);
        if (input.contact.emailNormalized !== undefined)
          setContact("emailNormalized", "emailNormalized", routes.email);
        if (contactAssignments.length) {
          contactAssignments.push('"updatedAt" = CURRENT_TIMESTAMP');
          await transaction.execute(
            `UPDATE "LeadContact" SET ${contactAssignments.join(", ")} WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3`,
            contactValues,
          );
        }
      }
      if (!fields.length) fail("EMPTY_UPDATE");
      await this.audit(transaction, actor, {
        action: "LEAD_UPDATED",
        entityType: "Lead",
        entityId: leadId,
        changedFieldNames: [...new Set(fields)],
      });
    });
  }

  async assignLead(
    principal: AuthPrincipal,
    leadId: string,
    ownerUserId: string,
  ): Promise<void> {
    const actor = await this.actor(principal);
    if (actor.role === "AM") fail("FORBIDDEN");
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, leadId, true);
      await this.assertAssignable(transaction, actor, ownerUserId);
      await transaction.execute(
        'UPDATE "Lead" SET "ownerUserId" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "id" = $3',
        [ownerUserId, actor.workspaceId, leadId],
      );
      await this.audit(transaction, actor, {
        action: "LEAD_ASSIGNED",
        entityType: "Lead",
        entityId: leadId,
        changedFieldNames: ["ownerUserId"],
      });
    });
  }

  async transitionStage(
    principal: AuthPrincipal,
    leadId: string,
    nextStage: LeadStage,
  ): Promise<void> {
    if (!STAGES.has(nextStage)) fail("INVALID_STAGE");
    const actor = await this.actor(principal);
    await this.database.transaction(async (transaction) => {
      const lead = await this.leadInScope(transaction, actor, leadId, true);
      if (!STAGE_EDGES[lead.stage].includes(nextStage))
        fail("INVALID_STAGE_TRANSITION");
      if (nextStage === "NEW" || nextStage === "QUALIFIED") {
        const sources = await transaction.query<{ count: number }>(
          'SELECT count(*)::int AS "count" FROM "LeadSource" WHERE "workspaceId" = $1 AND "leadId" = $2',
          [actor.workspaceId, leadId],
        );
        if ((sources[0]?.count ?? 0) === 0) fail("SOURCE_REQUIRED");
      }
      await transaction.execute(
        'UPDATE "Lead" SET "stage" = $1::"LeadStage", "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "id" = $3',
        [nextStage, actor.workspaceId, leadId],
      );
      await this.audit(transaction, actor, {
        action: "LEAD_STAGE_CHANGED",
        entityType: "Lead",
        entityId: leadId,
        changedFieldNames: ["stage"],
        beforeStage: lead.stage,
        afterStage: nextStage,
      });
    });
  }

  async addSource(
    principal: AuthPrincipal,
    input: AddLeadSourceInput,
  ): Promise<{ sourceId: string }> {
    const actor = await this.actor(principal);
    let sourceId = "";
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, input.leadId, true);
      sourceId = await this.insertSource(transaction, actor, input);
    });
    return { sourceId };
  }

  async reviewContactability(
    principal: AuthPrincipal,
    input: ReviewContactabilityInput,
  ): Promise<void> {
    const actor = await this.actor(principal);
    if (
      input.status !== "REVIEW_REQUIRED" &&
      input.status !== "ALLOWED_FOR_RECORDED_PURPOSE"
    )
      fail("INVALID_CONTACTABILITY_STATUS");
    const purpose = boundedText(input.purpose, 160, "INVALID_PURPOSE", true)!;
    const evidenceReference = boundedText(
      input.evidenceReference,
      500,
      "CONSENT_EVIDENCE_REQUIRED",
    );
    const capturedAt = validateDate(input.capturedAt, "INVALID_CONSENT_DATE");
    if (
      input.status === "ALLOWED_FOR_RECORDED_PURPOSE" &&
      (!evidenceReference || !capturedAt)
    )
      fail("CONSENT_EVIDENCE_REQUIRED");
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, input.leadId, true);
      const contacts = await transaction.query<ContactRow>(
        'SELECT "id", "leadId", "contactName", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3 FOR UPDATE',
        [actor.workspaceId, input.leadId, input.contactId],
      );
      const contact = contacts[0];
      if (!contact) fail("NOT_FOUND_OR_FORBIDDEN");
      const priorSuppression = await transaction.query<{ id: string }>(
        'SELECT "id" FROM "SuppressionRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2 LIMIT 1',
        [actor.workspaceId, contact.id],
      );
      if (
        priorSuppression.length ||
        contact.contactabilityStatus === "SUPPRESSED" ||
        contact.contactabilityStatus === "OPTED_OUT"
      )
        fail("SUPPRESSION_ACTIVE");
      if (input.status === "ALLOWED_FOR_RECORDED_PURPOSE") {
        const hasRoute =
          input.channel === "EMAIL"
            ? Boolean(contact.emailNormalized)
            : Boolean(contact.phoneNormalized);
        if (!hasRoute) fail("CONTACT_ROUTE_REQUIRED");
        const bases = await transaction.query<{ contactBasis: ContactBasis }>(
          'SELECT "contactBasis"::text AS "contactBasis" FROM "LeadSource" WHERE "workspaceId" = $1 AND "leadId" = $2',
          [actor.workspaceId, input.leadId],
        );
        if (!bases.some((source) => ACTIONABLE_BASES.has(source.contactBasis)))
          fail("CONTACT_BASIS_REQUIRED");
      }
      const nextContactability: ContactabilityStatus = input.status;
      const priorConsentRows = await transaction.query<{ status: string }>(
        'SELECT "status"::text AS "status" FROM "ConsentRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2 AND "channel" = $3::"ContactChannel" ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
        [actor.workspaceId, contact.id, input.channel],
      );
      const consentId = randomUUID();
      await this.audit(transaction, actor, {
        action: "CONTACTABILITY_REVIEWED",
        entityType: "LeadContact",
        entityId: contact.id,
        changedFieldNames: ["contactabilityStatus", "consentStatus"],
        beforeContactabilityStatus: contact.contactabilityStatus,
        afterContactabilityStatus: nextContactability,
        beforeConsentStatus: priorConsentRows[0]?.status ?? "UNKNOWN",
        afterConsentStatus: input.status,
      });
      const consentAuditId = await this.audit(transaction, actor, {
        action: "CONSENT_RECORDED",
        entityType: "ConsentRecord",
        entityId: consentId,
        changedFieldNames: [
          "channel",
          "purpose",
          "status",
          "capturedAt",
          "evidenceReference",
        ],
        beforeConsentStatus: priorConsentRows[0]?.status ?? "UNKNOWN",
        afterConsentStatus: input.status,
      });
      await transaction.execute(
        'INSERT INTO "ConsentRecord" ("id", "workspaceId", "leadContactId", "channel", "purpose", "status", "capturedAt", "evidenceReference", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, $4, $5, $6::"ConsentStatus", $7, $8, $9, $10)',
        [
          consentId,
          actor.workspaceId,
          contact.id,
          input.channel,
          purpose,
          input.status,
          capturedAt,
          evidenceReference,
          actor.userId,
          consentAuditId,
        ],
      );
      await transaction.execute(
        'UPDATE "LeadContact" SET "contactabilityStatus" = $1::"ContactabilityStatus", "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "leadId" = $3 AND "id" = $4',
        [nextContactability, actor.workspaceId, input.leadId, contact.id],
      );
    });
  }

  async canContact(
    principal: AuthPrincipal,
    leadId: string,
    contactId: string,
    channel: ContactChannel,
  ): Promise<ContactTaskEligibility> {
    const actor = await this.actor(principal);
    await this.leadInScope(this.database, actor, leadId);
    const rows = await this.database.query<ContactRow>(
      'SELECT "id", "leadId", "contactName", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3',
      [actor.workspaceId, leadId, contactId],
    );
    const contact = rows[0];
    if (!contact) fail("NOT_FOUND_OR_FORBIDDEN");
    const [sources, consentRows, suppressions] = await Promise.all([
      this.database.query<{ contactBasis: ContactBasis }>(
        'SELECT "contactBasis"::text AS "contactBasis" FROM "LeadSource" WHERE "workspaceId" = $1 AND "leadId" = $2',
        [actor.workspaceId, leadId],
      ),
      this.database.query<{
        status: string;
        purpose: string;
        capturedAt: Date | null;
        evidenceReference: string | null;
      }>(
        'SELECT "status"::text AS "status", "purpose", "capturedAt", "evidenceReference" FROM "ConsentRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2 AND "channel" = $3::"ContactChannel" ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
        [actor.workspaceId, contact.id, channel],
      ),
      this.database.query<{ id: string }>(
        'SELECT "id" FROM "SuppressionRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2 AND "channel" = $3::"ContactChannel" LIMIT 1',
        [actor.workspaceId, contact.id, channel],
      ),
    ]);
    const consent = consentRows[0];
    const routeAllowed =
      channel === "EMAIL"
        ? Boolean(contact.emailNormalized)
        : Boolean(contact.phoneNormalized);
    const status =
      contact.contactabilityStatus === "SUPPRESSED" ||
      contact.contactabilityStatus === "OPTED_OUT"
        ? contact.contactabilityStatus
        : consent?.status === "ALLOWED_FOR_RECORDED_PURPOSE"
          ? contact.contactabilityStatus
          : consent?.status === "REVIEW_REQUIRED"
            ? "REVIEW_REQUIRED"
            : "UNKNOWN";
    return evaluateContactTaskEligibility({
      status,
      hasSourceEvidence: sources.length > 0,
      hasContactBasis: sources.some((source) =>
        ACTIONABLE_BASES.has(source.contactBasis),
      ),
      hasConsentEvidence: Boolean(consent?.evidenceReference?.trim()),
      channelAllowed: routeAllowed && CONTACT_CHANNELS.includes(channel),
      hasPurpose: Boolean(consent?.purpose.trim()),
      hasConsentTimestamp: Boolean(
        consent?.capturedAt && Number.isFinite(consent.capturedAt.getTime()),
      ),
      suppressed: suppressions.length > 0,
    });
  }

  async suppressContact(
    principal: AuthPrincipal,
    input: SuppressContactInput,
  ): Promise<void> {
    const actor = await this.actor(principal);
    if (!SUPPRESSION_REASONS.has(input.reason))
      fail("INVALID_SUPPRESSION_REASON");
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, input.leadId, true);
      const contacts = await transaction.query<ContactRow>(
        'SELECT "id", "leadId", "contactName", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3 FOR UPDATE',
        [actor.workspaceId, input.leadId, input.contactId],
      );
      const contact = contacts[0];
      if (!contact) fail("NOT_FOUND_OR_FORBIDDEN");
      await transaction.execute(
        'UPDATE "LeadContact" SET "contactabilityStatus" = \'SUPPRESSED\', "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3',
        [actor.workspaceId, input.leadId, contact.id],
      );
      await this.audit(transaction, actor, {
        action: "LEAD_CONTACT_SUPPRESSED",
        entityType: "LeadContact",
        entityId: contact.id,
        changedFieldNames: ["contactabilityStatus", "suppression"],
        beforeContactabilityStatus: contact.contactabilityStatus,
        afterContactabilityStatus: "SUPPRESSED",
      });
      for (const channel of CONTACT_CHANNELS) {
        const suppressionId = randomUUID();
        const auditId = await this.audit(transaction, actor, {
          action: "SUPPRESSION_CREATED",
          entityType: "SuppressionRecord",
          entityId: suppressionId,
          changedFieldNames: ["channel", "reason"],
        });
        await transaction.execute(
          'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, $4::"ContactChannel", $5::"SuppressionReason", $6, $7)',
          [
            suppressionId,
            actor.workspaceId,
            contact.id,
            channel,
            input.reason,
            actor.userId,
            auditId,
          ],
        );
      }
    });
  }

  async addNote(
    principal: AuthPrincipal,
    leadId: string,
    content: string,
  ): Promise<{ noteId: string }> {
    const actor = await this.actor(principal);
    const note = boundedText(content, 5000, "INVALID_NOTE", true)!;
    const noteId = randomUUID();
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, leadId, true);
      await transaction.execute(
        'INSERT INTO "LeadNote" ("id", "workspaceId", "leadId", "authorUserId", "content", "updatedAt") VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
        [noteId, actor.workspaceId, leadId, actor.userId, note],
      );
      await this.audit(transaction, actor, {
        action: "LEAD_NOTE_ADDED",
        entityType: "Lead",
        entityId: leadId,
        changedFieldNames: ["notes"],
      });
    });
    return { noteId };
  }

  async updateNote(
    principal: AuthPrincipal,
    leadId: string,
    noteId: string,
    content: string,
  ): Promise<void> {
    const actor = await this.actor(principal);
    const note = boundedText(content, 5000, "INVALID_NOTE", true)!;
    await this.database.transaction(async (transaction) => {
      await this.leadInScope(transaction, actor, leadId, true);
      const rows = await transaction.query<{ id: string }>(
        'SELECT "id" FROM "LeadNote" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3 FOR UPDATE',
        [actor.workspaceId, leadId, noteId],
      );
      if (!rows[0]) fail("NOT_FOUND_OR_FORBIDDEN");
      await transaction.execute(
        'UPDATE "LeadNote" SET "content" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "leadId" = $3 AND "id" = $4',
        [note, actor.workspaceId, leadId, noteId],
      );
      await this.audit(transaction, actor, {
        action: "LEAD_NOTE_UPDATED",
        entityType: "Lead",
        entityId: leadId,
        changedFieldNames: ["notes"],
      });
    });
  }

  async setProductInterest(
    principal: AuthPrincipal,
    input: {
      readonly leadId: string;
      readonly productCode?: string | null;
      readonly productName: string;
      readonly status: ProductInterestStatus;
    },
  ): Promise<{ productInterestId: string }> {
    const actor = await this.actor(principal);
    const productName = boundedText(
      input.productName,
      160,
      "INVALID_PRODUCT_INTEREST",
      true,
    )!;
    const productCode = boundedText(
      input.productCode,
      80,
      "INVALID_PRODUCT_INTEREST",
    );
    if (!PRODUCT_STATUSES.has(input.status)) fail("INVALID_PRODUCT_INTEREST");
    if (actor.role !== "AM") fail("FORBIDDEN");
    let productInterestId = "";
    await this.database.transaction(async (transaction) => {
      const lead = await this.leadInScope(
        transaction,
        actor,
        input.leadId,
        true,
      );
      if (lead.ownerUserId !== actor.userId) fail("FORBIDDEN");
      const existing = await transaction.query<{ id: string }>(
        productCode
          ? 'SELECT "id" FROM "ProductInterest" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "productCode" = $3 ORDER BY "updatedAt" DESC LIMIT 1 FOR UPDATE'
          : 'SELECT "id" FROM "ProductInterest" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "productCode" IS NULL AND lower("productName") = lower($3) ORDER BY "updatedAt" DESC LIMIT 1 FOR UPDATE',
        [actor.workspaceId, input.leadId, productCode ?? productName],
      );
      productInterestId = existing[0]?.id ?? randomUUID();
      if (existing[0]) {
        await transaction.execute(
          'UPDATE "ProductInterest" SET "productName" = $1, "status" = $2::"ProductInterestStatus", "recordedByUserId" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $4 AND "leadId" = $5 AND "id" = $6',
          [
            productName,
            input.status,
            actor.userId,
            actor.workspaceId,
            input.leadId,
            productInterestId,
          ],
        );
      } else {
        await transaction.execute(
          'INSERT INTO "ProductInterest" ("id", "workspaceId", "leadId", "productCode", "productName", "status", "recordedByUserId", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6::"ProductInterestStatus", $7, CURRENT_TIMESTAMP)',
          [
            productInterestId,
            actor.workspaceId,
            input.leadId,
            productCode,
            productName,
            input.status,
            actor.userId,
          ],
        );
      }
      await this.audit(transaction, actor, {
        action: "PRODUCT_INTEREST_UPDATED",
        entityType: "Lead",
        entityId: input.leadId,
        changedFieldNames: ["productInterest"],
      });
    });
    return { productInterestId };
  }
}
