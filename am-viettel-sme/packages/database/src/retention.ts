import { randomUUID } from "node:crypto";

export const RETENTION_CATEGORIES = [
  "RAW_WORKBOOK",
  "IMPORT_ROW_RESULTS",
  "LEAD_DATA",
  "AUDIT_EVENTS",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];
export type RetentionTimeBasis = "CREATED_AT" | "UPDATED_AT" | "COMPLETED_AT";

export interface RetentionPolicy {
  readonly category: RetentionCategory;
  readonly retentionDays: number | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly timeBasis: RetentionTimeBasis | null;
}

export interface PurgeImportRowResultsInput {
  readonly workspaceId: string;
  /** Stable UUID for one scheduled/manual execution; reused unchanged on retry. */
  readonly runId: string;
  readonly cutoff: Date;
  readonly expectedPolicy: RetentionPolicy;
}

export interface RetentionPurgeResult {
  readonly deletedCount: number;
  readonly replayed: boolean;
}

export interface RetentionRepository {
  listPolicies(workspaceId: string): Promise<readonly RetentionPolicy[]>;
  /**
   * Atomically append the retention audit marker and delete rows strictly older
   * than cutoff. Repositories must make runId/category idempotent.
   */
  purgeExpiredImportRowResults(
    input: PurgeImportRowResultsInput,
  ): Promise<RetentionPurgeResult>;
}

export type RetentionBlockerCode =
  | "POLICY_MISSING"
  | "POLICY_AMBIGUOUS"
  | "RETENTION_DAYS_UNCONFIGURED"
  | "RETENTION_DAYS_INVALID"
  | "POLICY_NOT_APPROVED"
  | "APPROVAL_AFTER_AS_OF"
  | "TIME_BASIS_UNCONFIGURED"
  | "TIME_BASIS_UNSUPPORTED"
  | "LEAD_DATA_POLICY_REVIEW_REQUIRED"
  | "AUDIT_APPEND_ONLY"
  | "CATEGORY_HANDLER_UNAVAILABLE";

export type RetentionCategoryStatus =
  "BLOCKED" | "EXECUTED" | "REPLAYED" | "FAILED";

export interface RetentionCategoryResult {
  readonly category: RetentionCategory;
  readonly status: RetentionCategoryStatus;
  readonly reasonCode?: RetentionBlockerCode | "EXECUTION_FAILED";
  readonly cutoff?: Date;
  readonly deletedCount?: number;
}

export interface RetentionRunInput {
  readonly workspaceId: string;
  /** Stable UUID; reuse it unchanged if retrying this same run. */
  readonly runId: string;
  readonly asOf: Date;
}

export interface RetentionRunReport {
  readonly categories: readonly RetentionCategoryResult[];
}

export interface RetentionJobLogEvent {
  readonly event:
    | "RETENTION_CATEGORY_BLOCKED"
    | "RETENTION_CATEGORY_COMPLETED"
    | "RETENTION_CATEGORY_FAILED";
  readonly category: RetentionCategory;
  readonly status: RetentionCategoryStatus;
  readonly reasonCode?: RetentionBlockerCode | "EXECUTION_FAILED";
  readonly cutoff?: string;
  readonly deletedCount?: number;
}

export type RetentionJobLogger = (event: RetentionJobLogEvent) => void;

const MAX_RETENTION_DAYS = 3650;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export class RetentionJobService {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly log: RetentionJobLogger = () => undefined,
  ) {}

  async run(input: RetentionRunInput): Promise<RetentionRunReport> {
    if (!Number.isFinite(input.asOf.getTime())) {
      throw new Error("RETENTION_AS_OF_INVALID");
    }

    const policies = await this.repository.listPolicies(input.workspaceId);
    const results: RetentionCategoryResult[] = [];

    for (const category of RETENTION_CATEGORIES) {
      const matches = policies.filter((policy) => policy.category === category);
      if (matches.length > 1) {
        results.push(this.block(category, "POLICY_AMBIGUOUS"));
        continue;
      }
      const policy = matches[0];
      if (!policy) {
        results.push(this.block(category, "POLICY_MISSING"));
        continue;
      }

      const blocker = this.getPolicyBlocker(policy, input.asOf);
      if (blocker) {
        results.push(this.block(category, blocker));
        continue;
      }

      if (category === "AUDIT_EVENTS") {
        results.push(this.block(category, "AUDIT_APPEND_ONLY"));
        continue;
      }
      if (category === "LEAD_DATA") {
        results.push(this.block(category, "LEAD_DATA_POLICY_REVIEW_REQUIRED"));
        continue;
      }
      if (category === "RAW_WORKBOOK") {
        results.push(this.block(category, "CATEGORY_HANDLER_UNAVAILABLE"));
        continue;
      }
      if (policy.timeBasis !== "CREATED_AT") {
        results.push(this.block(category, "TIME_BASIS_UNSUPPORTED"));
        continue;
      }

      const cutoff = new Date(
        input.asOf.getTime() - policy.retentionDays! * MILLISECONDS_PER_DAY,
      );
      try {
        const execution = await this.repository.purgeExpiredImportRowResults({
          workspaceId: input.workspaceId,
          runId: input.runId,
          cutoff,
          expectedPolicy: policy,
        });
        const result: RetentionCategoryResult = {
          category,
          status: execution.replayed ? "REPLAYED" : "EXECUTED",
          cutoff,
          deletedCount: execution.deletedCount,
        };
        results.push(result);
        this.log({
          event: "RETENTION_CATEGORY_COMPLETED",
          category,
          status: result.status,
          cutoff: cutoff.toISOString(),
          deletedCount: execution.deletedCount,
        });
      } catch {
        const result: RetentionCategoryResult = {
          category,
          status: "FAILED",
          reasonCode: "EXECUTION_FAILED",
          cutoff,
        };
        results.push(result);
        this.log({
          event: "RETENTION_CATEGORY_FAILED",
          category,
          status: result.status,
          reasonCode: "EXECUTION_FAILED",
          cutoff: cutoff.toISOString(),
        });
      }
    }

    return { categories: results };
  }

  private getPolicyBlocker(
    policy: RetentionPolicy,
    asOf: Date,
  ): RetentionBlockerCode | undefined {
    if (policy.retentionDays === null) return "RETENTION_DAYS_UNCONFIGURED";
    if (
      !Number.isInteger(policy.retentionDays) ||
      policy.retentionDays < 1 ||
      policy.retentionDays > MAX_RETENTION_DAYS
    ) {
      return "RETENTION_DAYS_INVALID";
    }
    if (
      !policy.approvedByUserId?.trim() ||
      !policy.approvedAt ||
      !Number.isFinite(policy.approvedAt.getTime())
    ) {
      return "POLICY_NOT_APPROVED";
    }
    if (policy.approvedAt.getTime() > asOf.getTime()) {
      return "APPROVAL_AFTER_AS_OF";
    }
    if (!policy.timeBasis) return "TIME_BASIS_UNCONFIGURED";
    return undefined;
  }

  private block(
    category: RetentionCategory,
    reasonCode: RetentionBlockerCode,
  ): RetentionCategoryResult {
    const result: RetentionCategoryResult = {
      category,
      status: "BLOCKED",
      reasonCode,
    };
    this.log({
      event: "RETENTION_CATEGORY_BLOCKED",
      category,
      status: result.status,
      reasonCode,
    });
    return result;
  }
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

interface RetentionPolicyRow {
  readonly category: RetentionCategory;
  readonly retentionDays: number | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly timeBasis: RetentionTimeBasis | null;
}

function samePolicy(
  current: RetentionPolicyRow | undefined,
  expected: RetentionPolicy,
): boolean {
  return (
    current !== undefined &&
    current.category === expected.category &&
    current.retentionDays === expected.retentionDays &&
    current.approvedByUserId === expected.approvedByUserId &&
    current.approvedAt?.getTime() === expected.approvedAt?.getTime() &&
    current.timeBasis === expected.timeBasis
  );
}

/** Adapt Prisma's interactive transaction API to the retention repository port. */
export function createPrismaRetentionRepository(
  client: PrismaTransactionHost,
): RetentionRepository {
  return {
    async listPolicies(workspaceId): Promise<readonly RetentionPolicy[]> {
      const rows = await client.$queryRawUnsafe<RetentionPolicyRow[]>(
        `SELECT "category"::text AS "category", "retentionDays", "approvedByUserId", "approvedAt", "timeBasis"::text AS "timeBasis"
         FROM "DataRetentionPolicy" WHERE "workspaceId" = $1`,
        workspaceId,
      );
      return rows.map((row) => ({ ...row }));
    },

    async purgeExpiredImportRowResults(input): Promise<RetentionPurgeResult> {
      if (
        input.expectedPolicy.category !== "IMPORT_ROW_RESULTS" ||
        input.expectedPolicy.timeBasis !== "CREATED_AT" ||
        !Number.isInteger(input.expectedPolicy.retentionDays) ||
        input.expectedPolicy.retentionDays === null ||
        input.expectedPolicy.retentionDays < 1 ||
        input.expectedPolicy.retentionDays > MAX_RETENTION_DAYS ||
        !input.expectedPolicy.approvedByUserId ||
        !input.expectedPolicy.approvedAt ||
        !Number.isFinite(input.cutoff.getTime())
      ) {
        throw new Error("RETENTION_EXECUTION_NOT_AUTHORIZED");
      }

      return client.$transaction(async (transaction) => {
        const currentPolicies = await transaction.$queryRawUnsafe<
          RetentionPolicyRow[]
        >(
          `SELECT "category"::text AS "category", "retentionDays", "approvedByUserId", "approvedAt", "timeBasis"::text AS "timeBasis"
             FROM "DataRetentionPolicy"
             WHERE "workspaceId" = $1 AND "category" = 'IMPORT_ROW_RESULTS'::"RetentionCategory"
             FOR UPDATE`,
          input.workspaceId,
        );
        if (!samePolicy(currentPolicies[0], input.expectedPolicy)) {
          throw new Error("RETENTION_POLICY_CHANGED");
        }

        // The unique audit key makes retries (and concurrent duplicates) no-ops.
        const auditMarker = await transaction.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "entityType", "entityId", "requestId", "jobId")
           VALUES ($1, $2, 'RETENTION_PURGED', 'RetentionCategory', 'IMPORT_ROW_RESULTS', $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING "id"`,
          randomUUID(),
          input.workspaceId,
          input.runId,
          input.runId,
        );
        if (auditMarker.length === 0) {
          return { deletedCount: 0, replayed: true };
        }

        const deleted = await transaction.$queryRawUnsafe<{ id: string }[]>(
          `DELETE FROM "ImportRowResult"
           WHERE "workspaceId" = $1 AND "createdAt" < $2
           RETURNING "id"`,
          input.workspaceId,
          input.cutoff,
        );
        return { deletedCount: deleted.length, replayed: false };
      });
    },
  };
}
