import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createImportReviewGroup,
  ImportCommitRepository,
  type ImportCommitRow,
  type ImportSqlDatabase,
} from "../src/import-commit.js";
import type { MappedLeadDraft } from "@am-sme/excel-import";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const id = () => randomUUID();

class PGliteTestDatabase implements ImportSqlDatabase {
  failNextCommit = false;
  failNextAuditAppend = false;

  constructor(private readonly database: PGlite) {}

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    if (this.failNextAuditAppend && /INSERT INTO "AuditEvent"/u.test(sql)) {
      this.failNextAuditAppend = false;
      throw new Error("synthetic audit append failure");
    }
    const result = await this.database.query<T>(sql, [...values]);
    return result.rows;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
    await this.query(sql, values);
  }

  async transaction<T>(
    work: (transaction: ImportSqlDatabase) => Promise<T>,
  ): Promise<T> {
    await this.database.exec("BEGIN");
    try {
      const result = await work(this);
      if (this.failNextCommit) {
        this.failNextCommit = false;
        await this.database.exec("ROLLBACK");
        throw new Error("synthetic transaction commit failure");
      }
      await this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.database.exec("ROLLBACK");
      } catch {
        // A failed commit injection may already have rolled the transaction back.
      }
      throw error;
    }
  }
}

let rawDatabase: PGlite;
let testDatabase: PGliteTestDatabase;
let repository: ImportCommitRepository;
let workspaceId: string;
let actorId: string;

async function count(table: string, where = "TRUE"): Promise<number> {
  const rows = await testDatabase.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "${table}" WHERE ${where}`,
  );
  return rows[0]?.count ?? 0;
}

async function makeActor(): Promise<{ workspaceId: string; actorId: string }> {
  const nextWorkspaceId = id();
  const nextActorId = id();
  await testDatabase.execute(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [nextWorkspaceId, `synthetic-${nextWorkspaceId}`, "Synthetic Workspace"],
  );
  await testDatabase.execute(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [nextActorId, nextWorkspaceId, `actor-${nextActorId}@example.invalid`],
  );
  await testDatabase.execute(
    'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'AM\')',
    [id(), nextWorkspaceId, nextActorId],
  );
  return { workspaceId: nextWorkspaceId, actorId: nextActorId };
}

function mappedLead(overrides: Partial<MappedLeadDraft> = {}): MappedLeadDraft {
  return {
    lead_id: null,
    company_name: "Synthetic Import Company",
    company_name_match_key: "synthetic import company",
    contact_name: "Synthetic Contact Person",
    phone: "090 123 4567",
    phone_status: "VALID",
    phone_normalized: "+84901234567",
    email: "contact@example.invalid",
    email_normalized: "contact@example.invalid",
    industry: "Synthetic industry",
    district: "District One",
    source: "AM_ENTERED",
    source_url: null,
    lawful_contact_basis: "UNKNOWN",
    consent_status: "UNKNOWN",
    product_interest: null,
    owner_am: null,
    stage: "PENDING_REVIEW",
    last_contact_at: null,
    next_action_at: null,
    notes: null,
    contactability_status: "UNKNOWN",
    ...overrides,
  };
}

function row(
  lead: MappedLeadDraft,
  rowNumber = 2,
  action: "KEEP" | "MERGE" | "SKIP" = "KEEP",
  existing: Parameters<typeof createImportReviewGroup>[1] = [],
): ImportCommitRow {
  const reviewGroup = createImportReviewGroup(lead, existing, {
    reviewGroupId: `row-${rowNumber}`,
  });
  return {
    rowNumber,
    disposition: action,
    lead,
    reviewGroup,
    reviewRequest:
      action === "MERGE"
        ? { action, targetLeadId: existing[0]?.id ?? "" }
        : { action },
    issues: [],
  };
}

async function createApprovedJob(
  options: { key?: string; checksum?: string; totalRows?: number } = {},
): Promise<{ jobId: string; idempotencyKey: string; fileChecksum: string }> {
  const idempotencyKey = options.key ?? `request-${id()}`;
  const fileChecksum =
    options.checksum ?? createHash("sha256").update(id()).digest("hex");
  const created = await repository.createJob({
    workspaceId,
    uploaderUserId: actorId,
    idempotencyKey,
    fileChecksum,
    totalRows: options.totalRows ?? 1,
  });
  if (!created.success)
    throw new Error(`create job failed: ${created.errorCode}`);
  await testDatabase.execute(
    'UPDATE "ImportJob" SET "status" = \'APPROVED\' WHERE "workspaceId" = $1 AND "id" = $2',
    [workspaceId, created.jobId],
  );
  return { jobId: created.jobId, idempotencyKey, fileChecksum };
}

function commitRequest(
  job: Awaited<ReturnType<typeof createApprovedJob>>,
  rows: readonly ImportCommitRow[],
) {
  return {
    workspaceId,
    actorId,
    jobId: job.jobId,
    idempotencyKey: job.idempotencyKey,
    fileChecksum: job.fileChecksum,
    rows,
  };
}

describe("P0.4b atomic import commit on PGlite", () => {
  beforeAll(async () => {
    rawDatabase = new PGlite();
    await rawDatabase.exec(migrationSql);
    testDatabase = new PGliteTestDatabase(rawDatabase);
    repository = new ImportCommitRepository(testDatabase);
  });

  beforeEach(async () => {
    ({ workspaceId, actorId } = await makeActor());
  });

  afterAll(async () => {
    await rawDatabase.close();
  });

  it("creates an idempotent job and rejects reused keys or checksums for different imports", async () => {
    const key = `key-${id()}`;
    const checksum = createHash("sha256")
      .update("synthetic-file")
      .digest("hex");
    const first = await repository.createJob({
      workspaceId,
      uploaderUserId: actorId,
      idempotencyKey: key,
      fileChecksum: checksum,
      totalRows: 1,
    });
    const sameRequest = await repository.createJob({
      workspaceId,
      uploaderUserId: actorId,
      idempotencyKey: key,
      fileChecksum: checksum,
      totalRows: 1,
    });
    const changedFile = await repository.createJob({
      workspaceId,
      uploaderUserId: actorId,
      idempotencyKey: key,
      fileChecksum: createHash("sha256").update("other-file").digest("hex"),
      totalRows: 1,
    });
    const differentKeySameFile = await repository.createJob({
      workspaceId,
      uploaderUserId: actorId,
      idempotencyKey: `other-${id()}`,
      fileChecksum: checksum,
      totalRows: 1,
    });

    expect(first.success).toBe(true);
    expect(sameRequest).toMatchObject({
      success: true,
      reused: true,
      jobId: first.success ? first.jobId : "",
    });
    expect(changedFile).toMatchObject({
      success: false,
      errorCode: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_FILE",
    });
    expect(differentKeySameFile).toMatchObject({
      success: false,
      errorCode: "DUPLICATE_FILE_CHECKSUM",
    });
    expect(await count("ImportJob")).toBe(1);
  });

  it("refuses validation errors or unresolved candidates before writing lead data", async () => {
    const job = await createApprovedJob();
    const lead = mappedLead();
    const invalid = {
      ...row(lead),
      issues: [{ code: "INVALID_PHONE", field: "phone" as const }],
    };
    const result = await repository.commit(commitRequest(job, [invalid]));

    expect(result).toMatchObject({
      success: false,
      status: "REJECTED",
      errorCode: "ROW_ERRORS_UNRESOLVED",
    });
    expect(await count("Lead")).toBe(0);
    expect(await count("AuditEvent")).toBe(0);
  });

  it("refuses an unresolved duplicate candidate and accepts an invalid row only when explicitly skipped", async () => {
    const job = await createApprovedJob();
    const lead = mappedLead();
    const existing = [
      {
        id: id(),
        companyName: "Synthetic Existing Company",
        contactName: null,
        district: "District One",
        phoneNormalized: "+84901234567",
        emailNormalized: null,
        consentStatus: "UNKNOWN" as const,
        contactabilityStatus: "UNKNOWN" as const,
      },
    ];
    const candidateRow = row(lead, 2, "KEEP", existing);
    const unresolved: ImportCommitRow = {
      rowNumber: candidateRow.rowNumber,
      disposition: "KEEP",
      lead,
      reviewGroup: candidateRow.reviewGroup!,
      issues: [],
    };
    const rejected = await repository.commit(commitRequest(job, [unresolved]));
    expect(rejected).toMatchObject({
      success: false,
      status: "REJECTED",
      errorCode: "REVIEW_DECISION_REQUIRED",
    });
    expect(await count("Lead")).toBe(0);

    const skipped = {
      ...row(mappedLead(), 3, "SKIP"),
      issues: [{ code: "INVALID_PHONE", field: "phone" as const }],
    };
    const skipJob = await createApprovedJob({ totalRows: 1 });
    const skippedResult = await repository.commit(
      commitRequest(skipJob, [skipped]),
    );
    expect(skippedResult).toMatchObject({
      success: true,
      status: "COMMITTED",
      rowsCommitted: 0,
      rowsSkipped: 1,
    });
    expect(
      await count(
        "ImportRowResult",
        `"workspaceId" = '${workspaceId}' AND "status" = 'SKIPPED' AND 'INVALID_PHONE' = ANY("errorCodes")`,
      ),
    ).toBe(1);
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(0);
  });

  it("accepts an uploaded job only when its complete mapped/provenance/review payload is resolved", async () => {
    const job = await createApprovedJob();
    await testDatabase.execute(
      'UPDATE "ImportJob" SET "status" = \'UPLOADED\' WHERE "workspaceId" = $1 AND "id" = $2',
      [workspaceId, job.jobId],
    );
    const result = await repository.commit(
      commitRequest(job, [row(mappedLead())]),
    );

    expect(result).toMatchObject({
      success: true,
      status: "COMMITTED",
      rowsCommitted: 1,
    });
  });

  it("commits lead, contact, source, row result, job state, and audit in one transaction without raw PII in audit", async () => {
    const job = await createApprovedJob();
    const lead = mappedLead();
    const result = await repository.commit(commitRequest(job, [row(lead)]));
    const auditRows = await testDatabase.query<{
      action: string;
      entityType: string;
      changedFieldNames: string[];
    }>(
      'SELECT "action", "entityType", "changedFieldNames" FROM "AuditEvent" WHERE "workspaceId" = $1',
      [workspaceId],
    );
    const auditText = JSON.stringify(auditRows);

    expect(result).toMatchObject({
      success: true,
      status: "COMMITTED",
      rowsCommitted: 1,
      rowsSkipped: 0,
      alreadyCommitted: false,
    });
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(1);
    expect(await count("LeadContact", `"workspaceId" = '${workspaceId}'`)).toBe(
      1,
    );
    expect(await count("LeadSource", `"workspaceId" = '${workspaceId}'`)).toBe(
      1,
    );
    expect(
      await count(
        "ImportRowResult",
        `"workspaceId" = '${workspaceId}' AND "status" = 'COMMITTED'`,
      ),
    ).toBe(1);
    expect(
      await count("AuditEvent", `"workspaceId" = '${workspaceId}'`),
    ).toBeGreaterThan(0);
    expect(auditText).not.toContain(lead.phone_normalized ?? "");
    expect(auditText).not.toContain(lead.email_normalized ?? "");
    expect(auditText).not.toContain(lead.contact_name ?? "");
  });

  it("stores opt-out as all-channel suppression and never raises contactability", async () => {
    const job = await createApprovedJob();
    const lead = mappedLead({ consent_status: "OPTED_OUT" });
    const result = await repository.commit(commitRequest(job, [row(lead)]));
    const contacts = await testDatabase.query<{ contactabilityStatus: string }>(
      'SELECT "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1',
      [workspaceId],
    );
    const channels = await testDatabase.query<{ channel: string }>(
      'SELECT "channel"::text AS "channel" FROM "SuppressionRecord" WHERE "workspaceId" = $1 ORDER BY "channel"',
      [workspaceId],
    );

    expect(result.success).toBe(true);
    expect(contacts[0]?.contactabilityStatus).toBe("SUPPRESSED");
    expect(channels.map((item) => item.channel).sort()).toEqual([
      "EMAIL",
      "PHONE",
      "SMS",
      "TELEGRAM",
      "ZALO",
    ]);
  });

  it("recomputes an incomplete ALLOWED claim to review-required and creates no consent or task", async () => {
    const job = await createApprovedJob();
    const lead = mappedLead({ consent_status: "ALLOWED_FOR_RECORDED_PURPOSE" });
    const result = await repository.commit(commitRequest(job, [row(lead)]));
    const contact = await testDatabase.query<{ contactabilityStatus: string }>(
      'SELECT "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1',
      [workspaceId],
    );

    expect(result).toMatchObject({ success: true, status: "COMMITTED" });
    expect(contact[0]?.contactabilityStatus).toBe("REVIEW_REQUIRED");
    expect(
      await count("ConsentRecord", `"workspaceId" = '${workspaceId}'`),
    ).toBe(0);
    expect(await count("Task", `"workspaceId" = '${workspaceId}'`)).toBe(0);
  });

  it("rolls back a failed database commit, marks the job safely, and allows an idempotent retry", async () => {
    const job = await createApprovedJob({ totalRows: 2 });
    const request = commitRequest(job, [
      row(mappedLead(), 2),
      row(
        mappedLead({
          company_name: "Synthetic Second Company",
          company_name_match_key: "synthetic second company",
        }),
        3,
      ),
    ]);
    testDatabase.failNextCommit = true;

    const failed = await repository.commit(request);
    expect(failed).toMatchObject({
      success: false,
      status: "ROLLED_BACK",
      errorCode: "DATABASE_COMMIT_FAILED",
    });
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(0);
    expect(await count("LeadContact", `"workspaceId" = '${workspaceId}'`)).toBe(
      0,
    );
    expect(
      await count("ImportRowResult", `"workspaceId" = '${workspaceId}'`),
    ).toBe(0);
    expect(await count("AuditEvent", `"workspaceId" = '${workspaceId}'`)).toBe(
      0,
    );
    const failedJob = await testDatabase.query<{
      status: string;
      failureReasonCode: string | null;
    }>(
      'SELECT "status"::text AS "status", "failureReasonCode" FROM "ImportJob" WHERE "workspaceId" = $1 AND "id" = $2',
      [workspaceId, job.jobId],
    );
    expect(failedJob[0]).toEqual({
      status: "ROLLED_BACK",
      failureReasonCode: "DATABASE_COMMIT_FAILED",
    });

    const retry = await repository.commit(request);
    expect(retry).toMatchObject({
      success: true,
      status: "COMMITTED",
      alreadyCommitted: false,
    });
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(2);
  });

  it("rolls back every row and audit when audit append fails", async () => {
    const job = await createApprovedJob();
    testDatabase.failNextAuditAppend = true;
    const result = await repository.commit(
      commitRequest(job, [row(mappedLead({ consent_status: "OPTED_OUT" }))]),
    );

    expect(result).toMatchObject({
      success: false,
      status: "ROLLED_BACK",
      errorCode: "AUDIT_APPEND_FAILED",
    });
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(0);
    expect(await count("LeadContact", `"workspaceId" = '${workspaceId}'`)).toBe(
      0,
    );
    expect(await count("AuditEvent", `"workspaceId" = '${workspaceId}'`)).toBe(
      0,
    );
    expect(
      await count("ImportRowResult", `"workspaceId" = '${workspaceId}'`),
    ).toBe(0);
    expect(
      await count("SuppressionRecord", `"workspaceId" = '${workspaceId}'`),
    ).toBe(0);
  });

  it("returns the committed outcome on a repeated request without duplicating data or audit", async () => {
    const job = await createApprovedJob();
    const request = commitRequest(job, [row(mappedLead())]);
    const first = await repository.commit(request);
    const replay = await repository.commit(request);

    expect(first).toMatchObject({ success: true, alreadyCommitted: false });
    expect(replay).toMatchObject({ success: true, alreadyCommitted: true });
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(1);
    expect(await count("AuditEvent", `"workspaceId" = '${workspaceId}'`)).toBe(
      1,
    );
    expect(
      await count("ImportRowResult", `"workspaceId" = '${workspaceId}'`),
    ).toBe(1);
  });

  it("keeps an opted-out target suppressive when a reviewed merge is committed", async () => {
    const targetLeadId = id();
    const targetContactId = id();
    const suppressionId = id();
    const suppressionAuditId = id();
    await testDatabase.execute(
      'INSERT INTO "Lead" ("id", "workspaceId", "companyName", "normalizedCompanyName", "district", "updatedAt") VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
      [
        targetLeadId,
        workspaceId,
        "Synthetic Existing Company",
        "synthetic existing company",
        "District One",
      ],
    );
    await testDatabase.execute(
      'INSERT INTO "LeadContact" ("id", "workspaceId", "leadId", "phoneNormalized", "contactabilityStatus", "updatedAt") VALUES ($1, $2, $3, $4, \'SUPPRESSED\', CURRENT_TIMESTAMP)',
      [targetContactId, workspaceId, targetLeadId, "+84901234567"],
    );
    await testDatabase.execute(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "action", "entityType", "entityId") VALUES ($1, $2, $3, \'SUPPRESSION_CREATED\', \'SuppressionRecord\', $4)',
      [suppressionAuditId, workspaceId, actorId, suppressionId],
    );
    await testDatabase.execute(
      'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'OPT_OUT\', $4, $5)',
      [
        suppressionId,
        workspaceId,
        targetContactId,
        actorId,
        suppressionAuditId,
      ],
    );
    const incoming = mappedLead({
      company_name: "Synthetic Existing Company",
      company_name_match_key: "synthetic existing company",
    });
    const existing = [
      {
        id: targetLeadId,
        companyName: "Synthetic Existing Company",
        contactName: null,
        district: "District One",
        phoneNormalized: "+84901234567",
        emailNormalized: null,
        consentStatus: "OPTED_OUT" as const,
        contactabilityStatus: "SUPPRESSED" as const,
        suppressionInstructions: [
          {
            required: true as const,
            reason: "OPT_OUT" as const,
            scope: "ALL_CHANNELS" as const,
          },
        ],
      },
    ];
    const mergeRow = row(incoming, 2, "MERGE", existing);
    const job = await createApprovedJob();
    const result = await repository.commit(commitRequest(job, [mergeRow]));
    const contact = await testDatabase.query<{ contactabilityStatus: string }>(
      'SELECT "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "id" = $2',
      [workspaceId, targetContactId],
    );
    const mergeAudit = await testDatabase.query<{
      beforeContactabilityStatus: string | null;
      afterContactabilityStatus: string | null;
      beforeConsentStatus: string | null;
      afterConsentStatus: string | null;
    }>(
      'SELECT "beforeContactabilityStatus"::text AS "beforeContactabilityStatus", "afterContactabilityStatus"::text AS "afterContactabilityStatus", "beforeConsentStatus"::text AS "beforeConsentStatus", "afterConsentStatus"::text AS "afterConsentStatus" FROM "AuditEvent" WHERE "workspaceId" = $1 AND "action" = \'IMPORT_LEAD_MERGED\'',
      [workspaceId],
    );

    expect(result).toMatchObject({ success: true, rowsCommitted: 1 });
    expect(contact[0]?.contactabilityStatus).toBe("SUPPRESSED");
    expect(mergeAudit[0]).toEqual({
      beforeContactabilityStatus: "SUPPRESSED",
      afterContactabilityStatus: "SUPPRESSED",
      beforeConsentStatus: "OPTED_OUT",
      afterConsentStatus: "OPTED_OUT",
    });
    expect(
      await count(
        "SuppressionRecord",
        `"workspaceId" = '${workspaceId}' AND "leadContactId" = '${targetContactId}'`,
      ),
    ).toBeGreaterThanOrEqual(5);
    expect(await count("Lead", `"workspaceId" = '${workspaceId}'`)).toBe(1);
  });
});
