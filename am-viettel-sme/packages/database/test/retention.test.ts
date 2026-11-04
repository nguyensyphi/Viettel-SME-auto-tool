import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RETENTION_CATEGORIES,
  RetentionJobService,
  type RetentionCategory,
  type RetentionJobLogEvent,
  type RetentionPolicy,
  type RetentionRepository,
} from "../src/retention.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const schema = readFileSync(
  join(packageRoot, "prisma", "schema.prisma"),
  "utf8",
);
const id = () => crypto.randomUUID();
const asOf = new Date("2026-10-03T12:00:00.000Z");
const TEST_ONLY_RETENTION_DAYS = 30;

function policy(
  category: RetentionCategory,
  overrides: Partial<RetentionPolicy> = {},
): RetentionPolicy {
  return {
    category,
    retentionDays: TEST_ONLY_RETENTION_DAYS,
    approvedByUserId: "00000000-0000-4000-8000-000000000001",
    approvedAt: new Date("2026-10-01T00:00:00.000Z"),
    timeBasis: "CREATED_AT",
    ...overrides,
  };
}

class FakeRetentionRepository implements RetentionRepository {
  policies: readonly RetentionPolicy[] = [];
  readonly purgeCalls: Parameters<
    RetentionRepository["purgeExpiredImportRowResults"]
  >[0][] = [];
  private readonly seenRunKeys = new Set<string>();

  async listPolicies(): Promise<readonly RetentionPolicy[]> {
    return this.policies;
  }

  async purgeExpiredImportRowResults(
    input: Parameters<RetentionRepository["purgeExpiredImportRowResults"]>[0],
  ): Promise<{ deletedCount: number; replayed: boolean }> {
    this.purgeCalls.push(input);
    const key = `${input.workspaceId}:${input.runId}:IMPORT_ROW_RESULTS`;
    if (this.seenRunKeys.has(key)) return { deletedCount: 0, replayed: true };
    this.seenRunKeys.add(key);
    return { deletedCount: 3, replayed: false };
  }
}

describe("retention job policy gates", () => {
  it("persists an explicit nullable time basis without a default and keeps the run audit index additive", () => {
    const policyModel =
      schema.match(/model DataRetentionPolicy \{([\s\S]*?)^\}/m)?.[1] ?? "";
    expect(schema).toMatch(
      /enum RetentionTimeBasis\s*\{[\s\S]*?CREATED_AT[\s\S]*?UPDATED_AT[\s\S]*?COMPLETED_AT/,
    );
    expect(policyModel).toMatch(/timeBasis\s+RetentionTimeBasis\?/);
    expect(policyModel).not.toMatch(
      /timeBasis\s+RetentionTimeBasis\?\s+@default/,
    );
    expect(migrationSql).toMatch(/ADD COLUMN "timeBasis" "RetentionTimeBasis"/);
    expect(migrationSql).toMatch(/AuditEvent_retention_job_category_key/);
  });

  it("reports every absent category as blocked and performs no deletion", async () => {
    const repository = new FakeRetentionRepository();
    const service = new RetentionJobService(repository);
    const report = await service.run({
      workspaceId: id(),
      runId: id(),
      asOf,
    });

    expect(report.categories).toHaveLength(4);
    expect(report.categories.map((item) => item.category)).toEqual(
      RETENTION_CATEGORIES,
    );
    expect(report.categories.every((item) => item.status === "BLOCKED")).toBe(
      true,
    );
    expect(report.categories.map((item) => item.reasonCode)).toEqual(
      RETENTION_CATEGORIES.map(() => "POLICY_MISSING"),
    );
    expect(repository.purgeCalls).toHaveLength(0);
  });

  it.each([
    [
      "null retention days",
      { retentionDays: null },
      "RETENTION_DAYS_UNCONFIGURED",
    ],
    ["missing approver", { approvedByUserId: null }, "POLICY_NOT_APPROVED"],
    ["missing approval timestamp", { approvedAt: null }, "POLICY_NOT_APPROVED"],
    ["unclear time basis", { timeBasis: null }, "TIME_BASIS_UNCONFIGURED"],
    [
      "unsupported time basis",
      { timeBasis: "COMPLETED_AT" },
      "TIME_BASIS_UNSUPPORTED",
    ],
  ] as const)(
    "fails closed for %s",
    async (_label, overrides, expectedReason) => {
      const repository = new FakeRetentionRepository();
      repository.policies = [policy("IMPORT_ROW_RESULTS", overrides)];
      const report = await new RetentionJobService(repository).run({
        workspaceId: id(),
        runId: id(),
        asOf,
      });

      expect(
        report.categories.find(
          (item) => item.category === "IMPORT_ROW_RESULTS",
        ),
      ).toMatchObject({ status: "BLOCKED", reasonCode: expectedReason });
      expect(repository.purgeCalls).toHaveLength(0);
    },
  );

  it("uses an explicitly approved synthetic policy and computes the exact UTC cutoff", async () => {
    const repository = new FakeRetentionRepository();
    repository.policies = [policy("IMPORT_ROW_RESULTS")];
    const workspaceId = id();
    const runId = id();
    const report = await new RetentionJobService(repository).run({
      workspaceId,
      runId,
      asOf,
    });

    expect(
      report.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "EXECUTED", deletedCount: 3 });
    expect(repository.purgeCalls).toHaveLength(1);
    expect(repository.purgeCalls[0]).toMatchObject({
      workspaceId,
      runId,
      cutoff: new Date("2026-09-03T12:00:00.000Z"),
    });
  });

  it("never purges lead data or append-only audit, even when their policies are approved", async () => {
    const repository = new FakeRetentionRepository();
    repository.policies = [
      policy("LEAD_DATA"),
      policy("AUDIT_EVENTS"),
      policy("RAW_WORKBOOK"),
    ];
    const report = await new RetentionJobService(repository).run({
      workspaceId: id(),
      runId: id(),
      asOf,
    });

    expect(
      report.categories.find((item) => item.category === "LEAD_DATA"),
    ).toMatchObject({
      status: "BLOCKED",
      reasonCode: "LEAD_DATA_POLICY_REVIEW_REQUIRED",
    });
    expect(
      report.categories.find((item) => item.category === "AUDIT_EVENTS"),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "AUDIT_APPEND_ONLY" });
    expect(
      report.categories.find((item) => item.category === "RAW_WORKBOOK"),
    ).toMatchObject({
      status: "BLOCKED",
      reasonCode: "CATEGORY_HANDLER_UNAVAILABLE",
    });
    expect(repository.purgeCalls).toHaveLength(0);
  });

  it("logs safe status fields only and never includes workspace, approver, or raw PII", async () => {
    const repository = new FakeRetentionRepository();
    repository.policies = [policy("IMPORT_ROW_RESULTS")];
    const events: RetentionJobLogEvent[] = [];
    await new RetentionJobService(repository, (event) =>
      events.push(event),
    ).run({
      workspaceId: "workspace-secret-id",
      runId: "run-secret-id",
      asOf,
    });

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("workspace-secret-id");
    expect(serialized).not.toContain("run-secret-id");
    expect(serialized).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(serialized.toLowerCase()).not.toContain("phone");
    expect(serialized.toLowerCase()).not.toContain("email");
    expect(
      events.every(
        (event) =>
          event.category === "IMPORT_ROW_RESULTS" ||
          RETENTION_CATEGORIES.includes(event.category),
      ),
    ).toBe(true);
  });

  it("retries with the same category idempotency key", async () => {
    const repository = new FakeRetentionRepository();
    repository.policies = [policy("IMPORT_ROW_RESULTS")];
    const service = new RetentionJobService(repository);
    const workspaceId = id();
    const runId = id();
    const first = await service.run({ workspaceId, runId, asOf });
    const retry = await service.run({ workspaceId, runId, asOf });

    expect(repository.purgeCalls).toHaveLength(2);
    expect(repository.purgeCalls[0]?.runId).toBe(
      repository.purgeCalls[1]?.runId,
    );
    expect(
      first.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "EXECUTED", deletedCount: 3 });
    expect(
      retry.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "REPLAYED", deletedCount: 0 });
  });
});

interface RawExecutor {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

interface TransactionHost extends RawExecutor {
  $transaction<T>(work: (transaction: RawExecutor) => Promise<T>): Promise<T>;
}

class PGlitePrismaAdapter implements TransactionHost {
  failNextAuditInsert = false;

  constructor(private readonly database: PGlite) {}

  async $queryRawUnsafe<T = unknown>(
    query: string,
    ...values: unknown[]
  ): Promise<T> {
    if (this.failNextAuditInsert && /INSERT INTO "AuditEvent"/u.test(query)) {
      this.failNextAuditInsert = false;
      throw new Error("synthetic audit append failure");
    }
    const result = await this.database.query(query, values);
    return result.rows as T;
  }

  async $executeRawUnsafe(
    query: string,
    ...values: unknown[]
  ): Promise<number> {
    const result = await this.database.query(query, values);
    return result.affectedRows ?? 0;
  }

  async $transaction<T>(
    work: (transaction: RawExecutor) => Promise<T>,
  ): Promise<T> {
    await this.database.exec("BEGIN");
    try {
      const result = await work(this);
      await this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original failure after rollback.
      }
      throw error;
    }
  }
}

let rawDatabase: PGlite;
let prismaAdapter: PGlitePrismaAdapter;
let workspaceId: string;
let approverId: string;

async function insertSyntheticResult(createdAt: Date): Promise<string> {
  const jobId = id();
  await rawDatabase.query(
    'INSERT INTO "ImportJob" ("id", "workspaceId", "uploaderUserId", "idempotencyKey", "fileChecksum", "status", "updatedAt") VALUES ($1, $2, $3, $4, $5, \'COMMITTED\', CURRENT_TIMESTAMP)',
    [
      jobId,
      workspaceId,
      approverId,
      `synthetic-${jobId}`,
      jobId.replaceAll("-", "0").slice(0, 64),
    ],
  );
  const rowId = id();
  await rawDatabase.query(
    'INSERT INTO "ImportRowResult" ("id", "workspaceId", "importJobId", "rowNumber", "status", "createdAt") VALUES ($1, $2, $3, 1, \'VALID\', $4)',
    [rowId, workspaceId, jobId, createdAt],
  );
  return rowId;
}

async function insertPolicy(
  category: RetentionCategory,
  options: {
    readonly retentionDays?: number | null;
    readonly approvedByUserId?: string | null;
    readonly approvedAt?: Date | null;
    readonly timeBasis?: "CREATED_AT" | "UPDATED_AT" | "COMPLETED_AT" | null;
  } = {},
): Promise<void> {
  const policyId = id();
  await rawDatabase.query(
    'INSERT INTO "DataRetentionPolicy" ("id", "workspaceId", "category", "retentionDays", "approvedByUserId", "approvedAt", "timeBasis", "updatedAt") VALUES ($1, $2, $3::"RetentionCategory", $4, $5, $6, $7::"RetentionTimeBasis", CURRENT_TIMESTAMP)',
    [
      policyId,
      workspaceId,
      category,
      options.retentionDays === undefined
        ? TEST_ONLY_RETENTION_DAYS
        : options.retentionDays,
      options.approvedByUserId === undefined
        ? approverId
        : options.approvedByUserId,
      options.approvedAt === undefined
        ? new Date("2026-10-01T00:00:00.000Z")
        : options.approvedAt,
      options.timeBasis === undefined ? "CREATED_AT" : options.timeBasis,
    ],
  );
}

async function countRows(table: string): Promise<number> {
  const result = await rawDatabase.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "${table}" WHERE "workspaceId" = $1`,
    [workspaceId],
  );
  return result.rows[0]?.count ?? 0;
}

async function createWorkspaceAndApprover(): Promise<void> {
  workspaceId = id();
  approverId = id();
  await rawDatabase.query(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [workspaceId, `retention-${workspaceId}`, "Synthetic Retention Workspace"],
  );
  await rawDatabase.query(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [approverId, workspaceId, `${approverId}@example.invalid`],
  );
}

describe("retention persistence on PGlite", () => {
  beforeAll(async () => {
    rawDatabase = new PGlite();
    await rawDatabase.exec(migrationSql);
    prismaAdapter = new PGlitePrismaAdapter(rawDatabase);
  });

  beforeEach(async () => {
    await createWorkspaceAndApprover();
  });

  afterAll(async () => {
    await rawDatabase.close();
  });

  it("fails closed for absent, unapproved, null-days, and unclear-basis database policies", async () => {
    const service = new RetentionJobService(
      (await import("../src/retention.js")).createPrismaRetentionRepository(
        prismaAdapter,
      ),
    );
    await insertSyntheticResult(new Date("2026-01-01T00:00:00.000Z"));
    await insertPolicy("IMPORT_ROW_RESULTS", {
      retentionDays: null,
      approvedByUserId: null,
      approvedAt: null,
      timeBasis: null,
    });

    const report = await service.run({ workspaceId, runId: id(), asOf });

    expect(
      report.categories.find((item) => item.category === "RAW_WORKBOOK"),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "POLICY_MISSING" });
    expect(
      report.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({
      status: "BLOCKED",
      reasonCode: "RETENTION_DAYS_UNCONFIGURED",
    });
    expect(await countRows("ImportRowResult")).toBe(1);
  });

  it("deletes only rows strictly older than the approved cutoff and preserves the exact boundary", async () => {
    await insertSyntheticResult(new Date("2026-09-03T11:59:59.999Z"));
    const boundaryId = await insertSyntheticResult(
      new Date("2026-09-03T12:00:00.000Z"),
    );
    await insertSyntheticResult(new Date("2026-09-03T12:00:00.001Z"));
    await insertPolicy("IMPORT_ROW_RESULTS");
    const repository = (
      await import("../src/retention.js")
    ).createPrismaRetentionRepository(prismaAdapter);
    const service = new RetentionJobService(repository);

    const report = await service.run({ workspaceId, runId: id(), asOf });

    expect(
      report.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "EXECUTED", deletedCount: 1 });
    expect(await countRows("ImportRowResult")).toBe(2);
    const boundary = await rawDatabase.query<{ id: string }>(
      'SELECT "id" FROM "ImportRowResult" WHERE "id" = $1',
      [boundaryId],
    );
    expect(boundary.rows).toHaveLength(1);
    expect(await countRows("AuditEvent")).toBe(1);
  });

  it("retries idempotently, appends audit once, and never mutates existing audit evidence", async () => {
    await insertSyntheticResult(new Date("2026-01-01T00:00:00.000Z"));
    await insertPolicy("IMPORT_ROW_RESULTS");
    const repository = (
      await import("../src/retention.js")
    ).createPrismaRetentionRepository(prismaAdapter);
    const service = new RetentionJobService(repository);
    const runId = id();
    const first = await service.run({ workspaceId, runId, asOf });
    const retry = await service.run({ workspaceId, runId, asOf });

    expect(
      first.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "EXECUTED", deletedCount: 1 });
    expect(
      retry.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "REPLAYED", deletedCount: 0 });
    expect(await countRows("AuditEvent")).toBe(1);
    const auditId = await rawDatabase.query<{ id: string }>(
      'SELECT "id" FROM "AuditEvent" WHERE "workspaceId" = $1',
      [workspaceId],
    );
    await expect(
      rawDatabase.query(
        'UPDATE "AuditEvent" SET "action" = \'CHANGED\' WHERE "id" = $1',
        [auditId.rows[0]?.id],
      ),
    ).rejects.toThrow(/append-only/u);
  });

  it("rolls back the purge and audit marker if audit append fails", async () => {
    await insertSyntheticResult(new Date("2026-01-01T00:00:00.000Z"));
    await insertPolicy("IMPORT_ROW_RESULTS");
    const repository = (
      await import("../src/retention.js")
    ).createPrismaRetentionRepository(prismaAdapter);
    const service = new RetentionJobService(repository);
    prismaAdapter.failNextAuditInsert = true;

    const report = await service.run({ workspaceId, runId: id(), asOf });

    expect(
      report.categories.find((item) => item.category === "IMPORT_ROW_RESULTS"),
    ).toMatchObject({ status: "FAILED", reasonCode: "EXECUTION_FAILED" });
    expect(await countRows("ImportRowResult")).toBe(1);
    expect(await countRows("AuditEvent")).toBe(0);
  });

  it("keeps suppression and append-only audit retention categories blocked even under approved policies", async () => {
    const leadId = id();
    const contactId = id();
    const suppressionId = id();
    const auditId = id();
    await rawDatabase.query(
      'INSERT INTO "Lead" ("id", "workspaceId", "companyName", "normalizedCompanyName", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [
        leadId,
        workspaceId,
        "Synthetic Suppression Test Co.",
        "synthetic suppression test co.",
      ],
    );
    await rawDatabase.query(
      'INSERT INTO "LeadContact" ("id", "workspaceId", "leadId", "contactName", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [contactId, workspaceId, leadId, "Synthetic Opt-out Contact"],
    );
    await rawDatabase.query(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "action", "entityType", "entityId") VALUES ($1, $2, $3, \'SUPPRESSION_CREATED\', \'SuppressionRecord\', $4)',
      [auditId, workspaceId, approverId, suppressionId],
    );
    await rawDatabase.query(
      'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'OPT_OUT\', $4, $5)',
      [suppressionId, workspaceId, contactId, approverId, auditId],
    );
    await insertPolicy("LEAD_DATA");
    await insertPolicy("AUDIT_EVENTS");
    const service = new RetentionJobService(
      (await import("../src/retention.js")).createPrismaRetentionRepository(
        prismaAdapter,
      ),
    );
    const report = await service.run({ workspaceId, runId: id(), asOf });

    expect(
      report.categories.find((item) => item.category === "LEAD_DATA"),
    ).toMatchObject({
      status: "BLOCKED",
      reasonCode: "LEAD_DATA_POLICY_REVIEW_REQUIRED",
    });
    expect(
      report.categories.find((item) => item.category === "AUDIT_EVENTS"),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "AUDIT_APPEND_ONLY" });
    expect(await countRows("SuppressionRecord")).toBe(1);
    expect(await countRows("AuditEvent")).toBe(1);
    const contact = await rawDatabase.query<{ contactabilityStatus: string }>(
      'SELECT "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "id" = $1',
      [contactId],
    );
    expect(contact.rows[0]?.contactabilityStatus).toBe("SUPPRESSED");
  });
});
