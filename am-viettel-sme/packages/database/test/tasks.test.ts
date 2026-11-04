import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthPrincipal } from "@am-sme/auth";
import {
  LeadWorkspaceRepository,
  type LeadWorkspaceSqlDatabase,
} from "../src/lead-workspace.js";
import { TaskRepository, type TaskType } from "../src/tasks.js";

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
  constructor(private readonly database: PGlite) {}

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
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
        // Keep the original failure visible.
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
let leads: LeadWorkspaceRepository;
let tasks: TaskRepository;
let workspaceId: string;
let teamOneId: string;
let teamTwoId: string;
let amOne: ActorFixture;
let amTwo: ActorFixture;
let managerOne: ActorFixture;

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
}

async function createLead(
  actor: ActorFixture = amOne,
  withApprovedContact = false,
): Promise<{ leadId: string; contactId: string }> {
  const created = await leads.createLead(actor.principal, {
    companyName: `Synthetic Task Lead ${id()}`,
    contact: {
      contactName: "Synthetic Contact",
      phoneNormalized: "+84901234567",
      emailNormalized: "contact@example.invalid",
    },
  });
  const contactId = created.contactId!;
  if (withApprovedContact) {
    await leads.addSource(actor.principal, {
      leadId: created.leadId,
      sourceType: "AM_ENTERED",
      sourceLabel: "Synthetic customer request",
      contactBasis: "CUSTOMER_REQUEST",
    });
    await leads.reviewContactability(actor.principal, {
      leadId: created.leadId,
      contactId,
      channel: "PHONE",
      status: "ALLOWED_FOR_RECORDED_PURPOSE",
      purpose: "Synthetic requested follow-up",
      evidenceReference: "synthetic-evidence",
      capturedAt: new Date("2026-10-30T12:00:00.000Z"),
    });
  }
  return { leadId: created.leadId, contactId };
}

async function createTask(
  actor: ActorFixture,
  values: {
    type?: TaskType;
    leadId?: string | null;
    leadContactId?: string | null;
    contactChannel?: "PHONE" | "EMAIL" | "SMS" | "ZALO" | "TELEGRAM";
    dueAt?: Date;
    estimatedMinutes?: number;
    outcomeGoal?: string;
  } = {},
): Promise<string> {
  const task = await tasks.createTask(actor.principal, {
    assigneeUserId: actor.userId,
    type: values.type ?? "INTERNAL",
    leadId: values.leadId ?? null,
    leadContactId: values.leadContactId ?? null,
    ...(values.contactChannel ? { contactChannel: values.contactChannel } : {}),
    outcomeGoal: values.outcomeGoal ?? "Synthetic task outcome",
    estimatedMinutes: values.estimatedMinutes ?? 30,
    dueAt: values.dueAt ?? new Date("2026-11-02T05:00:00.000Z"),
    priorityReason: "Synthetic priority reason",
    nextAction: "Synthetic next action",
  });
  return task.id;
}

async function count(table: string, where = "TRUE"): Promise<number> {
  const rows = await database.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "${table}" WHERE ${where}`,
  );
  return rows[0]?.count ?? 0;
}

const workWindow = {
  day: "2026-11-02",
  windowStart: "08:00",
  windowEnd: "17:00",
} as const;

describe("P0.6 Tasks and AM planner on synthetic PGlite", () => {
  beforeAll(async () => {
    rawDatabase = new PGlite();
    await rawDatabase.exec(migrationSql);
    database = new PGliteTestDatabase(rawDatabase);
    leads = new LeadWorkspaceRepository(database);
    tasks = new TaskRepository(database);
  });

  beforeEach(async () => {
    await createWorkspaceFixtures();
  });

  afterAll(async () => {
    await rawDatabase.close();
  });

  it("returns no day plan when the AM has no eligible tasks and does not cross AM scope", async () => {
    const otherTeamLead = await createLead(amTwo);
    const otherTaskId = await createTask(amTwo, {
      leadId: otherTeamLead.leadId,
    });
    const plan = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(plan.tasks).toEqual([]);
    expect(plan.lockedBlocks).toEqual([]);
    expect(plan.tasks.some((item) => item.task.id === otherTaskId)).toBe(false);

    await expect(
      tasks.getDailyPlan(managerOne.principal, workWindow),
    ).rejects.toMatchObject({
      code: "PLANNER_REQUIRES_AM",
    });
  });

  it("limits an overloaded plan to eight candidates without dropping the underlying tasks", async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => createTask(amOne)),
    );
    const before = await count("Task", `"workspaceId" = '${workspaceId}'`);
    const plan = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(plan.candidates).toHaveLength(8);
    expect(plan.tasks).toHaveLength(8);
    expect(new Set(plan.tasks.map((item) => item.task.id)).size).toBe(8);
    expect(await count("Task", `"workspaceId" = '${workspaceId}'`)).toBe(
      before,
    );
    expect(ids).toHaveLength(10);
  });

  it("orders overdue and due follow-ups first, then considers lead stage", async () => {
    const { leadId, contactId } = await createLead(amOne, true);
    const lateStageLead = await createLead(amOne, true);
    await leads.addSource(amOne.principal, {
      leadId: lateStageLead.leadId,
      sourceType: "AM_ENTERED",
      sourceLabel: "Synthetic source",
      contactBasis: "CUSTOMER_REQUEST",
    });
    await leads.transitionStage(amOne.principal, lateStageLead.leadId, "NEW");
    await leads.transitionStage(
      amOne.principal,
      lateStageLead.leadId,
      "QUALIFIED",
    );
    const overdueId = await createTask(amOne, {
      type: "FOLLOW_UP",
      leadId,
      leadContactId: contactId,
      contactChannel: "PHONE",
      dueAt: new Date("2026-11-01T12:00:00.000Z"),
    });
    const dueId = await createTask(amOne, {
      type: "FOLLOW_UP",
      leadId: lateStageLead.leadId,
      leadContactId: lateStageLead.contactId,
      contactChannel: "PHONE",
      dueAt: new Date("2026-11-02T03:00:00.000Z"),
    });
    const plan = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(plan.tasks.slice(0, 2).map((item) => item.task.id)).toEqual([
      overdueId,
      dueId,
    ]);
    expect(plan.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  it("plans around manually entered locked blocks and never changes or deletes them", async () => {
    await createTask(amOne, { estimatedMinutes: 60 });
    const block = await tasks.createLockedTimeBlock(amOne.principal, {
      userId: amOne.userId,
      startsAt: new Date("2026-11-02T01:00:00.000Z"),
      endsAt: new Date("2026-11-02T02:00:00.000Z"),
      label: "Synthetic appointment",
      reason: "Manually entered",
    });
    const before = await database.query<{
      startsAt: Date;
      endsAt: Date;
      label: string;
    }>(
      'SELECT "startsAt", "endsAt", "label" FROM "LockedTimeBlock" WHERE "workspaceId" = $1 AND "id" = $2',
      [workspaceId, block.id],
    );
    const plan = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(plan.tasks[0]?.scheduledStartAt.toISOString()).toBe(
      "2026-11-02T02:00:00.000Z",
    );
    expect(plan.lockedBlocks).toHaveLength(1);
    expect(plan.lockedBlocks[0]?.id).toBe(block.id);
    const after = await database.query<{
      startsAt: Date;
      endsAt: Date;
      label: string;
    }>(
      'SELECT "startsAt", "endsAt", "label" FROM "LockedTimeBlock" WHERE "workspaceId" = $1 AND "id" = $2',
      [workspaceId, block.id],
    );
    expect(after).toEqual(before);
  });

  it("defers with an unapproved proposed contact task that requires assigned AM approval", async () => {
    const { leadId, contactId } = await createLead(amOne, true);
    const originalId = await createTask(amOne, { leadId });
    const deferred = await tasks.deferTask(amOne.principal, originalId, {
      reason: "Synthetic customer timing",
      proposedNextTask: {
        type: "CALL",
        leadId,
        leadContactId: contactId,
        contactChannel: "PHONE",
        outcomeGoal: "Synthetic proposed call",
        estimatedMinutes: 20,
        dueAt: new Date("2026-11-03T02:00:00.000Z"),
        priorityReason: "Customer requested later contact",
      },
    });
    expect(deferred.proposedTask).toMatchObject({
      approvalStatus: "PENDING_AM_APPROVAL",
    });
    const beforeApproval = await tasks.getDailyPlan(
      amOne.principal,
      workWindow,
    );
    expect(beforeApproval.tasks.map((item) => item.task.id)).not.toContain(
      deferred.proposedTask?.id,
    );
    await expect(
      tasks.approveProposedContactTask(
        amTwo.principal,
        deferred.proposedTask!.id,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND_OR_FORBIDDEN",
    });
    await tasks.approveProposedContactTask(
      amOne.principal,
      deferred.proposedTask!.id,
    );
    const afterApproval = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(afterApproval.tasks.map((item) => item.task.id)).toContain(
      deferred.proposedTask?.id,
    );
  });

  it("excludes newly suppressed leads from contact-task planning", async () => {
    const { leadId, contactId } = await createLead(amOne, true);
    const taskId = await createTask(amOne, {
      type: "FOLLOW_UP",
      leadId,
      leadContactId: contactId,
      contactChannel: "PHONE",
    });
    await leads.suppressContact(amOne.principal, {
      leadId,
      contactId,
      reason: "OPT_OUT",
    });
    const plan = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(plan.tasks.map((item) => item.task.id)).not.toContain(taskId);
  });

  it("regenerates the same plan without creating duplicate tasks", async () => {
    await Promise.all(Array.from({ length: 6 }, () => createTask(amOne)));
    const countBefore = await count("Task", `"workspaceId" = '${workspaceId}'`);
    const first = await tasks.getDailyPlan(amOne.principal, workWindow);
    const second = await tasks.getDailyPlan(amOne.principal, workWindow);
    expect(second.candidates.map((task) => task.id)).toEqual(
      first.candidates.map((task) => task.id),
    );
    expect(second.tasks.map((item) => item.task.id)).toEqual(
      first.tasks.map((item) => item.task.id),
    );
    expect(await count("Task", `"workspaceId" = '${workspaceId}'`)).toBe(
      countBefore,
    );
  });

  it("supports assign, complete, defer and cancel mutations with workspace audit", async () => {
    const { leadId } = await createLead();
    const taskId = await createTask(amOne, { leadId });
    await tasks.assignTask(managerOne.principal, taskId, amOne.userId);
    await tasks.completeTask(amOne.principal, taskId, {
      outcome: "Synthetic outcome recorded",
      nextAction: "Synthetic next step",
    });
    const done = await tasks.getTask(amOne.principal, taskId);
    expect(done).toMatchObject({
      status: "DONE",
      completionOutcome: "Synthetic outcome recorded",
    });

    const deferredId = await createTask(amOne);
    await tasks.deferTask(amOne.principal, deferredId, {
      reason: "Synthetic defer reason",
    });
    expect((await tasks.getTask(amOne.principal, deferredId)).status).toBe(
      "DEFERRED",
    );
    const cancelledId = await createTask(amOne);
    await tasks.cancelTask(
      amOne.principal,
      cancelledId,
      "Synthetic cancellation",
    );
    expect((await tasks.getTask(amOne.principal, cancelledId)).status).toBe(
      "CANCELLED",
    );
    expect(
      await count(
        "AuditEvent",
        `"workspaceId" = '${workspaceId}' AND "entityType" IN ('Task', 'LockedTimeBlock')`,
      ),
    ).toBeGreaterThanOrEqual(7);
  });

  it("suggests a service only when the lead already has an AM-confirmed product interest", async () => {
    const { leadId } = await createLead();
    const unreviewedInterestId = id();
    await database.execute(
      'INSERT INTO "ProductInterest" ("id", "workspaceId", "leadId", "productName", "status", "recordedByUserId", "updatedAt") VALUES ($1, $2, $3, $4, \'UNREVIEWED\', $5, CURRENT_TIMESTAMP)',
      [
        unreviewedInterestId,
        workspaceId,
        leadId,
        "Synthetic unreviewed service",
        amOne.userId,
      ],
    );
    const withoutApproval = await createTask(amOne, { leadId });
    expect(
      (await tasks.getTask(amOne.principal, withoutApproval)).suggestedService,
    ).toBeNull();

    const approvedInterestId = id();
    await database.execute(
      'INSERT INTO "ProductInterest" ("id", "workspaceId", "leadId", "productName", "status", "recordedByUserId", "updatedAt") VALUES ($1, $2, $3, $4, \'AM_CONFIRMED\', $5, CURRENT_TIMESTAMP)',
      [
        approvedInterestId,
        workspaceId,
        leadId,
        "Synthetic approved service",
        amOne.userId,
      ],
    );
    const withApproval = await createTask(amOne, { leadId });
    expect(await tasks.getTask(amOne.principal, withApproval)).toMatchObject({
      suggestedService: "Synthetic approved service",
      suggestedProductInterestId: approvedInterestId,
    });
  });

  it("fails closed on unapproved contactability and malformed/overlapping locked time blocks", async () => {
    const { leadId, contactId } = await createLead(amOne, false);
    await expect(
      createTask(amOne, {
        type: "CALL",
        leadId,
        leadContactId: contactId,
        contactChannel: "PHONE",
      }),
    ).rejects.toMatchObject({ code: "CONTACT_TASK_BLOCKED" });
    await expect(
      tasks.createTask(amOne.principal, {
        assigneeUserId: amOne.userId,
        type: "MEETING",
        leadId,
        leadContactId: contactId,
        contactChannel: "PHONE",
        outcomeGoal: "Synthetic meeting appointment",
        estimatedMinutes: 30,
        dueAt: new Date("2026-11-02T05:00:00.000Z"),
        priorityReason: "Synthetic reason",
      }),
    ).rejects.toMatchObject({ code: "CONTACT_TASK_BLOCKED" });
    await tasks.createLockedTimeBlock(amOne.principal, {
      userId: amOne.userId,
      startsAt: new Date("2026-11-02T01:00:00.000Z"),
      endsAt: new Date("2026-11-02T02:00:00.000Z"),
      label: "Synthetic block",
    });
    await expect(
      tasks.createLockedTimeBlock(amOne.principal, {
        userId: amOne.userId,
        startsAt: new Date("2026-11-02T01:30:00.000Z"),
        endsAt: new Date("2026-11-02T02:30:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "LOCKED_BLOCK_CONFLICT" });
  });
});
