import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(packageRoot, "prisma", "schema.prisma");
const migrationsPath = join(packageRoot, "prisma", "migrations");
const seedPath = join(packageRoot, "prisma", "seed.synthetic.sql");
const schema = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : "";
const seedSql = existsSync(seedPath) ? readFileSync(seedPath, "utf8") : "";

function getModel(name: string): string {
  const match = schema.match(
    new RegExp(`model ${name} \\{([\\s\\S]*?)^\\}`, "m"),
  );
  return match?.[1] ?? "";
}

function findMigrationSql(): string {
  if (!existsSync(migrationsPath)) return "";
  const migrationFiles = readdirSync(migrationsPath)
    .sort()
    .map((name) => join(migrationsPath, name))
    .filter((path) => existsSync(join(path, "migration.sql")))
    .map((path) => readFileSync(join(path, "migration.sql"), "utf8"));
  return migrationFiles.join("\n");
}

const migrationSql = findMigrationSql();
let database: PGlite;

const id = () => crypto.randomUUID();

async function createWorkspace(db: PGlite, slug: string): Promise<string> {
  const workspaceId = id();
  await db.query(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [workspaceId, slug, `Synthetic ${slug}`],
  );
  return workspaceId;
}

async function createActor(db: PGlite, workspaceId: string): Promise<string> {
  const userId = id();
  await db.query(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [userId, workspaceId, `actor-${userId}@example.invalid`],
  );
  return userId;
}

async function createLeadAndContact(
  db: PGlite,
  workspaceId: string,
): Promise<{ leadId: string; contactId: string }> {
  const leadId = id();
  await db.query(
    'INSERT INTO "Lead" ("id", "workspaceId", "companyName", "normalizedCompanyName", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
    [leadId, workspaceId, "Synthetic Alpha Company", "synthetic alpha company"],
  );
  const contactId = id();
  await db.query(
    'INSERT INTO "LeadContact" ("id", "workspaceId", "leadId", "contactName", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
    [contactId, workspaceId, leadId, "Synthetic Work Contact"],
  );
  return { leadId, contactId };
}

async function createAuditEvent(
  db: PGlite,
  workspaceId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
): Promise<string> {
  const auditEventId = id();
  await db.query(
    'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "action", "entityType", "entityId") VALUES ($1, $2, $3, $4, $5, $6)',
    [auditEventId, workspaceId, actorId, action, entityType, entityId],
  );
  return auditEventId;
}

describe("P0.1 Prisma/PostgreSQL schema contract", () => {
  it("defines every approved P0.1 data model", () => {
    const requiredModels = [
      "Workspace",
      "User",
      "Team",
      "TeamMembership",
      "Lead",
      "LeadNote",
      "LeadContact",
      "LeadSource",
      "ConsentRecord",
      "SuppressionRecord",
      "ProductInterest",
      "ImportJob",
      "ImportRowResult",
      "ColumnMapping",
      "Task",
      "LockedTimeBlock",
      "AuditEvent",
      "DataRetentionPolicy",
    ];

    for (const model of requiredModels) {
      expect(getModel(model), `missing Prisma model ${model}`).not.toBe("");
    }
  });

  it("requires workspace scope and composite identity for every tenant-owned model", () => {
    const tenantModels = [
      "User",
      "Team",
      "TeamMembership",
      "Lead",
      "LeadNote",
      "LeadContact",
      "LeadSource",
      "ConsentRecord",
      "SuppressionRecord",
      "ProductInterest",
      "ImportJob",
      "ImportRowResult",
      "ColumnMapping",
      "Task",
      "LockedTimeBlock",
      "AuditEvent",
      "DataRetentionPolicy",
    ];

    for (const model of tenantModels) {
      const body = getModel(model);
      expect(body, `${model} must carry workspaceId`).toMatch(
        /workspaceId\s+String/,
      );
      expect(body, `${model} must have a compound workspace/id key`).toMatch(
        /@@unique\(\[workspaceId,\s*id\]\)/,
      );
      expect(body, `${model} must relate to Workspace`).toMatch(
        /workspace\s+Workspace\s+@relation/,
      );
    }
  });

  it("supports only invited users and explicit AM/manager/admin memberships", () => {
    expect(schema).toMatch(
      /enum UserRole\s*\{[\s\S]*?\bAM\b[\s\S]*?\bMANAGER\b[\s\S]*?\bADMIN\b/,
    );
    expect(schema).toMatch(/enum UserStatus\s*\{[\s\S]*?\bINVITED\b/);
    expect(getModel("User")).toMatch(/invitationTokenHash\s+String\?/);
    expect(getModel("User")).toMatch(/invitationExpiresAt\s+DateTime\?/);
    expect(getModel("User")).toMatch(/invitedByUserId\s+String\?/);
    expect(getModel("TeamMembership")).toMatch(/role\s+UserRole/);
    expect(getModel("User")).not.toMatch(/passwordHash/);
  });

  it("defaults new leads and contacts to fail-closed states and avoids unnecessary identity fields", () => {
    expect(getModel("Lead")).toMatch(
      /stage\s+LeadStage\s+@default\(PENDING_REVIEW\)/,
    );
    expect(getModel("LeadContact")).toMatch(
      /contactabilityStatus\s+ContactabilityStatus\s+@default\(UNKNOWN\)/,
    );
    expect(schema.toLowerCase()).not.toMatch(
      /\b(cccd|cmnd|identitynumber|dateofbirth)\b/,
    );
  });

  it("stores normalized contact routes only and requires same-workspace source/product actors", () => {
    const contact = getModel("LeadContact");
    const user = getModel("User");
    expect(contact).toMatch(/phoneNormalized\s+String\?/);
    expect(contact).toMatch(/emailNormalized\s+String\?/);
    expect(contact).not.toMatch(/^\s*phone\s+String/m);
    expect(contact).not.toMatch(/^\s*email\s+String/m);
    expect(user).toMatch(/emailNormalized\s+String/);
    expect(user).not.toMatch(/^\s*email\s+String/m);
    expect(getModel("LeadSource")).toMatch(
      /recordedByUserId\s+String\s+@db\.Uuid/,
    );
    expect(getModel("LeadSource")).toMatch(/recordedBy\s+User\s+@relation/);
    expect(getModel("ProductInterest")).toMatch(
      /recordedBy\s+User\s+@relation/,
    );
  });

  it("persists editable lead notes and exact before/after stage values for P0.5 timeline", () => {
    expect(getModel("LeadNote")).toMatch(
      /content\s+String\s+@db\.VarChar\(5000\)/,
    );
    expect(getModel("LeadNote")).toMatch(/authorUserId\s+String\s+@db\.Uuid/);
    expect(getModel("AuditEvent")).toMatch(/beforeStage\s+LeadStage\?/);
    expect(getModel("AuditEvent")).toMatch(/afterStage\s+LeadStage\?/);
    expect(migrationSql).toMatch(/ADD COLUMN "beforeStage" "LeadStage"/);
    expect(migrationSql).toMatch(/CREATE TABLE "LeadNote"/);
  });

  it("stores configurable retention without inventing a default and requires approved values", () => {
    expect(getModel("DataRetentionPolicy")).toMatch(/retentionDays\s+Int\?/);
    expect(getModel("DataRetentionPolicy")).not.toMatch(
      /retentionDays\s+Int\s+@default/,
    );
    expect(migrationSql).toMatch(/retentionDays[\s\S]*?BETWEEN 1 AND 3650/i);
    expect(migrationSql).toMatch(/approvedByUserId[\s\S]*?approvedAt/i);
  });

  it("requires every suppression record to reference an audit event", () => {
    expect(getModel("SuppressionRecord")).toMatch(
      /auditEventId\s+String\s+(?:@unique\s+)?@db\.Uuid/,
    );
    expect(getModel("SuppressionRecord")).not.toMatch(
      /auditEventId\s+String\?/,
    );
    expect(getModel("SuppressionRecord")).toMatch(
      /auditEvent\s+AuditEvent\s+@relation/,
    );
  });

  it("declares database-level append-only audit and protects user history from hard deletion", () => {
    expect(migrationSql).toMatch(/BEFORE UPDATE OR DELETE ON "AuditEvent"/i);
    expect(migrationSql).toMatch(/RAISE EXCEPTION[\s\S]*append-only/i);
    expect(migrationSql).toMatch(/BEFORE DELETE ON "User"/i);
    expect(migrationSql).toMatch(
      /BEFORE UPDATE OR DELETE ON "SuppressionRecord"/i,
    );
  });
});

describe("P0.1 PostgreSQL-compatible migration behavior", () => {
  beforeAll(async () => {
    database = new PGlite();
    if (!migrationSql) throw new Error("No Prisma SQL migration found");
    await database.exec(migrationSql);
  });

  afterAll(async () => {
    await database.close();
  });

  it("applies on a fresh database and creates all core tables", async () => {
    const result = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tables = new Set(result.rows.map((row) => row.table_name));
    for (const model of [
      "Workspace",
      "Lead",
      "LeadNote",
      "LeadContact",
      "SuppressionRecord",
      "AuditEvent",
      "DataRetentionPolicy",
    ]) {
      expect(tables.has(model)).toBe(true);
    }
  });

  it("seeds only synthetic data, is idempotent, and leaves contactability blocked", async () => {
    expect(seedSql).toMatch(/synthetic/i);
    await database.exec(seedSql);
    await database.exec(seedSql);

    const leads = await database.query<{ stage: string }>(
      'SELECT "stage"::text AS "stage" FROM "Lead" WHERE "id" = \'00000000-0000-4000-8000-000000000011\'',
    );
    const contacts = await database.query<{
      phoneNormalized: string | null;
      emailNormalized: string | null;
      contactabilityStatus: string;
    }>(
      'SELECT "phoneNormalized", "emailNormalized", "contactabilityStatus"::text AS "contactabilityStatus" FROM "LeadContact" WHERE "id" = \'00000000-0000-4000-8000-000000000021\'',
    );
    const count = await database.query<{ count: number }>(
      'SELECT count(*)::int AS "count" FROM "Lead" WHERE "id" = \'00000000-0000-4000-8000-000000000011\'',
    );

    expect(leads.rows[0]?.stage).toBe("PENDING_REVIEW");
    expect(contacts.rows[0]).toEqual({
      phoneNormalized: null,
      emailNormalized: null,
      contactabilityStatus: "UNKNOWN",
    });
    expect(count.rows[0]?.count).toBe(1);
  });

  it("enforces workspace-safe composite foreign keys", async () => {
    const workspaceA = await createWorkspace(database, `isolation-a-${id()}`);
    const workspaceB = await createWorkspace(database, `isolation-b-${id()}`);
    const actorB = await createActor(database, workspaceB);
    const { leadId } = await createLeadAndContact(database, workspaceA);

    await expect(
      database.query(
        'INSERT INTO "LeadSource" ("id", "workspaceId", "leadId", "sourceType", "contactBasis", "recordedByUserId") VALUES ($1, $2, $3, \'AM_ENTERED\', \'UNKNOWN\', $4)',
        [id(), workspaceB, leadId, actorB],
      ),
    ).rejects.toThrow();
  });

  it("commits suppression and linked audit atomically, blocks contactability, and rejects suppression mutation", async () => {
    const workspaceId = await createWorkspace(database, `suppression-${id()}`);
    const actorId = await createActor(database, workspaceId);
    const { contactId } = await createLeadAndContact(database, workspaceId);
    const auditEventId = id();
    const suppressionId = id();

    await expect(
      database.query(
        'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'OPT_OUT\', $4, $5)',
        [suppressionId, workspaceId, contactId, actorId, auditEventId],
      ),
    ).rejects.toThrow();

    const mismatchedAuditId = await createAuditEvent(
      database,
      workspaceId,
      actorId,
      "OTHER_ACTION",
      "SuppressionRecord",
      suppressionId,
    );
    await expect(
      database.query(
        'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'OPT_OUT\', $4, $5)',
        [suppressionId, workspaceId, contactId, actorId, mismatchedAuditId],
      ),
    ).rejects.toThrow();

    await database.exec("BEGIN");
    await database.query(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "action", "entityType", "entityId") VALUES ($1, $2, $3, \'SUPPRESSION_CREATED\', \'SuppressionRecord\', $4)',
      [auditEventId, workspaceId, actorId, suppressionId],
    );
    await database.query(
      'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'OPT_OUT\', $4, $5)',
      [suppressionId, workspaceId, contactId, actorId, auditEventId],
    );
    await database.exec("COMMIT");

    const contact = await database.query<{ contactabilityStatus: string }>(
      'SELECT "contactabilityStatus" FROM "LeadContact" WHERE "id" = $1',
      [contactId],
    );
    expect(contact.rows[0]?.contactabilityStatus).toBe("SUPPRESSED");

    await expect(
      database.query(
        'UPDATE "LeadContact" SET "contactabilityStatus" = \'ALLOWED_FOR_RECORDED_PURPOSE\' WHERE "id" = $1',
        [contactId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query('DELETE FROM "SuppressionRecord" WHERE "id" = $1', [
        suppressionId,
      ]),
    ).rejects.toThrow();
  });

  it("rolls back linked audit and suppression together on transaction failure", async () => {
    const workspaceId = await createWorkspace(database, `rollback-${id()}`);
    const actorId = await createActor(database, workspaceId);
    const { contactId } = await createLeadAndContact(database, workspaceId);
    const auditEventId = id();
    const suppressionId = id();

    await database.exec("BEGIN");
    await database.query(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "action", "entityType", "entityId") VALUES ($1, $2, $3, \'SUPPRESSION_CREATED\', \'SuppressionRecord\', $4)',
      [auditEventId, workspaceId, actorId, suppressionId],
    );
    await database.query(
      'INSERT INTO "SuppressionRecord" ("id", "workspaceId", "leadContactId", "channel", "reason", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'OPT_OUT\', $4, $5)',
      [suppressionId, workspaceId, contactId, actorId, auditEventId],
    );
    await database.exec("ROLLBACK");

    const counts = await database.query<{
      auditCount: number;
      suppressionCount: number;
    }>(
      'SELECT (SELECT count(*)::int FROM "AuditEvent" WHERE "id" = $1) AS "auditCount", (SELECT count(*)::int FROM "SuppressionRecord" WHERE "id" = $2) AS "suppressionCount"',
      [auditEventId, suppressionId],
    );
    expect(counts.rows[0]).toEqual({ auditCount: 0, suppressionCount: 0 });
  });

  it("prevents hard deletion of a user and retains their audit reference", async () => {
    const workspaceId = await createWorkspace(
      database,
      `user-retention-${id()}`,
    );
    const actorId = await createActor(database, workspaceId);
    const auditEventId = await createAuditEvent(
      database,
      workspaceId,
      actorId,
      "TEST_EVENT",
      "User",
      actorId,
    );

    await expect(
      database.query('DELETE FROM "User" WHERE "id" = $1', [actorId]),
    ).rejects.toThrow();
    await expect(
      database.query(
        'UPDATE "AuditEvent" SET "action" = \'REWRITTEN\' WHERE "id" = $1',
        [auditEventId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query('DELETE FROM "AuditEvent" WHERE "id" = $1', [
        auditEventId,
      ]),
    ).rejects.toThrow();
    const audit = await database.query<{ actorId: string }>(
      'SELECT "actorId" FROM "AuditEvent" WHERE "id" = $1',
      [auditEventId],
    );
    expect(audit.rows[0]?.actorId).toBe(actorId);
  });

  it("rejects allowed consent without evidence and accepts a fully evidenced record", async () => {
    const workspaceId = await createWorkspace(database, `consent-${id()}`);
    const actorId = await createActor(database, workspaceId);
    const { contactId } = await createLeadAndContact(database, workspaceId);
    const consentId = id();
    const auditEventId = await createAuditEvent(
      database,
      workspaceId,
      actorId,
      "CONSENT_RECORDED",
      "ConsentRecord",
      consentId,
    );

    await expect(
      database.query(
        'INSERT INTO "ConsentRecord" ("id", "workspaceId", "leadContactId", "channel", "purpose", "status", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'business follow-up\', \'ALLOWED_FOR_RECORDED_PURPOSE\', $4, $5)',
        [consentId, workspaceId, contactId, actorId, auditEventId],
      ),
    ).rejects.toThrow();

    await database.query(
      'INSERT INTO "ConsentRecord" ("id", "workspaceId", "leadContactId", "channel", "purpose", "status", "capturedAt", "evidenceReference", "recordedByUserId", "auditEventId") VALUES ($1, $2, $3, \'PHONE\', \'business follow-up\', \'ALLOWED_FOR_RECORDED_PURPOSE\', CURRENT_TIMESTAMP, \'synthetic://consent-proof\', $4, $5)',
      [consentId, workspaceId, contactId, actorId, auditEventId],
    );
    const accepted = await database.query<{ status: string }>(
      'SELECT "status"::text AS "status" FROM "ConsentRecord" WHERE "id" = $1',
      [consentId],
    );
    expect(accepted.rows[0]?.status).toBe("ALLOWED_FOR_RECORDED_PURPOSE");
    await expect(
      database.query(
        'UPDATE "ConsentRecord" SET "status" = \'UNKNOWN\' WHERE "id" = $1',
        [consentId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query('DELETE FROM "ConsentRecord" WHERE "id" = $1', [
        consentId,
      ]),
    ).rejects.toThrow();
  });

  it("accepts an explicitly unconfigured retention policy and rejects unapproved configured retention", async () => {
    const workspaceId = await createWorkspace(database, `retention-${id()}`);
    const unsetPolicyId = id();
    await database.query(
      'INSERT INTO "DataRetentionPolicy" ("id", "workspaceId", "category", "updatedAt") VALUES ($1, $2, \'RAW_WORKBOOK\', CURRENT_TIMESTAMP)',
      [unsetPolicyId, workspaceId],
    );

    await expect(
      database.query(
        'INSERT INTO "DataRetentionPolicy" ("id", "workspaceId", "category", "retentionDays", "updatedAt") VALUES ($1, $2, \'IMPORT_ROW_RESULTS\', 90, CURRENT_TIMESTAMP)',
        [id(), workspaceId],
      ),
    ).rejects.toThrow();
  });
});
