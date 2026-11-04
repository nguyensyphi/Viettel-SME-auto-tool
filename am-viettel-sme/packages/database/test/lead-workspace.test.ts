import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthPrincipal } from "@am-sme/auth";
import {
  LeadWorkspaceError,
  LeadWorkspaceRepository,
  type LeadWorkspaceSqlDatabase,
} from "../src/lead-workspace.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const id = () => crypto.randomUUID();

class PGliteTestDatabase implements LeadWorkspaceSqlDatabase {
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
    work: (transaction: LeadWorkspaceSqlDatabase) => Promise<T>,
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
        // Ignore rollback errors after the original failure.
      }
      throw error;
    }
  }
}

interface ActorFixture {
  readonly principal: AuthPrincipal;
  readonly userId: string;
  readonly teamId: string | null;
}

let rawDatabase: PGlite;
let database: PGliteTestDatabase;
let repository: LeadWorkspaceRepository;
let workspaceId: string;
let teamOneId: string;
let teamTwoId: string;
let amOne: ActorFixture;
let amTwo: ActorFixture;
let managerOne: ActorFixture;
let managerTwo: ActorFixture;
let admin: ActorFixture;

async function createUser(
  role: AuthPrincipal["role"],
  teamId: string | null,
): Promise<ActorFixture> {
  const userId = id();
  await database.execute(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "displayName", "status", "updatedAt") VALUES ($1, $2, $3, $4, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [userId, workspaceId, `${userId}@example.invalid`, `Synthetic ${role}`],
  );
  await database.execute(
    'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "teamId", "role") VALUES ($1, $2, $3, $4, $5)',
    [id(), workspaceId, userId, teamId, role],
  );
  return {
    userId,
    teamId,
    principal: { userId, workspaceId, role, teamId },
  };
}

async function createWorkspaceFixtures(): Promise<void> {
  workspaceId = id();
  teamOneId = id();
  teamTwoId = id();
  await database.execute(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [workspaceId, `synthetic-${workspaceId}`, "Synthetic Workspace"],
  );
  await database.execute(
    'INSERT INTO "Team" ("id", "workspaceId", "name", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP), ($4, $2, $5, CURRENT_TIMESTAMP)',
    [
      teamOneId,
      workspaceId,
      "Synthetic Team One",
      teamTwoId,
      "Synthetic Team Two",
    ],
  );
  amOne = await createUser("AM", teamOneId);
  amTwo = await createUser("AM", teamTwoId);
  managerOne = await createUser("MANAGER", teamOneId);
  managerTwo = await createUser("MANAGER", teamTwoId);
  admin = await createUser("ADMIN", null);
}

async function createLead(
  actor: ActorFixture = amOne,
  name = "Synthetic North Star Co.",
  withContact = true,
): Promise<{ leadId: string; contactId: string | null }> {
  const created = await repository.createLead(actor.principal, {
    companyName: name,
    industry: "Synthetic telecom",
    district: "Synthetic District",
    ...(withContact
      ? {
          contact: {
            contactName: "Synthetic Contact",
            jobTitle: "Synthetic Manager",
            phoneNormalized: "+84901234567",
            emailNormalized: "contact@example.invalid",
          },
        }
      : {}),
  });
  return created;
}

async function count(table: string, where = "TRUE"): Promise<number> {
  const rows = await database.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "${table}" WHERE ${where}`,
  );
  return rows[0]?.count ?? 0;
}

describe("P0.5 lead workspace and timeline on PGlite", () => {
  beforeAll(async () => {
    rawDatabase = new PGlite();
    await rawDatabase.exec(migrationSql);
    database = new PGliteTestDatabase(rawDatabase);
    repository = new LeadWorkspaceRepository(database);
  });

  beforeEach(async () => {
    await createWorkspaceFixtures();
  });

  afterAll(async () => {
    await rawDatabase.close();
  });

  it("creates leads at PENDING_REVIEW, masks list PII, and supports scoped search and filters", async () => {
    const created = await createLead();
    const otherTeamLead = await createLead(amTwo, "Synthetic South Star Co.");

    const amPage = await repository.listLeads(amOne.principal, {
      search: "north star",
      stage: "PENDING_REVIEW",
    });
    expect(amPage.total).toBe(1);
    expect(amPage.items[0]).toMatchObject({
      id: created.leadId,
      companyName: "Synthetic North Star Co.",
      stage: "PENDING_REVIEW",
      contacts: [
        {
          contactName: "S*** Contact",
          phone: "+84•••••4567",
          email: "c*****t@example.invalid",
        },
      ],
    });
    expect(amPage.items[0]).not.toHaveProperty("phoneNormalized");
    await expect(
      repository.getLeadDetail(amOne.principal, otherTeamLead.leadId),
    ).rejects.toMatchObject({ code: "NOT_FOUND_OR_FORBIDDEN" });

    const managerPage = await repository.listLeads(managerOne.principal);
    expect(managerPage.items.map((item) => item.id)).toContain(created.leadId);
    expect(managerPage.items.map((item) => item.id)).not.toContain(
      otherTeamLead.leadId,
    );
    const adminPage = await repository.listLeads(admin.principal);
    expect(adminPage.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([created.leadId, otherTeamLead.leadId]),
    );
  });

  it("updates allow-listed lead/contact fields without changing contactability and audits field names only", async () => {
    const { leadId, contactId } = await createLead();
    await repository.updateLead(amOne.principal, leadId, {
      companyName: "Synthetic North Star Updated",
      industry: "Synthetic cloud services",
      contact: {
        contactId: contactId!,
        contactName: "Synthetic Updated Contact",
        phoneNormalized: "+84987654321",
      },
    });

    const detail = await repository.getLeadDetail(amOne.principal, leadId);
    expect(detail.companyName).toBe("Synthetic North Star Updated");
    expect(detail.contacts[0]).toMatchObject({
      contactabilityStatus: "UNKNOWN",
      phone: "+84•••••4321",
    });
    const events = await database.query<{
      action: string;
      changedFieldNames: string[];
    }>(
      'SELECT "action", "changedFieldNames" FROM "AuditEvent" WHERE "workspaceId" = $1 AND "entityId" = $2',
      [workspaceId, leadId],
    );
    expect(
      events.some((event) => event.changedFieldNames.includes("companyName")),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("+84987654321");
    expect(JSON.stringify(events)).not.toContain("Synthetic Updated Contact");
  });

  it("enforces AM and manager assignment boundaries using current workspace/team membership", async () => {
    const created = await createLead();
    await expect(
      repository.assignLead(amOne.principal, created.leadId, amOne.userId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      repository.assignLead(managerOne.principal, created.leadId, amTwo.userId),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_OUT_OF_SCOPE" });

    await repository.assignLead(
      managerOne.principal,
      created.leadId,
      amOne.userId,
    );
    expect(
      await count(
        "AuditEvent",
        `"workspaceId" = '${workspaceId}' AND "action" = 'LEAD_ASSIGNED'`,
      ),
    ).toBe(1);

    await expect(
      repository.assignLead(managerTwo.principal, created.leadId, amTwo.userId),
    ).rejects.toMatchObject({ code: "NOT_FOUND_OR_FORBIDDEN" });
  });

  it("enforces only the documented sequential lifecycle and requires a source before leaving review and qualifying", async () => {
    const { leadId } = await createLead();
    await expect(
      repository.transitionStage(amOne.principal, leadId, "QUALIFIED"),
    ).rejects.toMatchObject({ code: "INVALID_STAGE_TRANSITION" });
    await expect(
      repository.transitionStage(amOne.principal, leadId, "NEW"),
    ).rejects.toMatchObject({ code: "SOURCE_REQUIRED" });

    await repository.addSource(amOne.principal, {
      leadId,
      sourceType: "AM_ENTERED",
      sourceLabel: "Synthetic customer referral",
      contactBasis: "CUSTOMER_REQUEST",
    });
    await repository.transitionStage(amOne.principal, leadId, "NEW");
    await expect(
      repository.transitionStage(amOne.principal, leadId, "CONTACTED"),
    ).rejects.toMatchObject({ code: "INVALID_STAGE_TRANSITION" });
    await repository.transitionStage(amOne.principal, leadId, "QUALIFIED");
    await repository.transitionStage(amOne.principal, leadId, "CONTACTED");
    await repository.transitionStage(amOne.principal, leadId, "MEETING_SET");
    await repository.transitionStage(amOne.principal, leadId, "PROPOSAL");
    await repository.transitionStage(amOne.principal, leadId, "LOST");
    await expect(
      repository.transitionStage(amOne.principal, leadId, "NEW"),
    ).rejects.toMatchObject({ code: "INVALID_STAGE_TRANSITION" });

    const detail = await repository.getLeadDetail(amOne.principal, leadId);
    expect(detail.stage).toBe("LOST");
    expect(
      detail.timeline.filter((item) => item.kind === "STAGE_CHANGED"),
    ).toHaveLength(6);
    expect(
      detail.timeline.some(
        (item) => item.beforeStage === "PROPOSAL" && item.afterStage === "LOST",
      ),
    ).toBe(true);
  });

  it("requires web URLs, records source provenance, and allows qualification only with a persisted source", async () => {
    const { leadId } = await createLead();
    await expect(
      repository.addSource(amOne.principal, {
        leadId,
        sourceType: "WEB_SOURCE",
        sourceLabel: "Synthetic website",
        contactBasis: "UNKNOWN",
        sourceUrl: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE_URL" });

    const { sourceId } = await repository.addSource(amOne.principal, {
      leadId,
      sourceType: "WEB_SOURCE",
      sourceLabel: "Synthetic company page",
      contactBasis: "OTHER_REVIEW_REQUIRED",
      sourceUrl: "https://example.invalid/synthetic-source",
      collectedAt: new Date("2026-10-31T12:00:00.000Z"),
    });
    const detail = await repository.getLeadDetail(amOne.principal, leadId);
    expect(detail.sources).toEqual([
      expect.objectContaining({
        id: sourceId,
        sourceType: "WEB_SOURCE",
        sourceLabel: "Synthetic company page",
        contactBasis: "OTHER_REVIEW_REQUIRED",
      }),
    ]);
    expect(detail.timeline.some((item) => item.kind === "SOURCE_ADDED")).toBe(
      true,
    );
    await repository.transitionStage(amOne.principal, leadId, "NEW");
    await repository.transitionStage(amOne.principal, leadId, "QUALIFIED");
  });

  it("requires evidence and actor for allowed contactability and only opens the evidenced channel", async () => {
    const { leadId, contactId } = await createLead();
    await repository.addSource(amOne.principal, {
      leadId,
      sourceType: "CUSTOMER_REQUEST",
      sourceLabel: "Synthetic inbound request",
      contactBasis: "CUSTOMER_REQUEST",
    });

    await expect(
      repository.reviewContactability(amOne.principal, {
        leadId,
        contactId: contactId!,
        channel: "PHONE",
        status: "ALLOWED_FOR_RECORDED_PURPOSE",
        purpose: "Respond to synthetic customer request",
        evidenceReference: "",
        capturedAt: new Date("2026-10-31T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CONSENT_EVIDENCE_REQUIRED" });

    expect(
      await repository.canContact(amOne.principal, leadId, contactId!, "PHONE"),
    ).toMatchObject({ allowed: false, reason: "CONTACTABILITY_NOT_APPROVED" });

    await repository.reviewContactability(amOne.principal, {
      leadId,
      contactId: contactId!,
      channel: "PHONE",
      status: "REVIEW_REQUIRED",
      purpose: "Review synthetic inbound request",
    });
    expect(
      await repository.canContact(amOne.principal, leadId, contactId!, "PHONE"),
    ).toMatchObject({ allowed: false, reason: "CONTACTABILITY_NOT_APPROVED" });

    await repository.reviewContactability(amOne.principal, {
      leadId,
      contactId: contactId!,
      channel: "PHONE",
      status: "ALLOWED_FOR_RECORDED_PURPOSE",
      purpose: "Respond to synthetic customer request",
      evidenceReference: "synthetic-evidence-001",
      capturedAt: new Date("2026-10-31T12:00:00.000Z"),
    });
    expect(
      await repository.canContact(amOne.principal, leadId, contactId!, "PHONE"),
    ).toMatchObject({ allowed: true, reason: "ELIGIBLE" });
    expect(
      await repository.canContact(amOne.principal, leadId, contactId!, "EMAIL"),
    ).toMatchObject({ allowed: false });
    expect(await count("Task", `"workspaceId" = '${workspaceId}'`)).toBe(0);

    const auditRows = await database.query<{ action: string }>(
      'SELECT "action" FROM "AuditEvent" WHERE "workspaceId" = $1 AND "entityId" = $2',
      [workspaceId, contactId],
    );
    expect(
      auditRows.some((row) => row.action === "CONTACTABILITY_REVIEWED"),
    ).toBe(true);
    const audits = await database.query<{ evidenceReference: string }>(
      'SELECT "evidenceReference" FROM "ConsentRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2',
      [workspaceId, contactId],
    );
    expect(JSON.stringify(audits)).toContain("synthetic-evidence-001");
  });

  it("suppresses all channels atomically, fails closed, appends audit, and cannot be reopened through review", async () => {
    const { leadId, contactId } = await createLead();
    await repository.addSource(amOne.principal, {
      leadId,
      sourceType: "CUSTOMER_REQUEST",
      sourceLabel: "Synthetic inbound request",
      contactBasis: "CUSTOMER_REQUEST",
    });
    await repository.reviewContactability(amOne.principal, {
      leadId,
      contactId: contactId!,
      channel: "PHONE",
      status: "ALLOWED_FOR_RECORDED_PURPOSE",
      purpose: "Respond to synthetic customer request",
      evidenceReference: "synthetic-evidence-002",
      capturedAt: new Date("2026-10-31T12:00:00.000Z"),
    });

    await repository.suppressContact(amOne.principal, {
      leadId,
      contactId: contactId!,
      reason: "OPT_OUT",
    });
    expect(
      await count(
        "SuppressionRecord",
        `"workspaceId" = '${workspaceId}' AND "leadContactId" = '${contactId}'`,
      ),
    ).toBe(5);
    expect(
      await count(
        "AuditEvent",
        `"workspaceId" = '${workspaceId}' AND "entityType" = 'LeadContact' AND "entityId" = '${contactId}' AND "action" = 'LEAD_CONTACT_SUPPRESSED'`,
      ),
    ).toBe(1);
    expect(
      await count(
        "AuditEvent",
        `"workspaceId" = '${workspaceId}' AND "entityType" = 'SuppressionRecord' AND "action" = 'SUPPRESSION_CREATED'`,
      ),
    ).toBe(5);
    expect(
      await repository.canContact(amOne.principal, leadId, contactId!, "PHONE"),
    ).toMatchObject({ allowed: false, reason: "SUPPRESSED" });
    await expect(
      repository.reviewContactability(amOne.principal, {
        leadId,
        contactId: contactId!,
        channel: "PHONE",
        status: "ALLOWED_FOR_RECORDED_PURPOSE",
        purpose: "Respond to synthetic customer request",
        evidenceReference: "synthetic-evidence-003",
        capturedAt: new Date("2026-10-31T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "SUPPRESSION_ACTIVE" });

    const auditPayload = await database.query<{
      beforeContactabilityStatus: string | null;
      afterContactabilityStatus: string | null;
    }>(
      'SELECT "beforeContactabilityStatus", "afterContactabilityStatus" FROM "AuditEvent" WHERE "workspaceId" = $1 AND "entityId" = $2 AND "action" = \'LEAD_CONTACT_SUPPRESSED\'',
      [workspaceId, contactId],
    );
    expect(
      auditPayload.every(
        (row) => row.afterContactabilityStatus === "SUPPRESSED",
      ),
    ).toBe(true);
  });

  it("rolls back suppression if audit append fails", async () => {
    const { leadId, contactId } = await createLead();
    database.failNextAuditAppend = true;
    await expect(
      repository.suppressContact(amOne.principal, {
        leadId,
        contactId: contactId!,
        reason: "COMPLAINT",
      }),
    ).rejects.toThrow();
    expect(
      await count(
        "SuppressionRecord",
        `"workspaceId" = '${workspaceId}' AND "leadContactId" = '${contactId}'`,
      ),
    ).toBe(0);
    const contact = await database.query<{ contactabilityStatus: string }>(
      'SELECT "contactabilityStatus" FROM "LeadContact" WHERE "workspaceId" = $1 AND "id" = $2',
      [workspaceId, contactId],
    );
    expect(contact[0]?.contactabilityStatus).toBe("UNKNOWN");
  });

  it("adds and updates notes and product interest without leaking contents to audit", async () => {
    const { leadId } = await createLead();
    const { noteId } = await repository.addNote(
      amOne.principal,
      leadId,
      "Synthetic note: follow up next week.",
    );
    await repository.updateNote(
      amOne.principal,
      leadId,
      noteId,
      "Synthetic note: customer requested a later review.",
    );
    const interest = await repository.setProductInterest(amOne.principal, {
      leadId,
      productCode: "SYNTHETIC_CLOUD",
      productName: "Synthetic Cloud Package",
      status: "AM_CONFIRMED",
    });
    const updatedInterest = await repository.setProductInterest(
      amOne.principal,
      {
        leadId,
        productCode: "SYNTHETIC_CLOUD",
        productName: "Synthetic Cloud Package",
        status: "REJECTED",
      },
    );
    expect(updatedInterest.productInterestId).toBe(interest.productInterestId);

    const detail = await repository.getLeadDetail(amOne.principal, leadId);
    expect(detail.notes).toEqual([
      expect.objectContaining({
        id: noteId,
        content: "Synthetic note: customer requested a later review.",
      }),
    ]);
    expect(detail.productInterests).toEqual([
      expect.objectContaining({
        productCode: "SYNTHETIC_CLOUD",
        status: "REJECTED",
      }),
    ]);
    expect(detail.timeline.some((item) => item.kind === "NOTE_ADDED")).toBe(
      true,
    );
    expect(detail.timeline.some((item) => item.kind === "NOTE_UPDATED")).toBe(
      true,
    );
    expect(
      detail.timeline.some((item) => item.kind === "PRODUCT_INTEREST_UPDATED"),
    ).toBe(true);
    const audits = await database.query<{
      action: string;
      changedFieldNames: string[];
    }>(
      'SELECT "action", "changedFieldNames" FROM "AuditEvent" WHERE "workspaceId" = $1 AND "entityType" = \'Lead\' AND "entityId" = $2',
      [workspaceId, leadId],
    );
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "LEAD_NOTE_ADDED",
        "LEAD_NOTE_UPDATED",
        "PRODUCT_INTEREST_UPDATED",
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain(
      "customer requested a later review",
    );
  });

  it("rejects malformed fields and spoofed actor context", async () => {
    await expect(
      repository.createLead(amOne.principal, { companyName: "  " }),
    ).rejects.toBeInstanceOf(LeadWorkspaceError);
    const { leadId } = await createLead();
    await expect(
      repository.getLeadDetail({ ...amOne.principal, role: "ADMIN" }, leadId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      repository.addNote(amOne.principal, leadId, "x".repeat(5001)),
    ).rejects.toMatchObject({ code: "INVALID_NOTE" });
  });
});
