import { randomUUID } from "node:crypto";
import type { AuthPrincipal, AuthRole } from "@am-sme/auth";
import {
  evaluateContactTaskEligibility,
  type ContactTaskEligibility,
  type ContactabilityStatus,
} from "@am-sme/domain/contactability";
import type { LeadWorkspaceSqlDatabase } from "./lead-workspace.js";

export type TaskType =
  "REVIEW_LEAD" | "CALL" | "EMAIL" | "MEETING" | "FOLLOW_UP" | "INTERNAL";
export type TaskStatus =
  "OPEN" | "IN_PROGRESS" | "DONE" | "DEFERRED" | "CANCELLED";
export type TaskApprovalStatus =
  "NOT_REQUIRED" | "PENDING_AM_APPROVAL" | "APPROVED";
export type TaskContactChannel =
  "PHONE" | "EMAIL" | "SMS" | "ZALO" | "TELEGRAM";

export class TaskRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TaskRepositoryError";
  }
}

export interface CreateTaskInput {
  readonly assigneeUserId: string;
  readonly type: TaskType;
  readonly leadId?: string | null;
  readonly leadContactId?: string | null;
  readonly contactChannel?: TaskContactChannel | null;
  readonly outcomeGoal: string;
  readonly estimatedMinutes: number;
  readonly dueAt: Date;
  readonly priorityReason: string;
  readonly nextAction?: string | null;
}

export interface ProposeNextTaskInput {
  readonly type: TaskType;
  readonly leadId?: string | null;
  readonly leadContactId?: string | null;
  readonly contactChannel?: TaskContactChannel | null;
  readonly outcomeGoal: string;
  readonly estimatedMinutes: number;
  readonly dueAt: Date;
  readonly priorityReason: string;
  readonly nextAction?: string | null;
}

export interface TaskView {
  readonly id: string;
  readonly leadId: string | null;
  readonly leadContactId: string | null;
  readonly assigneeUserId: string;
  readonly assignedByUserId: string;
  readonly type: TaskType;
  readonly contactChannel: TaskContactChannel | null;
  readonly outcomeGoal: string;
  readonly estimatedMinutes: number;
  readonly dueAt: Date;
  readonly status: TaskStatus;
  readonly approvalStatus: TaskApprovalStatus;
  readonly priorityReason: string | null;
  readonly nextAction: string | null;
  readonly deferReason: string | null;
  readonly cancelReason: string | null;
  readonly completionOutcome: string | null;
  readonly suggestedService: string | null;
  readonly suggestedProductInterestId: string | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly completedAt: Date | null;
  readonly predecessorId: string | null;
  readonly leadStage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LockedTimeBlockView {
  readonly id: string;
  readonly userId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly label: string | null;
  readonly reason: string | null;
}

export interface CreateLockedTimeBlockInput {
  readonly userId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly label?: string | null;
  readonly reason?: string | null;
}

export interface DailyPlanInput {
  /** Local calendar day, interpreted strictly in Asia/Ho_Chi_Minh. */
  readonly day: string;
  /** Explicit local availability window; no unapproved work-hour defaults are assumed. */
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface PlannedTask {
  readonly task: TaskView;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}

export interface DailyPlan {
  readonly day: string;
  readonly timezone: "Asia/Ho_Chi_Minh";
  readonly targetCandidateRange: readonly [5, 8];
  readonly candidates: readonly TaskView[];
  readonly tasks: readonly PlannedTask[];
  readonly lockedBlocks: readonly LockedTimeBlockView[];
  readonly skipped: readonly {
    readonly taskId: string;
    readonly reason: string;
  }[];
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

interface TaskRow {
  id: string;
  workspaceId: string;
  leadId: string | null;
  leadContactId: string | null;
  assigneeUserId: string;
  assignedByUserId: string;
  approvedByUserId: string | null;
  suggestedProductInterestId: string | null;
  type: TaskType;
  contactChannel: TaskContactChannel | null;
  outcomeGoal: string;
  estimatedMinutes: number;
  dueAt: Date;
  status: TaskStatus;
  approvalStatus: TaskApprovalStatus;
  priorityReason: string | null;
  nextAction: string | null;
  deferReason: string | null;
  cancelReason: string | null;
  completionOutcome: string | null;
  suggestedService: string | null;
  approvedAt: Date | null;
  completedAt: Date | null;
  predecessorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  leadStage: string | null;
}

interface LeadScopeRow {
  ownerUserId: string | null;
  ownerTeamId: string | null;
}

interface AssignableRow {
  teamId: string | null;
}

interface ContactRow {
  contactabilityStatus: ContactabilityStatus;
  phoneNormalized: string | null;
  emailNormalized: string | null;
}

interface SourceRow {
  contactBasis: string;
}

interface ConsentRow {
  status: string;
  purpose: string;
  capturedAt: Date | null;
  evidenceReference: string | null;
}

interface LockedBlockRow {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  label: string | null;
  reason: string | null;
}

const CONTACT_TASK_TYPES = new Set<TaskType>([
  "CALL",
  "EMAIL",
  "MEETING",
  "FOLLOW_UP",
]);
const CONTACT_CHANNELS = new Set<TaskContactChannel>([
  "PHONE",
  "EMAIL",
  "SMS",
  "ZALO",
  "TELEGRAM",
]);
const ACTIONABLE_BASES = new Set([
  "CUSTOMER_REQUEST",
  "EXISTING_RELATIONSHIP",
  "CONSENT_RECORDED",
]);
const STAGE_ORDER = [
  "PENDING_REVIEW",
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "MEETING_SET",
  "PROPOSAL",
  "WON",
  "LOST",
] as const;
const HO_CHI_MINH_OFFSET_MS = 7 * 60 * 60 * 1000;
const TASK_SELECT = `SELECT t."id", t."workspaceId", t."leadId", t."leadContactId", t."assigneeUserId", t."assignedByUserId", t."approvedByUserId", t."suggestedProductInterestId", t."type"::text AS "type", t."contactChannel"::text AS "contactChannel", t."outcomeGoal", t."estimatedMinutes", t."dueAt", t."status"::text AS "status", t."approvalStatus"::text AS "approvalStatus", t."priorityReason", t."nextAction", t."deferReason", t."cancelReason", t."completionOutcome", t."suggestedService", t."approvedAt", t."completedAt", t."predecessorId", t."createdAt", t."updatedAt", l."stage"::text AS "leadStage" FROM "Task" t LEFT JOIN "Lead" l ON l."workspaceId" = t."workspaceId" AND l."id" = t."leadId"`;

function fail(code: string): never {
  throw new TaskRepositoryError(code);
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
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length > max) fail(code);
  return normalized || null;
}

function validDate(value: Date, code: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail(code);
  return value;
}

function isContactTask(type: TaskType): boolean {
  return CONTACT_TASK_TYPES.has(type);
}

function normalizeTaskInput(input: CreateTaskInput | ProposeNextTaskInput): {
  type: TaskType;
  leadId: string | null;
  leadContactId: string | null;
  contactChannel: TaskContactChannel | null;
  outcomeGoal: string;
  estimatedMinutes: number;
  dueAt: Date;
  priorityReason: string;
  nextAction: string | null;
} {
  const type = input.type;
  if (
    ![
      "REVIEW_LEAD",
      "CALL",
      "EMAIL",
      "MEETING",
      "FOLLOW_UP",
      "INTERNAL",
    ].includes(type)
  ) {
    fail("INVALID_TASK_TYPE");
  }
  const leadId = boundedText(input.leadId, 36, "INVALID_LEAD_ID");
  const leadContactId = boundedText(
    input.leadContactId,
    36,
    "INVALID_LEAD_CONTACT_ID",
  );
  if (leadContactId && !leadId) fail("LEAD_REQUIRED_FOR_CONTACT");
  const contactChannel = input.contactChannel ?? null;
  if (isContactTask(type)) {
    if (
      !leadId ||
      !leadContactId ||
      !contactChannel ||
      !CONTACT_CHANNELS.has(contactChannel)
    ) {
      fail("CONTACT_TASK_REFERENCE_REQUIRED");
    }
    if (type === "CALL" && contactChannel !== "PHONE")
      fail("CONTACT_CHANNEL_MISMATCH");
    if (type === "EMAIL" && contactChannel !== "EMAIL")
      fail("CONTACT_CHANNEL_MISMATCH");
  } else if (contactChannel !== null) {
    fail("CONTACT_CHANNEL_NOT_APPLICABLE");
  }
  if (
    !Number.isSafeInteger(input.estimatedMinutes) ||
    input.estimatedMinutes < 1 ||
    input.estimatedMinutes > 1440
  ) {
    fail("INVALID_TASK_DURATION");
  }
  return {
    type,
    leadId,
    leadContactId,
    contactChannel,
    outcomeGoal: boundedText(
      input.outcomeGoal,
      300,
      "INVALID_TASK_OUTCOME",
      true,
    )!,
    estimatedMinutes: input.estimatedMinutes,
    dueAt: validDate(input.dueAt, "INVALID_TASK_DUE_AT"),
    priorityReason: boundedText(
      input.priorityReason,
      300,
      "INVALID_TASK_PRIORITY",
      true,
    )!,
    nextAction: boundedText(input.nextAction, 500, "INVALID_NEXT_ACTION"),
  };
}

function planDayBounds(input: DailyPlanInput): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.day)) fail("INVALID_PLAN_DAY");
  const [year, month, day] = input.day.split("-").map(Number);
  const dateProbe = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    dateProbe.getUTCFullYear() !== year ||
    dateProbe.getUTCMonth() !== month! - 1 ||
    dateProbe.getUTCDate() !== day
  ) {
    fail("INVALID_PLAN_DAY");
  }
  const parseTime = (value: string): { hour: number; minute: number } => {
    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/u.exec(value);
    if (!match) fail("INVALID_PLANNING_WINDOW");
    return { hour: Number(match[1]), minute: Number(match[2]) };
  };
  const from = parseTime(input.windowStart);
  const to = parseTime(input.windowEnd);
  const startMinute = from.hour * 60 + from.minute;
  const endMinute = to.hour * 60 + to.minute;
  if (startMinute >= endMinute) fail("INVALID_PLANNING_WINDOW");
  const localMidnightUtc =
    Date.UTC(year!, month! - 1, day!) - HO_CHI_MINH_OFFSET_MS;
  return {
    start: new Date(localMidnightUtc + startMinute * 60_000),
    end: new Date(localMidnightUtc + endMinute * 60_000),
  };
}

function mapTask(row: TaskRow): TaskView {
  return {
    id: row.id,
    leadId: row.leadId,
    leadContactId: row.leadContactId,
    assigneeUserId: row.assigneeUserId,
    assignedByUserId: row.assignedByUserId,
    type: row.type,
    contactChannel: row.contactChannel,
    outcomeGoal: row.outcomeGoal,
    estimatedMinutes: row.estimatedMinutes,
    dueAt: new Date(row.dueAt),
    status: row.status,
    approvalStatus: row.approvalStatus,
    priorityReason: row.priorityReason,
    nextAction: row.nextAction,
    deferReason: row.deferReason,
    cancelReason: row.cancelReason,
    completionOutcome: row.completionOutcome,
    suggestedService: row.suggestedService,
    suggestedProductInterestId: row.suggestedProductInterestId,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt ? new Date(row.approvedAt) : null,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    predecessorId: row.predecessorId,
    leadStage: row.leadStage,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function mapBlock(row: LockedBlockRow): LockedTimeBlockView {
  return {
    id: row.id,
    userId: row.userId,
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    label: row.label,
    reason: row.reason,
  };
}

function compareTasks(
  a: TaskView,
  b: TaskView,
  windowStart: Date,
  windowEnd: Date,
): number {
  const urgency = (task: TaskView): number => {
    if (task.type === "FOLLOW_UP" && task.dueAt < windowStart) return 0;
    if (task.type === "FOLLOW_UP" && task.dueAt <= windowEnd) return 1;
    if (task.type === "MEETING") return 2;
    if (task.dueAt < windowStart) return 3;
    if (task.dueAt <= windowEnd) return 4;
    if (task.type === "FOLLOW_UP") return 5;
    return 6;
  };
  const urgencyDiff = urgency(a) - urgency(b);
  if (urgencyDiff !== 0) return urgencyDiff;
  if (a.dueAt.getTime() !== b.dueAt.getTime())
    return a.dueAt.getTime() - b.dueAt.getTime();
  const stageIndex = (stage: string | null): number => {
    const index = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
    return index < 0 ? STAGE_ORDER.length : index;
  };
  const stageDiff = stageIndex(a.leadStage) - stageIndex(b.leadStage);
  if (stageDiff !== 0) return stageDiff;
  return (
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
}

function findFreeSlot(
  from: Date,
  durationMinutes: number,
  end: Date,
  busy: readonly { startsAt: Date; endsAt: Date }[],
): { startsAt: Date; endsAt: Date } | null {
  let cursor = from.getTime();
  const duration = durationMinutes * 60_000;
  const ordered = [...busy].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  for (const interval of ordered) {
    if (interval.endsAt.getTime() <= cursor) continue;
    if (cursor + duration <= interval.startsAt.getTime()) {
      return {
        startsAt: new Date(cursor),
        endsAt: new Date(cursor + duration),
      };
    }
    if (
      cursor < interval.endsAt.getTime() &&
      cursor + duration > interval.startsAt.getTime()
    ) {
      cursor = interval.endsAt.getTime();
    }
  }
  if (cursor + duration <= end.getTime()) {
    return { startsAt: new Date(cursor), endsAt: new Date(cursor + duration) };
  }
  return null;
}

export class TaskRepository {
  constructor(private readonly database: LeadWorkspaceSqlDatabase) {}

  private async actor(principal: AuthPrincipal): Promise<ActorContext> {
    if (!principal?.userId || !principal.workspaceId) fail("FORBIDDEN");
    const rows = await this.database.query<ActorRow>(
      'SELECT tm."role"::text AS "role", tm."teamId" AS "teamId" FROM "User" u JOIN "TeamMembership" tm ON tm."workspaceId" = u."workspaceId" AND tm."userId" = u."id" WHERE u."workspaceId" = $1 AND u."id" = $2 AND u."status" = \'ACTIVE\'',
      [principal.workspaceId, principal.userId],
    );
    const row = rows[0];
    if (!row || row.role !== principal.role || row.teamId !== principal.teamId)
      fail("FORBIDDEN");
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
  ): Promise<void> {
    const rows = await database.query<LeadScopeRow>(
      'SELECT l."ownerUserId", tm."teamId" AS "ownerTeamId" FROM "Lead" l LEFT JOIN "TeamMembership" tm ON tm."workspaceId" = l."workspaceId" AND tm."userId" = l."ownerUserId" WHERE l."workspaceId" = $1 AND l."id" = $2',
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
  }

  private async assertAssignable(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    assigneeUserId: string,
  ): Promise<void> {
    const rows = await database.query<AssignableRow>(
      'SELECT tm."teamId" AS "teamId" FROM "User" u JOIN "TeamMembership" tm ON tm."workspaceId" = u."workspaceId" AND tm."userId" = u."id" WHERE u."workspaceId" = $1 AND u."id" = $2 AND u."status" = \'ACTIVE\' AND tm."role" = \'AM\'',
      [actor.workspaceId, assigneeUserId],
    );
    const target = rows[0];
    if (!target) fail("ASSIGNMENT_TARGET_INVALID");
    if (actor.role === "AM" && assigneeUserId !== actor.userId)
      fail("FORBIDDEN");
    if (
      actor.role === "MANAGER" &&
      (actor.teamId === null || target.teamId !== actor.teamId)
    ) {
      fail("ASSIGNMENT_OUT_OF_SCOPE");
    }
  }

  private async taskInScope(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    taskId: string,
    lock = false,
  ): Promise<TaskRow> {
    const rows = await database.query<TaskRow>(
      `${TASK_SELECT} JOIN "User" assignee ON assignee."workspaceId" = t."workspaceId" AND assignee."id" = t."assigneeUserId" LEFT JOIN "TeamMembership" assigneeMembership ON assigneeMembership."workspaceId" = assignee."workspaceId" AND assigneeMembership."userId" = assignee."id" WHERE t."workspaceId" = $1 AND t."id" = $2${lock ? " FOR UPDATE OF t" : ""}`,
      [actor.workspaceId, taskId],
    );
    const task = rows[0];
    if (!task) fail("NOT_FOUND_OR_FORBIDDEN");
    const membershipRows = await database.query<{ teamId: string | null }>(
      'SELECT "teamId" FROM "TeamMembership" WHERE "workspaceId" = $1 AND "userId" = $2',
      [actor.workspaceId, task.assigneeUserId],
    );
    const assigneeTeam = membershipRows[0]?.teamId ?? null;
    const allowed =
      actor.role === "ADMIN" ||
      (actor.role === "AM" && task.assigneeUserId === actor.userId) ||
      (actor.role === "MANAGER" &&
        actor.teamId !== null &&
        assigneeTeam === actor.teamId);
    if (!allowed) fail("NOT_FOUND_OR_FORBIDDEN");
    if (task.leadId) await this.leadInScope(database, actor, task.leadId);
    return task;
  }

  private async audit(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    action: string,
    entityType: "Task" | "LockedTimeBlock",
    entityId: string,
    changedFieldNames: readonly string[],
  ): Promise<void> {
    await database.execute(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "changedFieldNames") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        randomUUID(),
        actor.workspaceId,
        actor.userId,
        actor.role,
        action,
        entityType,
        entityId,
        [...changedFieldNames],
      ],
    );
  }

  private async contactEligibility(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    leadId: string,
    leadContactId: string,
    channel: TaskContactChannel,
    lockContact = false,
  ): Promise<ContactTaskEligibility> {
    const contactRows = await database.query<ContactRow>(
      `SELECT "contactabilityStatus"::text AS "contactabilityStatus", "phoneNormalized", "emailNormalized" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3${lockContact ? " FOR UPDATE" : ""}`,
      [actor.workspaceId, leadId, leadContactId],
    );
    const contact = contactRows[0];
    if (!contact) fail("NOT_FOUND_OR_FORBIDDEN");
    const [sources, consents, suppressions] = await Promise.all([
      database.query<SourceRow>(
        'SELECT "contactBasis"::text AS "contactBasis" FROM "LeadSource" WHERE "workspaceId" = $1 AND "leadId" = $2',
        [actor.workspaceId, leadId],
      ),
      database.query<ConsentRow>(
        'SELECT "status"::text AS "status", "purpose", "capturedAt", "evidenceReference" FROM "ConsentRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2 AND "channel" = $3::"ContactChannel" ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
        [actor.workspaceId, leadContactId, channel],
      ),
      database.query<{ id: string }>(
        'SELECT "id" FROM "SuppressionRecord" WHERE "workspaceId" = $1 AND "leadContactId" = $2 AND "channel" = $3::"ContactChannel" LIMIT 1',
        [actor.workspaceId, leadContactId, channel],
      ),
    ]);
    const consent = consents[0];
    const status: ContactabilityStatus =
      contact.contactabilityStatus === "OPTED_OUT" ||
      contact.contactabilityStatus === "SUPPRESSED"
        ? contact.contactabilityStatus
        : consent?.status === "ALLOWED_FOR_RECORDED_PURPOSE"
          ? contact.contactabilityStatus
          : consent?.status === "REVIEW_REQUIRED"
            ? "REVIEW_REQUIRED"
            : "UNKNOWN";
    const channelRouteExists =
      channel === "EMAIL"
        ? Boolean(contact.emailNormalized)
        : Boolean(contact.phoneNormalized);
    return evaluateContactTaskEligibility({
      status,
      hasSourceEvidence: sources.length > 0,
      hasContactBasis: sources.some((source) =>
        ACTIONABLE_BASES.has(source.contactBasis),
      ),
      hasConsentEvidence: Boolean(consent?.evidenceReference?.trim()),
      channelAllowed: channelRouteExists && CONTACT_CHANNELS.has(channel),
      hasPurpose: Boolean(consent?.purpose.trim()),
      hasConsentTimestamp: Boolean(
        consent?.capturedAt &&
        Number.isFinite(new Date(consent.capturedAt).getTime()),
      ),
      suppressed: suppressions.length > 0,
    });
  }

  private async suggestedService(
    database: LeadWorkspaceSqlDatabase,
    workspaceId: string,
    leadId: string | null,
  ): Promise<{ id: string; name: string } | null> {
    if (!leadId) return null;
    const rows = await database.query<{ id: string; productName: string }>(
      'SELECT "id", "productName" FROM "ProductInterest" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "status" = \'AM_CONFIRMED\' ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" ASC LIMIT 1',
      [workspaceId, leadId],
    );
    const row = rows[0];
    return row ? { id: row.id, name: row.productName } : null;
  }

  private async insertTask(
    database: LeadWorkspaceSqlDatabase,
    actor: ActorContext,
    assigneeUserId: string,
    input: CreateTaskInput | ProposeNextTaskInput,
    predecessorId: string | null,
    proposal: boolean,
  ): Promise<string> {
    const normalized = normalizeTaskInput(input);
    await this.assertAssignable(database, actor, assigneeUserId);
    if (normalized.leadId)
      await this.leadInScope(database, actor, normalized.leadId);
    if (normalized.leadContactId && normalized.leadId) {
      const matchingContact = await database.query<{ id: string }>(
        'SELECT "id" FROM "LeadContact" WHERE "workspaceId" = $1 AND "leadId" = $2 AND "id" = $3',
        [actor.workspaceId, normalized.leadId, normalized.leadContactId],
      );
      if (matchingContact.length === 0) fail("NOT_FOUND_OR_FORBIDDEN");
    }
    if (isContactTask(normalized.type) && !proposal) {
      const eligibility = await this.contactEligibility(
        database,
        actor,
        normalized.leadId!,
        normalized.leadContactId!,
        normalized.contactChannel!,
        true,
      );
      if (!eligibility.allowed) fail("CONTACT_TASK_BLOCKED");
    }
    const approvalStatus: TaskApprovalStatus = !isContactTask(normalized.type)
      ? "NOT_REQUIRED"
      : !proposal && actor.role === "AM" && assigneeUserId === actor.userId
        ? "APPROVED"
        : "PENDING_AM_APPROVAL";
    const approvedByUserId =
      approvalStatus === "APPROVED" ? actor.userId : null;
    const approvedAt = approvedByUserId ? new Date() : null;
    const suggestion = await this.suggestedService(
      database,
      actor.workspaceId,
      normalized.leadId,
    );
    const taskId = randomUUID();
    await database.execute(
      'INSERT INTO "Task" ("id", "workspaceId", "leadId", "leadContactId", "assigneeUserId", "assignedByUserId", "approvedByUserId", "suggestedProductInterestId", "type", "contactChannel", "outcomeGoal", "estimatedMinutes", "dueAt", "status", "approvalStatus", "priorityReason", "nextAction", "suggestedService", "approvedAt", "predecessorId", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"TaskType", $10::"ContactChannel", $11, $12, $13, \'OPEN\', $14::"TaskApprovalStatus", $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)',
      [
        taskId,
        actor.workspaceId,
        normalized.leadId,
        normalized.leadContactId,
        assigneeUserId,
        actor.userId,
        approvedByUserId,
        suggestion?.id ?? null,
        normalized.type,
        normalized.contactChannel,
        normalized.outcomeGoal,
        normalized.estimatedMinutes,
        normalized.dueAt,
        approvalStatus,
        normalized.priorityReason,
        normalized.nextAction,
        suggestion?.name ?? null,
        approvedAt,
        predecessorId,
      ],
    );
    await this.audit(
      database,
      actor,
      proposal ? "TASK_CONTACT_PROPOSED" : "TASK_CREATED",
      "Task",
      taskId,
      [
        "type",
        "assigneeUserId",
        "leadId",
        "leadContactId",
        "dueAt",
        "estimatedMinutes",
        "approvalStatus",
      ],
    );
    return taskId;
  }

  private async readTask(
    database: LeadWorkspaceSqlDatabase,
    workspaceId: string,
    taskId: string,
  ): Promise<TaskRow> {
    const rows = await database.query<TaskRow>(
      `${TASK_SELECT} WHERE t."workspaceId" = $1 AND t."id" = $2`,
      [workspaceId, taskId],
    );
    const row = rows[0];
    if (!row) fail("NOT_FOUND_OR_FORBIDDEN");
    return row;
  }

  async createTask(
    principal: AuthPrincipal,
    input: CreateTaskInput,
  ): Promise<TaskView> {
    const actor = await this.actor(principal);
    const taskId = await this.database.transaction((transaction) =>
      this.insertTask(
        transaction,
        actor,
        input.assigneeUserId,
        input,
        null,
        false,
      ),
    );
    return mapTask(
      await this.readTask(this.database, actor.workspaceId, taskId),
    );
  }

  async getTask(principal: AuthPrincipal, taskId: string): Promise<TaskView> {
    const actor = await this.actor(principal);
    const row = await this.taskInScope(this.database, actor, taskId);
    return mapTask(row);
  }

  async listTasks(
    principal: AuthPrincipal,
    filter: {
      readonly status?: TaskStatus;
      readonly assigneeUserId?: string;
    } = {},
  ): Promise<readonly TaskView[]> {
    const actor = await this.actor(principal);
    const clauses = ['t."workspaceId" = $1'];
    const values: unknown[] = [actor.workspaceId];
    if (actor.role === "AM") {
      clauses.push(`t."assigneeUserId" = $${values.push(actor.userId)}`);
    } else if (actor.role === "MANAGER") {
      clauses.push(
        `EXISTS (SELECT 1 FROM "TeamMembership" tm WHERE tm."workspaceId" = t."workspaceId" AND tm."userId" = t."assigneeUserId" AND tm."teamId" = $${values.push(actor.teamId)})`,
      );
    }
    if (filter.assigneeUserId) {
      if (actor.role === "AM" && filter.assigneeUserId !== actor.userId)
        fail("NOT_FOUND_OR_FORBIDDEN");
      if (actor.role === "MANAGER") {
        const target = await this.database.query<{ teamId: string | null }>(
          'SELECT "teamId" FROM "TeamMembership" WHERE "workspaceId" = $1 AND "userId" = $2 AND "role" = \'AM\'',
          [actor.workspaceId, filter.assigneeUserId],
        );
        if (!target[0] || target[0].teamId !== actor.teamId)
          fail("NOT_FOUND_OR_FORBIDDEN");
      }
      clauses.push(
        `t."assigneeUserId" = $${values.push(filter.assigneeUserId)}`,
      );
    }
    if (filter.status)
      clauses.push(`t."status" = $${values.push(filter.status)}::"TaskStatus"`);
    const rows = await this.database.query<TaskRow>(
      `${TASK_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY t."dueAt" ASC, t."createdAt" ASC, t."id" ASC`,
      values,
    );
    const visible: TaskView[] = [];
    for (const row of rows) {
      if (row.leadId) {
        try {
          await this.leadInScope(this.database, actor, row.leadId);
        } catch {
          continue;
        }
      }
      visible.push(mapTask(row));
    }
    return visible;
  }

  async assignTask(
    principal: AuthPrincipal,
    taskId: string,
    assigneeUserId: string,
  ): Promise<TaskView> {
    const actor = await this.actor(principal);
    await this.database.transaction(async (transaction) => {
      const task = await this.taskInScope(transaction, actor, taskId, true);
      if (task.status === "DONE" || task.status === "CANCELLED")
        fail("TASK_NOT_ASSIGNABLE");
      await this.assertAssignable(transaction, actor, assigneeUserId);
      const nextApproval: TaskApprovalStatus = isContactTask(task.type)
        ? "PENDING_AM_APPROVAL"
        : "NOT_REQUIRED";
      await transaction.execute(
        'UPDATE "Task" SET "assigneeUserId" = $1, "approvalStatus" = $2::"TaskApprovalStatus", "approvedByUserId" = NULL, "approvedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $3 AND "id" = $4',
        [assigneeUserId, nextApproval, actor.workspaceId, taskId],
      );
      await this.audit(transaction, actor, "TASK_ASSIGNED", "Task", taskId, [
        "assigneeUserId",
        "approvalStatus",
      ]);
    });
    return this.getTask(principal, taskId);
  }

  async completeTask(
    principal: AuthPrincipal,
    taskId: string,
    input: { readonly outcome: string; readonly nextAction?: string | null },
  ): Promise<TaskView> {
    const actor = await this.actor(principal);
    const outcome = boundedText(
      input.outcome,
      1000,
      "INVALID_TASK_OUTCOME",
      true,
    )!;
    const nextAction = boundedText(
      input.nextAction,
      500,
      "INVALID_NEXT_ACTION",
    );
    await this.database.transaction(async (transaction) => {
      const task = await this.taskInScope(transaction, actor, taskId, true);
      if (task.status !== "OPEN" && task.status !== "IN_PROGRESS")
        fail("TASK_NOT_COMPLETABLE");
      await transaction.execute(
        'UPDATE "Task" SET "status" = \'DONE\', "completionOutcome" = $1, "nextAction" = $2, "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $3 AND "id" = $4',
        [outcome, nextAction, actor.workspaceId, taskId],
      );
      await this.audit(transaction, actor, "TASK_COMPLETED", "Task", taskId, [
        "status",
        "completionOutcome",
        "nextAction",
        "completedAt",
      ]);
    });
    return this.getTask(principal, taskId);
  }

  async deferTask(
    principal: AuthPrincipal,
    taskId: string,
    input: {
      readonly reason: string;
      readonly proposedNextTask?: ProposeNextTaskInput;
    },
  ): Promise<{
    readonly task: TaskView;
    readonly proposedTask: TaskView | null;
  }> {
    const actor = await this.actor(principal);
    const reason = boundedText(
      input.reason,
      300,
      "INVALID_DEFER_REASON",
      true,
    )!;
    let proposalId: string | null = null;
    await this.database.transaction(async (transaction) => {
      const task = await this.taskInScope(transaction, actor, taskId, true);
      if (task.status !== "OPEN" && task.status !== "IN_PROGRESS")
        fail("TASK_NOT_DEFERRABLE");
      await transaction.execute(
        'UPDATE "Task" SET "status" = \'DEFERRED\', "deferReason" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "id" = $3',
        [reason, actor.workspaceId, taskId],
      );
      await this.audit(transaction, actor, "TASK_DEFERRED", "Task", taskId, [
        "status",
        "deferReason",
      ]);
      if (input.proposedNextTask) {
        proposalId = await this.insertTask(
          transaction,
          actor,
          task.assigneeUserId,
          input.proposedNextTask,
          taskId,
          true,
        );
      }
    });
    const deferredTask = await this.getTask(principal, taskId);
    const proposedTask = proposalId
      ? await this.getTask(principal, proposalId)
      : null;
    return { task: deferredTask, proposedTask };
  }

  async approveProposedContactTask(
    principal: AuthPrincipal,
    taskId: string,
  ): Promise<TaskView> {
    const actor = await this.actor(principal);
    if (actor.role !== "AM") fail("AM_APPROVAL_REQUIRED");
    await this.database.transaction(async (transaction) => {
      const task = await this.taskInScope(transaction, actor, taskId, true);
      if (task.assigneeUserId !== actor.userId) fail("NOT_FOUND_OR_FORBIDDEN");
      if (
        !isContactTask(task.type) ||
        task.approvalStatus !== "PENDING_AM_APPROVAL"
      )
        fail("TASK_NOT_PENDING_AM_APPROVAL");
      if (!task.leadId || !task.leadContactId || !task.contactChannel)
        fail("CONTACT_TASK_REFERENCE_REQUIRED");
      const eligibility = await this.contactEligibility(
        transaction,
        actor,
        task.leadId,
        task.leadContactId,
        task.contactChannel,
        true,
      );
      if (!eligibility.allowed) fail("CONTACT_TASK_BLOCKED");
      await transaction.execute(
        'UPDATE "Task" SET "approvalStatus" = \'APPROVED\', "approvedByUserId" = $1, "approvedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "id" = $3',
        [actor.userId, actor.workspaceId, taskId],
      );
      await this.audit(
        transaction,
        actor,
        "TASK_CONTACT_APPROVED",
        "Task",
        taskId,
        ["approvalStatus", "approvedByUserId", "approvedAt"],
      );
    });
    return this.getTask(principal, taskId);
  }

  async cancelTask(
    principal: AuthPrincipal,
    taskId: string,
    reason: string,
  ): Promise<TaskView> {
    const actor = await this.actor(principal);
    const cancelReason = boundedText(
      reason,
      300,
      "INVALID_CANCEL_REASON",
      true,
    )!;
    await this.database.transaction(async (transaction) => {
      const task = await this.taskInScope(transaction, actor, taskId, true);
      if (task.status === "DONE" || task.status === "CANCELLED")
        fail("TASK_NOT_CANCELLABLE");
      await transaction.execute(
        'UPDATE "Task" SET "status" = \'CANCELLED\', "cancelReason" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $2 AND "id" = $3',
        [cancelReason, actor.workspaceId, taskId],
      );
      await this.audit(transaction, actor, "TASK_CANCELLED", "Task", taskId, [
        "status",
        "cancelReason",
      ]);
    });
    return this.getTask(principal, taskId);
  }

  async createLockedTimeBlock(
    principal: AuthPrincipal,
    input: CreateLockedTimeBlockInput,
  ): Promise<LockedTimeBlockView> {
    const actor = await this.actor(principal);
    const startsAt = validDate(input.startsAt, "INVALID_LOCKED_BLOCK_TIME");
    const endsAt = validDate(input.endsAt, "INVALID_LOCKED_BLOCK_TIME");
    if (startsAt >= endsAt) fail("INVALID_LOCKED_BLOCK_RANGE");
    const label = boundedText(input.label, 160, "INVALID_LOCKED_BLOCK_LABEL");
    const reason = boundedText(
      input.reason,
      300,
      "INVALID_LOCKED_BLOCK_REASON",
    );
    const blockId = randomUUID();
    await this.database.transaction(async (transaction) => {
      await this.assertAssignable(transaction, actor, input.userId);
      const overlap = await transaction.query<{ id: string }>(
        'SELECT "id" FROM "LockedTimeBlock" WHERE "workspaceId" = $1 AND "userId" = $2 AND "startsAt" < $4 AND "endsAt" > $3 LIMIT 1',
        [actor.workspaceId, input.userId, startsAt, endsAt],
      );
      if (overlap.length > 0) fail("LOCKED_BLOCK_CONFLICT");
      await transaction.execute(
        'INSERT INTO "LockedTimeBlock" ("id", "workspaceId", "userId", "startsAt", "endsAt", "label", "reason") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          blockId,
          actor.workspaceId,
          input.userId,
          startsAt,
          endsAt,
          label,
          reason,
        ],
      );
      await this.audit(
        transaction,
        actor,
        "LOCKED_TIME_BLOCK_CREATED",
        "LockedTimeBlock",
        blockId,
        ["userId", "startsAt", "endsAt", "label", "reason"],
      );
    });
    return {
      id: blockId,
      userId: input.userId,
      startsAt,
      endsAt,
      label,
      reason,
    };
  }

  async listLockedTimeBlocks(
    principal: AuthPrincipal,
    input: { readonly from: Date; readonly to: Date; readonly userId?: string },
  ): Promise<readonly LockedTimeBlockView[]> {
    const actor = await this.actor(principal);
    const from = validDate(input.from, "INVALID_LOCKED_BLOCK_TIME");
    const to = validDate(input.to, "INVALID_LOCKED_BLOCK_TIME");
    if (from >= to) fail("INVALID_LOCKED_BLOCK_RANGE");
    const targetUserId =
      input.userId ?? (actor.role === "AM" ? actor.userId : null);
    const values: unknown[] = [actor.workspaceId, to, from];
    const clauses = [
      'b."workspaceId" = $1',
      'b."startsAt" < $2',
      'b."endsAt" > $3',
    ];
    if (actor.role === "AM") {
      if (targetUserId && targetUserId !== actor.userId)
        fail("NOT_FOUND_OR_FORBIDDEN");
      clauses.push(`b."userId" = $${values.push(actor.userId)}`);
    } else if (targetUserId) {
      const target = await this.database.query<{ teamId: string | null }>(
        'SELECT "teamId" FROM "TeamMembership" WHERE "workspaceId" = $1 AND "userId" = $2 AND "role" = \'AM\'',
        [actor.workspaceId, targetUserId],
      );
      if (
        !target[0] ||
        (actor.role === "MANAGER" && target[0].teamId !== actor.teamId)
      )
        fail("NOT_FOUND_OR_FORBIDDEN");
      clauses.push(`b."userId" = $${values.push(targetUserId)}`);
    } else if (actor.role === "MANAGER") {
      clauses.push(
        `EXISTS (SELECT 1 FROM "TeamMembership" tm WHERE tm."workspaceId" = b."workspaceId" AND tm."userId" = b."userId" AND tm."teamId" = $${values.push(actor.teamId)})`,
      );
    }
    const rows = await this.database.query<LockedBlockRow>(
      `SELECT b."id", b."userId", b."startsAt", b."endsAt", b."label", b."reason" FROM "LockedTimeBlock" b WHERE ${clauses.join(" AND ")} ORDER BY b."startsAt" ASC, b."id" ASC`,
      values,
    );
    return rows.map(mapBlock);
  }

  async getDailyPlan(
    principal: AuthPrincipal,
    input: DailyPlanInput,
  ): Promise<DailyPlan> {
    const actor = await this.actor(principal);
    if (actor.role !== "AM") fail("PLANNER_REQUIRES_AM");
    const { start, end } = planDayBounds(input);
    const rows = await this.database.query<TaskRow>(
      `${TASK_SELECT} WHERE t."workspaceId" = $1 AND t."assigneeUserId" = $2 AND t."status" IN ('OPEN', 'IN_PROGRESS') ORDER BY t."dueAt" ASC, t."createdAt" ASC`,
      [actor.workspaceId, actor.userId],
    );
    const blockRows = await this.database.query<LockedBlockRow>(
      'SELECT "id", "userId", "startsAt", "endsAt", "label", "reason" FROM "LockedTimeBlock" WHERE "workspaceId" = $1 AND "userId" = $2 AND "startsAt" < $4 AND "endsAt" > $3 ORDER BY "startsAt" ASC, "id" ASC',
      [actor.workspaceId, actor.userId, start, end],
    );
    const lockedBlocks = blockRows.map(mapBlock);
    const eligible: TaskView[] = [];
    const skipped: { taskId: string; reason: string }[] = [];
    for (const row of rows) {
      const task = mapTask(row);
      if (task.leadId) {
        try {
          await this.leadInScope(this.database, actor, task.leadId);
        } catch {
          skipped.push({ taskId: task.id, reason: "LEAD_OUT_OF_SCOPE" });
          continue;
        }
      }
      if (isContactTask(task.type)) {
        if (task.approvalStatus !== "APPROVED") {
          skipped.push({ taskId: task.id, reason: "AM_APPROVAL_REQUIRED" });
          continue;
        }
        if (!task.leadId || !task.leadContactId || !task.contactChannel) {
          skipped.push({
            taskId: task.id,
            reason: "CONTACT_TASK_REFERENCE_REQUIRED",
          });
          continue;
        }
        const eligibility = await this.contactEligibility(
          this.database,
          actor,
          task.leadId,
          task.leadContactId,
          task.contactChannel,
        );
        if (!eligibility.allowed) {
          skipped.push({
            taskId: task.id,
            reason: `CONTACT_TASK_BLOCKED:${eligibility.reason}`,
          });
          continue;
        }
      }
      eligible.push(task);
    }
    eligible.sort((a, b) => compareTasks(a, b, start, end));
    const candidates = eligible.slice(0, 8);
    const busy: { startsAt: Date; endsAt: Date }[] = lockedBlocks.map(
      (block) => ({ startsAt: block.startsAt, endsAt: block.endsAt }),
    );
    const planned: PlannedTask[] = [];
    for (const task of candidates) {
      const slot = findFreeSlot(start, task.estimatedMinutes, end, busy);
      if (!slot) {
        skipped.push({ taskId: task.id, reason: "NO_AVAILABLE_TIME" });
        continue;
      }
      if (task.dueAt >= start && slot.endsAt > task.dueAt) {
        skipped.push({ taskId: task.id, reason: "DEADLINE_CONFLICT" });
        continue;
      }
      planned.push({
        task,
        scheduledStartAt: slot.startsAt,
        scheduledEndAt: slot.endsAt,
      });
      busy.push({ startsAt: slot.startsAt, endsAt: slot.endsAt });
    }
    return {
      day: input.day,
      timezone: "Asia/Ho_Chi_Minh",
      targetCandidateRange: [5, 8],
      candidates,
      tasks: planned,
      lockedBlocks,
      skipped,
    };
  }
}
