import { randomUUID } from "node:crypto";
import {
  combineContactabilityStatuses,
  type ContactabilityStatus,
  type ImportSuppressionInstruction,
  type ConsentStatus,
} from "@am-sme/domain/contactability";
import {
  assessImportProvenance,
  createReviewDecision,
  findDuplicateCandidates,
  LEAD_IMPORT_FIELDS,
  type AssessedImportProvenance,
  type ConsentEvidenceInput,
  type CreateReviewDecisionResult,
  type DeduplicationLead,
  type DeduplicationReviewDecision,
  type DuplicateReviewGroup,
  type FindDuplicateCandidatesOptions,
  type ImportIssue,
  type MappedLeadDraft,
  type ReviewDecisionRequest,
} from "@am-sme/excel-import";

export interface ImportSqlDatabase {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, values?: readonly unknown[]): Promise<void>;
  transaction<T>(
    work: (transaction: ImportSqlDatabase) => Promise<T>,
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

/** Adapt the Prisma interactive transaction API to the small SQL port used here. */
export function createPrismaImportDatabase(
  client: PrismaTransactionHost,
): ImportSqlDatabase {
  const wrap = (executor: PrismaRawExecutor): ImportSqlDatabase => ({
    async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
      return (await executor.$queryRawUnsafe<T[]>(sql, ...values)) as T[];
    },
    async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
      await executor.$executeRawUnsafe(sql, ...values);
    },
    async transaction<T>(
      work: (transaction: ImportSqlDatabase) => Promise<T>,
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

export interface CreateImportJobInput {
  readonly workspaceId: string;
  readonly uploaderUserId: string;
  readonly idempotencyKey: string;
  readonly fileChecksum: string;
  readonly totalRows: number;
}

export type CreateImportJobResult =
  | { readonly success: true; readonly jobId: string; readonly reused: boolean }
  | {
      readonly success: false;
      readonly errorCode:
        | "INVALID_JOB_REQUEST"
        | "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_FILE"
        | "DUPLICATE_FILE_CHECKSUM"
        | "IDEMPOTENCY_REQUEST_MISMATCH"
        | "DATABASE_JOB_WRITE_FAILED";
    };

export interface ImportCommitRow {
  readonly rowNumber: number;
  readonly disposition: "KEEP" | "MERGE" | "SKIP";
  readonly lead?: MappedLeadDraft;
  readonly consentEvidence?: ConsentEvidenceInput;
  readonly reviewGroup?: DuplicateReviewGroup;
  readonly reviewRequest?: ReviewDecisionRequest;
  /** Field/code-only validation errors; raw row data must never be passed here. */
  readonly issues: readonly ImportIssue[];
}

export interface CommitImportInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly fileChecksum: string;
  readonly rows: readonly ImportCommitRow[];
}

export type CommitImportResult =
  | {
      readonly success: true;
      readonly status: "COMMITTED";
      readonly jobId: string;
      readonly rowsCommitted: number;
      readonly rowsSkipped: number;
      readonly alreadyCommitted: boolean;
    }
  | {
      readonly success: false;
      readonly status: "REJECTED" | "ROLLED_BACK" | "FAILED";
      readonly jobId: string;
      readonly errorCode: string;
      readonly jobStatusPersisted?: boolean;
    };

interface PreparedRow {
  readonly row: ImportCommitRow;
  readonly provenance: AssessedImportProvenance | null;
  readonly decision: DeduplicationReviewDecision | null;
}

interface JobRow {
  id: string;
  workspaceId: string;
  uploaderUserId: string;
  idempotencyKey: string;
  fileChecksum: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
}

interface ActorRow {
  role: "AM" | "MANAGER" | "ADMIN";
}

interface ContactRow {
  id: string;
  contactabilityStatus: ContactabilityStatus;
}

interface TargetRow {
  id: string;
  companyName: string;
  district: string | null;
}

interface LiveMergeContactRow extends ContactRow {
  phoneNormalized: string | null;
  emailNormalized: string | null;
}

interface LiveConsentRow {
  status: ConsentStatus;
}

interface LiveSuppressionRow {
  reason: string;
}

type ContactChannel = "PHONE" | "EMAIL" | "SMS" | "ZALO" | "TELEGRAM";
const CONTACT_CHANNELS: readonly ContactChannel[] = [
  "PHONE",
  "EMAIL",
  "SMS",
  "ZALO",
  "TELEGRAM",
];
const VALID_CHANNELS = new Set<string>(CONTACT_CHANNELS);

class SafeImportCommitFault extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
  }
}

function isChecksum(value: string): boolean {
  return /^[a-f\d]{64}$/iu.test(value);
}

function isUuid(value: string): boolean {
  return /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(
    value,
  );
}

function toDeduplicationLead(
  lead: MappedLeadDraft,
  provenance: AssessedImportProvenance,
): DeduplicationLead {
  return {
    companyName: lead.company_name,
    contactName: lead.contact_name,
    district: lead.district,
    phoneNormalized: lead.phone_normalized,
    emailNormalized: lead.email_normalized,
    consentStatus: provenance.consentStatus,
    contactabilityStatus: provenance.contactabilityStatus,
    suppressionInstructions: provenance.suppression
      ? [provenance.suppression]
      : [],
  };
}

/** Build the same P0.4a candidate group used by review, with the P0.3 gate applied. */
export function createImportReviewGroup(
  lead: MappedLeadDraft,
  existingLeads: readonly (DeduplicationLead & { readonly id: string })[],
  options: FindDuplicateCandidatesOptions,
  consentEvidence?: ConsentEvidenceInput,
): DuplicateReviewGroup {
  const provenance = assessImportProvenance(lead, consentEvidence);
  return findDuplicateCandidates(
    toDeduplicationLead(lead, provenance),
    existingLeads,
    options,
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateReview(
  row: ImportCommitRow,
  provenance: AssessedImportProvenance | null,
): DeduplicationReviewDecision | null {
  if (row.disposition === "SKIP" && !row.reviewGroup && !row.reviewRequest) {
    return null;
  }
  if (!row.lead) throw new SafeImportCommitFault("MAPPED_LEAD_REQUIRED");
  if (!provenance)
    throw new SafeImportCommitFault("PROVENANCE_ASSESSMENT_REQUIRED");
  if (!row.reviewGroup || !row.reviewRequest) {
    throw new SafeImportCommitFault("REVIEW_DECISION_REQUIRED");
  }
  if (row.reviewRequest.action !== row.disposition) {
    throw new SafeImportCommitFault("REVIEW_DECISION_ACTION_MISMATCH");
  }
  const expectedIncoming = findDuplicateCandidates(
    toDeduplicationLead(row.lead, provenance),
    [],
    { reviewGroupId: row.reviewGroup.reviewGroupId },
  );
  if (
    !sameJson(row.reviewGroup.incoming, expectedIncoming.incoming) ||
    !sameJson(
      row.reviewGroup.incomingSafetySnapshot,
      expectedIncoming.incomingSafetySnapshot,
    )
  ) {
    throw new SafeImportCommitFault("REVIEW_GROUP_MISMATCH");
  }
  const candidateIds = row.reviewGroup.candidates.map(
    (candidate) => candidate.leadId,
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new SafeImportCommitFault("REVIEW_GROUP_MISMATCH");
  }
  const result: CreateReviewDecisionResult = createReviewDecision(
    row.reviewGroup,
    row.reviewRequest,
  );
  if (!result.valid) throw new SafeImportCommitFault(result.errorCode);
  if (result.decision.action !== row.disposition) {
    throw new SafeImportCommitFault("REVIEW_DECISION_ACTION_MISMATCH");
  }
  return result.decision;
}

function prepareRows(rows: readonly ImportCommitRow[]): PreparedRow[] {
  if (rows.length === 0)
    throw new SafeImportCommitFault("IMPORT_ROWS_REQUIRED");
  const seenRows = new Set<number>();
  return rows.map((row) => {
    if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1) {
      throw new SafeImportCommitFault("INVALID_ROW_NUMBER");
    }
    if (seenRows.has(row.rowNumber)) {
      throw new SafeImportCommitFault("DUPLICATE_ROW_NUMBER");
    }
    seenRows.add(row.rowNumber);
    if (row.issues.length > 0 && row.disposition !== "SKIP") {
      throw new SafeImportCommitFault("ROW_ERRORS_UNRESOLVED");
    }
    if (row.disposition === "SKIP") {
      const provenance = row.lead
        ? assessImportProvenance(row.lead, row.consentEvidence)
        : null;
      return {
        row,
        provenance,
        decision: validateReview(row, provenance),
      };
    }
    if (row.issues.length > 0) {
      throw new SafeImportCommitFault("ROW_ERRORS_UNRESOLVED");
    }
    if (!row.lead) throw new SafeImportCommitFault("MAPPED_LEAD_REQUIRED");
    const provenance = assessImportProvenance(row.lead, row.consentEvidence);
    const decision = validateReview(row, provenance);
    if (!decision) throw new SafeImportCommitFault("REVIEW_DECISION_REQUIRED");
    return { row, provenance, decision };
  });
}

function combineConsentStatuses(
  statuses: readonly ConsentStatus[],
): ConsentStatus {
  if (statuses.includes("OPTED_OUT")) return "OPTED_OUT";
  if (statuses.includes("REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  if (statuses.includes("UNKNOWN")) return "UNKNOWN";
  return statuses.includes("ALLOWED_FOR_RECORDED_PURPOSE")
    ? "ALLOWED_FOR_RECORDED_PURPOSE"
    : "UNKNOWN";
}

function effectiveConsentStatus(prepared: PreparedRow): ConsentStatus {
  const provenance = prepared.provenance;
  if (!provenance) return "UNKNOWN";
  if (prepared.decision?.action === "MERGE") {
    return combineConsentStatuses([
      provenance.consentStatus,
      prepared.decision.safety.effectiveConsentStatus,
    ]);
  }
  return provenance.consentStatus;
}

function isCompleteEvidence(evidence?: ConsentEvidenceInput): boolean {
  return Boolean(
    evidence?.evidenceReference?.trim() &&
    evidence.purpose?.trim() &&
    evidence.channel &&
    VALID_CHANNELS.has(evidence.channel.trim()) &&
    evidence.capturedAt &&
    Number.isFinite(Date.parse(evidence.capturedAt)),
  );
}

function mappedBasis(value: MappedLeadDraft["lawful_contact_basis"]): string {
  return value;
}

function saveableErrorCodes(row: ImportCommitRow): string[] {
  const codes = row.issues
    .map((issue) => issue.code.trim())
    .filter(
      (code) => /^[A-Z][A-Z0-9_]{0,79}$/iu.test(code) && !/\d{7,}/u.test(code),
    );
  if (row.disposition === "SKIP" && codes.length === 0) {
    codes.push("ROW_SKIPPED_BY_REVIEW");
  }
  return [...new Set(codes)].slice(0, 100);
}

function saveableErrorColumns(row: ImportCommitRow): string[] {
  return [
    ...new Set(
      row.issues
        .flatMap((issue) => (issue.field ? [issue.field] : []))
        .map((field) => field.trim())
        .filter((field) =>
          LEAD_IMPORT_FIELDS.includes(
            field as (typeof LEAD_IMPORT_FIELDS)[number],
          ),
        ),
    ),
  ].slice(0, 100);
}

export class ImportCommitRepository {
  constructor(private readonly database: ImportSqlDatabase) {}

  async createJob(input: CreateImportJobInput): Promise<CreateImportJobResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    const checksum = input.fileChecksum.trim().toLowerCase();
    if (
      !isUuid(input.workspaceId) ||
      !isUuid(input.uploaderUserId) ||
      idempotencyKey === "" ||
      idempotencyKey.length > 128 ||
      !isChecksum(checksum) ||
      !Number.isSafeInteger(input.totalRows) ||
      input.totalRows < 0
    ) {
      return { success: false, errorCode: "INVALID_JOB_REQUEST" };
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const actor = await transaction.query<{ id: string }>(
          'SELECT u."id" FROM "User" u JOIN "TeamMembership" m ON m."workspaceId" = u."workspaceId" AND m."userId" = u."id" WHERE u."workspaceId" = $1 AND u."id" = $2 AND u."status" = \'ACTIVE\'',
          [input.workspaceId, input.uploaderUserId],
        );
        if (!actor[0])
          return { success: false, errorCode: "INVALID_JOB_REQUEST" };
        const sameKey = await transaction.query<{
          id: string;
          fileChecksum: string;
          uploaderUserId: string;
          totalRows: number;
        }>(
          'SELECT "id", "fileChecksum", "uploaderUserId", "totalRows" FROM "ImportJob" WHERE "workspaceId" = $1 AND "idempotencyKey" = $2 FOR UPDATE',
          [input.workspaceId, idempotencyKey],
        );
        if (sameKey[0]) {
          if (sameKey[0].fileChecksum.trim().toLowerCase() !== checksum) {
            return {
              success: false,
              errorCode: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_FILE",
            };
          }
          if (
            sameKey[0].uploaderUserId !== input.uploaderUserId ||
            sameKey[0].totalRows !== input.totalRows
          ) {
            return {
              success: false,
              errorCode: "IDEMPOTENCY_REQUEST_MISMATCH",
            };
          }
          return { success: true, jobId: sameKey[0].id, reused: true };
        }
        const sameChecksum = await transaction.query<{ id: string }>(
          'SELECT "id" FROM "ImportJob" WHERE "workspaceId" = $1 AND "fileChecksum" = $2 FOR UPDATE',
          [input.workspaceId, checksum],
        );
        if (sameChecksum[0]) {
          return { success: false, errorCode: "DUPLICATE_FILE_CHECKSUM" };
        }
        const created = await transaction.query<{ id: string }>(
          'INSERT INTO "ImportJob" ("id", "workspaceId", "uploaderUserId", "idempotencyKey", "fileChecksum", "status", "totalRows", "updatedAt") VALUES ($1, $2, $3, $4, $5, \'UPLOADED\', $6, CURRENT_TIMESTAMP) RETURNING "id"',
          [
            randomUUID(),
            input.workspaceId,
            input.uploaderUserId,
            idempotencyKey,
            checksum,
            input.totalRows,
          ],
        );
        if (!created[0]) throw new Error("job insert returned no row");
        return { success: true, jobId: created[0].id, reused: false };
      });
    } catch {
      const recovered = await this.findExistingJob(
        input.workspaceId,
        idempotencyKey,
        checksum,
      );
      if (recovered) {
        if (recovered.byKey && recovered.fileChecksum === checksum) {
          return recovered.uploaderUserId === input.uploaderUserId &&
            recovered.totalRows === input.totalRows
            ? { success: true, jobId: recovered.id, reused: true }
            : { success: false, errorCode: "IDEMPOTENCY_REQUEST_MISMATCH" };
        }
        if (recovered.byKey) {
          return {
            success: false,
            errorCode: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_FILE",
          };
        }
        return { success: false, errorCode: "DUPLICATE_FILE_CHECKSUM" };
      }
      return { success: false, errorCode: "DATABASE_JOB_WRITE_FAILED" };
    }
  }

  private async findExistingJob(
    workspaceId: string,
    idempotencyKey: string,
    checksum: string,
  ): Promise<{
    id: string;
    fileChecksum: string;
    uploaderUserId: string;
    totalRows: number;
    byKey: boolean;
  } | null> {
    try {
      const byKey = await this.database.query<{
        id: string;
        fileChecksum: string;
        uploaderUserId: string;
        totalRows: number;
      }>(
        'SELECT "id", "fileChecksum", "uploaderUserId", "totalRows" FROM "ImportJob" WHERE "workspaceId" = $1 AND "idempotencyKey" = $2',
        [workspaceId, idempotencyKey],
      );
      if (byKey[0])
        return {
          ...byKey[0],
          fileChecksum: byKey[0].fileChecksum.trim().toLowerCase(),
          byKey: true,
        };
      const byChecksum = await this.database.query<{
        id: string;
        fileChecksum: string;
        uploaderUserId: string;
        totalRows: number;
      }>(
        'SELECT "id", "fileChecksum", "uploaderUserId", "totalRows" FROM "ImportJob" WHERE "workspaceId" = $1 AND "fileChecksum" = $2',
        [workspaceId, checksum],
      );
      if (byChecksum[0])
        return {
          ...byChecksum[0],
          fileChecksum: byChecksum[0].fileChecksum.trim().toLowerCase(),
          byKey: false,
        };
      return null;
    } catch {
      return null;
    }
  }

  async commit(input: CommitImportInput): Promise<CommitImportResult> {
    if (
      !isUuid(input.workspaceId) ||
      !isUuid(input.actorId) ||
      !isUuid(input.jobId) ||
      input.idempotencyKey.trim() === "" ||
      input.idempotencyKey.length > 128 ||
      !isChecksum(input.fileChecksum.trim())
    ) {
      return {
        success: false,
        status: "REJECTED",
        jobId: input.jobId,
        errorCode: "INVALID_COMMIT_REQUEST",
      };
    }
    let prepared: PreparedRow[];
    try {
      prepared = prepareRows(input.rows);
    } catch (error) {
      return {
        success: false,
        status: "REJECTED",
        jobId: input.jobId,
        errorCode:
          error instanceof SafeImportCommitFault
            ? error.safeCode
            : "INVALID_COMMIT_REQUEST",
      };
    }
    const checksum = input.fileChecksum.trim().toLowerCase();
    try {
      return await this.database.transaction(async (transaction) => {
        const jobs = await transaction.query<JobRow>(
          'SELECT "id", "workspaceId", "uploaderUserId", "idempotencyKey", "fileChecksum", "status"::text AS "status", "totalRows", "validRows", "invalidRows", "duplicateRows" FROM "ImportJob" WHERE "workspaceId" = $1 AND "id" = $2 FOR UPDATE',
          [input.workspaceId, input.jobId],
        );
        const job = jobs[0];
        if (!job) throw new SafeImportCommitFault("IMPORT_JOB_NOT_FOUND");
        if (
          job.idempotencyKey !== input.idempotencyKey.trim() ||
          job.fileChecksum.trim().toLowerCase() !== checksum
        ) {
          throw new SafeImportCommitFault("IDEMPOTENCY_REQUEST_MISMATCH");
        }
        if (job.uploaderUserId !== input.actorId) {
          throw new SafeImportCommitFault("IMPORT_ACTOR_MISMATCH");
        }
        if (job.status === "COMMITTED") {
          const previous = await transaction.query<{
            committed: number;
            skipped: number;
          }>(
            'SELECT count(*) FILTER (WHERE "status" = \'COMMITTED\')::int AS "committed", count(*) FILTER (WHERE "status" = \'SKIPPED\')::int AS "skipped" FROM "ImportRowResult" WHERE "workspaceId" = $1 AND "importJobId" = $2',
            [input.workspaceId, input.jobId],
          );
          return {
            success: true,
            status: "COMMITTED",
            jobId: input.jobId,
            rowsCommitted: previous[0]?.committed ?? 0,
            rowsSkipped: previous[0]?.skipped ?? 0,
            alreadyCommitted: true,
          };
        }
        if (job.totalRows !== prepared.length) {
          throw new SafeImportCommitFault("IMPORT_ROW_COUNT_MISMATCH");
        }
        if (
          ![
            "UPLOADED",
            "MAPPED",
            "VALIDATED",
            "NEEDS_REVIEW",
            "APPROVED",
            "FAILED",
            "ROLLED_BACK",
          ].includes(job.status)
        ) {
          throw new SafeImportCommitFault("IMPORT_JOB_NOT_COMMITTABLE");
        }
        const actor = await transaction.query<ActorRow>(
          'SELECT m."role"::text AS "role" FROM "User" u JOIN "TeamMembership" m ON m."workspaceId" = u."workspaceId" AND m."userId" = u."id" WHERE u."workspaceId" = $1 AND u."id" = $2 AND u."status" = \'ACTIVE\'',
          [input.workspaceId, input.actorId],
        );
        if (!actor[0])
          throw new SafeImportCommitFault("IMPORT_ACTOR_NOT_ACTIVE");
        let committed = 0;
        let skipped = 0;
        let invalidSkipped = 0;
        let reviewSkipped = 0;
        for (const preparedRow of prepared) {
          if (preparedRow.row.disposition === "SKIP") {
            await this.persistSkippedRow(
              transaction,
              input,
              preparedRow,
              actor[0].role,
            );
            skipped += 1;
            if (preparedRow.row.issues.length > 0) invalidSkipped += 1;
            else reviewSkipped += 1;
            continue;
          }
          await this.persistAcceptedRow(
            transaction,
            input,
            preparedRow,
            actor[0].role,
          );
          committed += 1;
        }
        await transaction.execute(
          'UPDATE "ImportJob" SET "status" = \'COMMITTED\', "validRows" = $3, "invalidRows" = $4, "duplicateRows" = $5, "failureReasonCode" = NULL, "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "id" = $2',
          [
            input.workspaceId,
            input.jobId,
            committed,
            invalidSkipped,
            reviewSkipped,
          ],
        );
        return {
          success: true,
          status: "COMMITTED",
          jobId: input.jobId,
          rowsCommitted: committed,
          rowsSkipped: skipped,
          alreadyCommitted: false,
        };
      });
    } catch (error) {
      if (error instanceof SafeImportCommitFault) {
        if (
          error.safeCode === "IMPORT_JOB_NOT_FOUND" ||
          error.safeCode === "IDEMPOTENCY_REQUEST_MISMATCH" ||
          error.safeCode === "IMPORT_ACTOR_MISMATCH" ||
          error.safeCode === "IMPORT_ROW_COUNT_MISMATCH" ||
          error.safeCode === "IMPORT_JOB_NOT_COMMITTABLE" ||
          error.safeCode === "IMPORT_ACTOR_NOT_ACTIVE"
        ) {
          return {
            success: false,
            status: "REJECTED",
            jobId: input.jobId,
            errorCode: error.safeCode,
          };
        }
      }
      const errorCode =
        error instanceof SafeImportCommitFault
          ? error.safeCode
          : "DATABASE_COMMIT_FAILED";
      const persisted = await this.persistFailure(input, errorCode);
      return {
        success: false,
        status: persisted ? "ROLLED_BACK" : "FAILED",
        jobId: input.jobId,
        errorCode: persisted ? errorCode : "FAILURE_STATUS_UPDATE_FAILED",
        jobStatusPersisted: persisted,
      };
    }
  }

  private async persistFailure(
    input: CommitImportInput,
    errorCode: string,
  ): Promise<boolean> {
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.execute(
          'UPDATE "ImportJob" SET "status" = \'ROLLED_BACK\', "failureReasonCode" = $3, "completedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "id" = $2 AND "status" <> \'COMMITTED\'',
          [input.workspaceId, input.jobId, errorCode],
        );
      });
      return true;
    } catch {
      return false;
    }
  }

  private async persistSkippedRow(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    actorRole: ActorRow["role"],
  ): Promise<void> {
    const row = prepared.row;
    await transaction.execute(
      'INSERT INTO "ImportRowResult" ("id", "workspaceId", "importJobId", "rowNumber", "status", "errorCodes", "errorColumns") VALUES ($1, $2, $3, $4, \'SKIPPED\', $5, $6)',
      [
        randomUUID(),
        input.workspaceId,
        input.jobId,
        row.rowNumber,
        saveableErrorCodes(row),
        saveableErrorColumns(row),
      ],
    );
    await this.appendAudit(transaction, {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorRole,
      action: "IMPORT_ROW_SKIPPED",
      entityType: "ImportJob",
      entityId: input.jobId,
      jobId: input.jobId,
      changedFieldNames: ["rowStatus", "reviewDecision"],
    });
  }

  private async verifyReviewTarget(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    targetLeadId: string,
  ): Promise<void> {
    const row = prepared.row;
    const lead = row.lead!;
    const provenance = prepared.provenance!;
    const group = row.reviewGroup!;
    const reviewed = group.candidates.find(
      (candidate) => candidate.leadId === targetLeadId,
    );
    if (!reviewed)
      throw new SafeImportCommitFault("MERGE_TARGET_NOT_IN_CANDIDATES");
    const targets = await transaction.query<TargetRow>(
      'SELECT "id", "companyName", "district" FROM "Lead" WHERE "workspaceId" = $1 AND "id" = $2 FOR UPDATE',
      [input.workspaceId, targetLeadId],
    );
    const target = targets[0];
    if (!target) throw new SafeImportCommitFault("REVIEW_TARGET_NOT_FOUND");
    const contacts = await transaction.query<LiveMergeContactRow>(
      'SELECT "id", "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 FOR UPDATE',
      [input.workspaceId, targetLeadId],
    );
    const consentRows = await transaction.query<LiveConsentRow>(
      'SELECT cr."status"::text AS "status" FROM "ConsentRecord" cr JOIN "LeadContact" lc ON lc."workspaceId" = cr."workspaceId" AND lc."id" = cr."leadContactId" WHERE lc."workspaceId" = $1 AND lc."leadId" = $2',
      [input.workspaceId, targetLeadId],
    );
    const suppressions = await transaction.query<LiveSuppressionRow>(
      'SELECT sr."reason"::text AS "reason" FROM "SuppressionRecord" sr JOIN "LeadContact" lc ON lc."workspaceId" = sr."workspaceId" AND lc."id" = sr."leadContactId" WHERE lc."workspaceId" = $1 AND lc."leadId" = $2',
      [input.workspaceId, targetLeadId],
    );
    const hasOptOut =
      consentRows.some((item) => item.status === "OPTED_OUT") ||
      suppressions.some((item) => item.reason === "OPT_OUT");
    const liveConsent = combineConsentStatuses([
      ...consentRows.map((item) => item.status),
      ...(hasOptOut ? ["OPTED_OUT" as const] : []),
    ]);
    const liveContactability = combineContactabilityStatuses([
      ...contacts.map((item) => item.contactabilityStatus),
      ...(suppressions.length > 0 ? ["SUPPRESSED" as const] : []),
    ]);
    const snapshot = reviewed.safetySnapshot;
    if (
      combineConsentStatuses([liveConsent, snapshot.consentStatus]) !==
        snapshot.consentStatus ||
      combineContactabilityStatuses([
        liveContactability,
        snapshot.contactabilityStatus,
      ]) !== snapshot.contactabilityStatus ||
      (hasOptOut &&
        !snapshot.suppressionInstructions.some(
          (item) => item.reason === "OPT_OUT",
        ))
    ) {
      throw new SafeImportCommitFault("REVIEW_GROUP_STALE");
    }

    const liveTypes = new Set<string>();
    const contactsToCheck: (LiveMergeContactRow | null)[] =
      contacts.length > 0 ? contacts : [null];
    for (const contact of contactsToCheck) {
      const liveLead: DeduplicationLead & { id: string } = {
        id: target.id,
        companyName: target.companyName,
        contactName: null,
        district: target.district,
        phoneNormalized: contact?.phoneNormalized ?? null,
        emailNormalized: contact?.emailNormalized ?? null,
        consentStatus: liveConsent,
        contactabilityStatus: liveContactability,
        suppressionInstructions: hasOptOut
          ? [{ required: true, reason: "OPT_OUT", scope: "ALL_CHANNELS" }]
          : [],
      };
      const liveGroup = findDuplicateCandidates(
        toDeduplicationLead(lead, provenance),
        [liveLead],
        { reviewGroupId: group.reviewGroupId },
      );
      for (const candidate of liveGroup.candidates) {
        for (const type of candidate.matchTypes) liveTypes.add(type);
      }
    }
    if (
      liveTypes.has("EXACT_PHONE") ||
      liveTypes.has("EXACT_EMAIL") ||
      liveTypes.has("EXACT_TAX_ID")
    ) {
      liveTypes.delete("COMPANY_DISTRICT");
    }
    if (!reviewed.matchTypes.some((type) => liveTypes.has(type))) {
      throw new SafeImportCommitFault("REVIEW_GROUP_STALE");
    }
  }

  private async persistAcceptedRow(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    actorRole: ActorRow["role"],
  ): Promise<void> {
    const row = prepared.row;
    const lead = row.lead;
    const provenance = prepared.provenance;
    const decision = prepared.decision;
    if (!lead || !provenance || !decision)
      throw new SafeImportCommitFault("INVALID_COMMIT_ROW");
    let leadId: string;
    if (decision.action === "MERGE") {
      leadId = decision.targetLeadId;
      await this.verifyReviewTarget(transaction, input, prepared, leadId);
    } else {
      leadId = randomUUID();
      await transaction.execute(
        'INSERT INTO "Lead" ("id", "workspaceId", "companyName", "normalizedCompanyName", "industry", "district", "stage", "createdByUserId", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, \'PENDING_REVIEW\', $7, CURRENT_TIMESTAMP)',
        [
          leadId,
          input.workspaceId,
          lead.company_name,
          lead.company_name_match_key,
          lead.industry,
          lead.district,
          input.actorId,
        ],
      );
    }

    const contact = await this.persistContact(
      transaction,
      input,
      prepared,
      leadId,
    );
    await this.persistSource(transaction, input, prepared, leadId);
    await this.persistProductInterest(transaction, input, prepared, leadId);
    await this.persistConsent(
      transaction,
      input,
      prepared,
      contact.id,
      contact.contactabilityStatus,
      actorRole,
    );
    const suppressionInstructions = [
      ...(provenance.suppression ? [provenance.suppression] : []),
      ...(decision.action === "MERGE"
        ? decision.safety.preservedSuppressionInstructions
        : []),
    ];
    if (
      decision.action === "MERGE" &&
      (decision.safety.effectiveConsentStatus === "OPTED_OUT" ||
        decision.safety.effectiveContactabilityStatus === "OPTED_OUT") &&
      !suppressionInstructions.some((item) => item.reason === "OPT_OUT")
    ) {
      suppressionInstructions.push({
        required: true,
        reason: "OPT_OUT",
        scope: "ALL_CHANNELS",
      });
    }
    if (suppressionInstructions.length > 0) {
      await this.persistSuppressions(
        transaction,
        input,
        contact.id,
        suppressionInstructions,
        actorRole,
      );
    }

    const reviewedCandidate =
      decision.action === "MERGE"
        ? row.reviewGroup?.candidates.find(
            (candidate) => candidate.leadId === decision.targetLeadId,
          )
        : undefined;
    await this.appendAudit(transaction, {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorRole,
      action:
        decision.action === "MERGE"
          ? "IMPORT_LEAD_MERGED"
          : "IMPORT_LEAD_CREATED",
      entityType: "Lead",
      entityId: leadId,
      jobId: input.jobId,
      changedFieldNames: [
        "companyName",
        "contact",
        "source",
        "productInterest",
        "provenance",
        "reviewDecision",
      ],
      beforeContactabilityStatus:
        reviewedCandidate?.safetySnapshot.contactabilityStatus ?? null,
      afterContactabilityStatus: contact.contactabilityStatus,
      beforeConsentStatus:
        reviewedCandidate?.safetySnapshot.consentStatus ?? null,
      afterConsentStatus: effectiveConsentStatus(prepared),
    });
    await transaction.execute(
      'INSERT INTO "ImportRowResult" ("id", "workspaceId", "importJobId", "rowNumber", "status", "errorCodes", "errorColumns", "matchedLeadId") VALUES ($1, $2, $3, $4, \'COMMITTED\', ARRAY[]::TEXT[], ARRAY[]::TEXT[], $5)',
      [randomUUID(), input.workspaceId, input.jobId, row.rowNumber, leadId],
    );
  }

  private async persistContact(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    leadId: string,
  ): Promise<ContactRow> {
    const row = prepared.row;
    const lead = row.lead!;
    const provenance = prepared.provenance!;
    const decision = prepared.decision!;
    let targetStatus: ContactabilityStatus = provenance.contactabilityStatus;
    if (decision.action === "MERGE") {
      targetStatus = combineContactabilityStatuses([
        provenance.contactabilityStatus,
        decision.safety.effectiveContactabilityStatus,
      ]);
      if (decision.safety.suppressionMustRemain) targetStatus = "SUPPRESSED";
    }
    const matchRows =
      decision.action === "MERGE"
        ? await transaction.query<ContactRow>(
            'SELECT "id", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND (($3::text IS NOT NULL AND "phoneNormalized" = $3) OR ($4::text IS NOT NULL AND "emailNormalized" = $4)) FOR UPDATE',
            [
              input.workspaceId,
              leadId,
              lead.phone_normalized,
              lead.email_normalized,
            ],
          )
        : [];
    if (matchRows.length > 1)
      throw new SafeImportCommitFault("MERGE_CONTACT_MATCH_AMBIGUOUS");
    const existing = matchRows[0];
    if (existing) {
      const priorSuppressions = await transaction.query<{ count: number }>(
        'SELECT count(*)::int AS "count" FROM "SuppressionRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2',
        [input.workspaceId, existing.id],
      );
      if ((priorSuppressions[0]?.count ?? 0) > 0) targetStatus = "SUPPRESSED";
      else
        targetStatus = combineContactabilityStatuses([
          targetStatus,
          existing.contactabilityStatus,
        ]);
      await transaction.execute(
        'UPDATE "LeadContact" SET "contactName" = COALESCE("contactName", $3), "phoneNormalized" = COALESCE("phoneNormalized", $4), "emailNormalized" = COALESCE("emailNormalized", $5), "contactabilityStatus" = $6, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "id" = $2',
        [
          input.workspaceId,
          existing.id,
          lead.contact_name,
          lead.phone_normalized,
          lead.email_normalized,
          targetStatus,
        ],
      );
      return { id: existing.id, contactabilityStatus: targetStatus };
    }
    if (decision.action === "MERGE" && decision.safety.suppressionMustRemain) {
      targetStatus = "SUPPRESSED";
    }
    const contactId = randomUUID();
    await transaction.execute(
      'INSERT INTO "LeadContact" ("id", "workspaceId", "leadId", "contactName", "phoneNormalized", "emailNormalized", "contactabilityStatus", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)',
      [
        contactId,
        input.workspaceId,
        leadId,
        lead.contact_name,
        lead.phone_normalized,
        lead.email_normalized,
        targetStatus,
      ],
    );
    return { id: contactId, contactabilityStatus: targetStatus };
  }

  private async persistSource(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    leadId: string,
  ): Promise<void> {
    const lead = prepared.row.lead!;
    if (!lead.source) return;
    await transaction.execute(
      'INSERT INTO "LeadSource" ("id", "workspaceId", "leadId", "sourceType", "sourceUrl", "contactBasis", "recordedByUserId") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        randomUUID(),
        input.workspaceId,
        leadId,
        lead.source,
        lead.source_url,
        mappedBasis(lead.lawful_contact_basis),
        input.actorId,
      ],
    );
  }

  private async persistProductInterest(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    leadId: string,
  ): Promise<void> {
    const productName = prepared.row.lead!.product_interest?.trim();
    if (!productName) return;
    await transaction.execute(
      'INSERT INTO "ProductInterest" ("id", "workspaceId", "leadId", "productName", "status", "recordedByUserId", "updatedAt") VALUES ($1, $2, $3, $4, \'UNREVIEWED\', $5, CURRENT_TIMESTAMP)',
      [randomUUID(), input.workspaceId, leadId, productName, input.actorId],
    );
  }

  private async persistConsent(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    prepared: PreparedRow,
    contactId: string,
    contactabilityStatus: ContactabilityStatus,
    actorRole: ActorRow["role"],
  ): Promise<void> {
    const evidence = prepared.row.consentEvidence;
    if (!isCompleteEvidence(evidence)) return;
    const consentId = randomUUID();
    const auditId = randomUUID();
    const effectiveStatus = effectiveConsentStatus(prepared);
    await this.appendAudit(transaction, {
      id: auditId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorRole,
      action: "CONSENT_RECORDED",
      entityType: "ConsentRecord",
      entityId: consentId,
      jobId: input.jobId,
      changedFieldNames: [
        "status",
        "channel",
        "purpose",
        "capturedAt",
        "evidenceReference",
      ],
      afterContactabilityStatus: contactabilityStatus,
      afterConsentStatus: effectiveStatus,
    });
    await transaction.execute(
      'INSERT INTO "ConsentRecord" ("id", "workspaceId", "leadContactId", "channel", "purpose", "status", "capturedAt", "evidenceReference", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [
        consentId,
        input.workspaceId,
        contactId,
        evidence!.channel!.trim(),
        evidence!.purpose!.trim(),
        effectiveStatus,
        new Date(evidence!.capturedAt!),
        evidence!.evidenceReference!.trim(),
        input.actorId,
        auditId,
      ],
    );
  }

  private async persistSuppressions(
    transaction: ImportSqlDatabase,
    input: CommitImportInput,
    contactId: string,
    instructions: readonly ImportSuppressionInstruction[],
    actorRole: ActorRow["role"],
  ): Promise<void> {
    const optOut = instructions.some(
      (instruction) =>
        instruction.reason === "OPT_OUT" &&
        instruction.scope === "ALL_CHANNELS",
    );
    if (!optOut) return;
    for (const channel of CONTACT_CHANNELS) {
      const suppressionId = randomUUID();
      const auditId = randomUUID();
      await this.appendAudit(transaction, {
        id: auditId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        actorRole,
        action: "SUPPRESSION_CREATED",
        entityType: "SuppressionRecord",
        entityId: suppressionId,
        jobId: input.jobId,
        changedFieldNames: ["contactabilityStatus", "suppression"],
        afterContactabilityStatus: "SUPPRESSED",
      });
      await transaction.execute(
        'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, $4, \'OPT_OUT\', $5, $6)',
        [
          suppressionId,
          input.workspaceId,
          contactId,
          channel,
          input.actorId,
          auditId,
        ],
      );
    }
  }

  private async appendAudit(
    transaction: ImportSqlDatabase,
    event: {
      id: string;
      workspaceId: string;
      actorId: string;
      actorRole: ActorRow["role"];
      action: string;
      entityType: string;
      entityId: string;
      jobId: string;
      changedFieldNames: readonly string[];
      beforeContactabilityStatus?: ContactabilityStatus | null;
      afterContactabilityStatus?: ContactabilityStatus | null;
      beforeConsentStatus?: ConsentStatus | null;
      afterConsentStatus?: ConsentStatus | null;
    },
  ): Promise<void> {
    try {
      await transaction.execute(
        'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "jobId", "changedFieldNames", "beforeContactabilityStatus", "afterContactabilityStatus", "beforeConsentStatus", "afterConsentStatus") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
        [
          event.id,
          event.workspaceId,
          event.actorId,
          event.actorRole,
          event.action,
          event.entityType,
          event.entityId,
          event.jobId,
          [...event.changedFieldNames],
          event.beforeContactabilityStatus ?? null,
          event.afterContactabilityStatus ?? null,
          event.beforeConsentStatus ?? null,
          event.afterConsentStatus ?? null,
        ],
      );
    } catch {
      throw new SafeImportCommitFault("AUDIT_APPEND_FAILED");
    }
  }
}
