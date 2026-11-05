import { randomUUID } from "node:crypto";
import {
  HttpAuthGuard,
  type AuthPrincipal,
  type AuthRole,
  type LocalAuthService,
} from "@am-sme/auth";
import type {
  CreateLeadInput,
  LeadDetail,
  LeadListItem,
  LeadWorkspaceRepository as LeadRepository,
  UpdateLeadInput,
} from "@am-sme/database/lead-workspace";
import type {
  CreateTaskInput,
  DailyPlan,
  TaskView,
  TaskRepository as TasksRepository,
} from "@am-sme/database/tasks";
import type { ImportPreviewPort } from "./import-api.js";
import { InMemoryImportApi } from "./import-api.js";
import { WorkspaceOperationsHub } from "./operations-hub.js";
import type { ApiServices, SqlPort } from "./http-api.js";

const DEFAULT_WORKSPACE = "viettel-sme";

interface DemoUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AuthRole;
  readonly teamId: string | null;
}

const DEMO_USERS: DemoUser[] = [
  {
    id: "user-admin",
    email: "admin@viettel.vn",
    displayName: "Nguyễn Văn Admin (Viettel HCM)",
    role: "ADMIN",
    teamId: null,
  },
  {
    id: "user-mgr",
    email: "manager@viettel.vn",
    displayName: "Trần Thị Trưởng Phòng (Viettel Dĩ An)",
    role: "MANAGER",
    teamId: "team-dian",
  },
  {
    id: "user-am",
    email: "am@viettel.vn",
    displayName: "Lê Văn AM (Viettel Dĩ An)",
    role: "AM",
    teamId: "team-dian",
  },
];

interface StoredLead {
  id: string;
  workspaceId: string;
  companyName: string;
  industry: string;
  district: string;
  province: string;
  stage: string;
  ownerUserId: string;
  ownerName: string;
  contactName: string;
  phone: string;
  email: string;
  contactabilityStatus: string;
  notes: { id: string; content: string; createdAt: string; authorName: string }[];
  timeline: { id: string; type: string; summary: string; createdAt: string }[];
  productInterests: { id: string; productName: string; status: string }[];
}

interface StoredTask {
  id: string;
  workspaceId: string;
  assigneeUserId: string;
  type: string;
  outcomeGoal: string;
  dueAt: string;
  estimatedMinutes: number;
  approvalStatus: string;
  leadId: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "DEFERRED" | "CANCELLED";
}

export function createDemoApiServices(): ApiServices {
  const sessions = new Map<string, { principal: AuthPrincipal; expiresAt: Date }>();
  let activeUsers: DemoUser[] = [...DEMO_USERS];

  const leadsStore: StoredLead[] = [
    {
      id: "lead-01",
      workspaceId: DEFAULT_WORKSPACE,
      companyName: "Công ty TNHH Cơ Khí & Chế Tạo Dĩ An",
      industry: "Cơ khí chế tạo",
      district: "Dĩ An",
      province: "Bình Dương",
      stage: "NEW",
      ownerUserId: "user-am",
      ownerName: "Lê Văn AM",
      contactName: "Trần Văn Bình (Giám đốc)",
      phone: "0903123456",
      email: "binh@cokhidian.vn",
      contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
      notes: [
        {
          id: "note-1",
          content: "Khách hàng có nhu cầu chuyển đổi số hóa đơn điện tử S-Invoice và VBHXH cho 85 công nhân.",
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          authorName: "Lê Văn AM",
        },
      ],
      timeline: [
        {
          id: "tl-1",
          type: "LEAD_CREATED",
          summary: "Tạo lead từ danh sách KCN Sóng Thần 1",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      productInterests: [
        { id: "pi-1", productName: "Chữ ký số Viettel-CA", status: "AM_CONFIRMED" },
        { id: "pi-2", productName: "Bảo hiểm xã hội điện tử vBHXH", status: "AM_CONFIRMED" },
        { id: "pi-3", productName: "Di động trả sau Doanh nghiệp", status: "AM_CONFIRMED" },
      ],
    },
    {
      id: "lead-02",
      workspaceId: DEFAULT_WORKSPACE,
      companyName: "Công ty CP Giải Pháp Phần Mềm Bình Dương",
      industry: "Công nghệ thông tin",
      district: "Dĩ An",
      province: "Bình Dương",
      stage: "QUALIFIED",
      ownerUserId: "user-am",
      ownerName: "Lê Văn AM",
      contactName: "Nguyễn Thu Hà (Kế toán trưởng)",
      phone: "0988776655",
      email: "ha@bdsoft.vn",
      contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
      notes: [],
      timeline: [
        {
          id: "tl-2",
          type: "STAGE_CHANGE",
          summary: "Chuyển sang giai đoạn QUALIFIED sau cuộc gọi thẩm định",
          createdAt: new Date(Date.now() - 43200000).toISOString(),
        },
      ],
      productInterests: [
        { id: "pi-4", productName: "Phần mềm Quản trị Nhân sự Easy HRM", status: "AM_CONFIRMED" },
        { id: "pi-5", productName: "Văn phòng điện tử VOffice", status: "AM_CONFIRMED" },
      ],
    },
    {
      id: "lead-03",
      workspaceId: DEFAULT_WORKSPACE,
      companyName: "Hộ Kinh Doanh Dịch Vụ Vận Tải An Bình",
      industry: "Vận tải & Logistics",
      district: "Dĩ An",
      province: "Bình Dương",
      stage: "CONTACTED",
      ownerUserId: "user-am",
      ownerName: "Lê Văn AM",
      contactName: "Đặng Hữu Phúc (Chủ hộ)",
      phone: "0912987654",
      email: "phuc@vantaianbinh.vn",
      contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
      notes: [],
      timeline: [],
      productInterests: [
        { id: "pi-6", productName: "Giám sát hành trình V-Tracking Viettel", status: "AM_CONFIRMED" },
      ],
    },
    {
      id: "lead-04",
      workspaceId: DEFAULT_WORKSPACE,
      companyName: "Công ty TNHH May Mặc Sóng Thần",
      industry: "Dệt may xuất khẩu",
      district: "Dĩ An",
      province: "Bình Dương",
      stage: "PROPOSAL",
      ownerUserId: "user-am",
      ownerName: "Lê Văn AM",
      contactName: "Vũ Thị Hương (Phó Giám đốc)",
      phone: "0976543210",
      email: "huong@maysongthan.vn",
      contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
      notes: [],
      timeline: [],
      productInterests: [
        { id: "pi-7", productName: "Kênh truyền Internet Leased Line Viettel", status: "AM_CONFIRMED" },
        { id: "pi-8", productName: "Tổng đài Cloud Contact Center (3C)", status: "AM_CONFIRMED" },
      ],
    },
  ];

  const nowStr = new Date().toISOString();
  const tasksStore: StoredTask[] = [
    {
      id: "task-01",
      workspaceId: DEFAULT_WORKSPACE,
      assigneeUserId: "user-am",
      type: "CALL",
      outcomeGoal: "Tư vấn gói giải pháp chuyển đổi số Viettel-CA + S-Invoice cho Cơ Khí Dĩ An",
      dueAt: nowStr,
      estimatedMinutes: 25,
      approvalStatus: "APPROVED",
      leadId: "lead-01",
      status: "OPEN",
    },
    {
      id: "task-02",
      workspaceId: DEFAULT_WORKSPACE,
      assigneeUserId: "user-am",
      type: "MEETING",
      outcomeGoal: "Demo trực tiếp hệ thống Easy HRM & VOffice tại văn phòng Cty Phần Mềm Bình Dương",
      dueAt: nowStr,
      estimatedMinutes: 60,
      approvalStatus: "APPROVED",
      leadId: "lead-02",
      status: "OPEN",
    },
    {
      id: "task-03",
      workspaceId: DEFAULT_WORKSPACE,
      assigneeUserId: "user-am",
      type: "EMAIL",
      outcomeGoal: "Gửi dự thảo hợp đồng kênh truyền Internet Leased Line cho May Mặc Sóng Thần",
      dueAt: nowStr,
      estimatedMinutes: 20,
      approvalStatus: "APPROVED",
      leadId: "lead-04",
      status: "OPEN",
    },
  ];

  const auditEvents: Record<string, unknown>[] = [
    {
      id: randomUUID(),
      actorId: "user-admin",
      actorRole: "ADMIN",
      action: "WORKSPACE_INITIALIZED",
      entityType: "Workspace",
      entityId: DEFAULT_WORKSPACE,
      changedFieldNames: ["status", "slug"],
      createdAt: new Date(Date.now() - 86400000),
    },
    {
      id: randomUUID(),
      actorId: "user-mgr",
      actorRole: "MANAGER",
      action: "LEAD_ASSIGNED",
      entityType: "Lead",
      entityId: "lead-01",
      changedFieldNames: ["ownerUserId"],
      createdAt: new Date(Date.now() - 43200000),
    },
  ];

  const auth: LocalAuthService = {
    async resolveSession(token: string): Promise<AuthPrincipal | null> {
      const found = sessions.get(token);
      if (!found) return null;
      if (found.expiresAt.getTime() < Date.now()) {
        sessions.delete(token);
        return null;
      }
      return found.principal;
    },
    async revokeSession(token: string): Promise<void> {
      sessions.delete(token);
    },
    async authenticatePassword(input: {
      workspaceId: string;
      email: string;
      password: string;
    }): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
      const emailLower = input.email.trim().toLowerCase();
      let user = activeUsers.find((u) => u.email.toLowerCase() === emailLower);
      if (!user) {
        // Fallback for custom emails entered by user
        user = {
          id: `user-${randomUUID().slice(0, 8)}`,
          email: input.email,
          displayName: input.email.split("@")[0] ?? "Người dùng Viettel",
          role: "AM",
          teamId: "team-dian",
        };
        activeUsers.push(user);
      }
      const principal: AuthPrincipal = {
        userId: user.id,
        workspaceId: input.workspaceId || DEFAULT_WORKSPACE,
        role: user.role,
        teamId: user.teamId,
      };
      const sessionToken = `session-${randomUUID()}`;
      sessions.set(sessionToken, {
        principal,
        expiresAt: new Date(Date.now() + 28800000),
      });
      auditEvents.push({
        id: randomUUID(),
        actorId: principal.userId,
        actorRole: principal.role,
        action: "USER_LOGIN_SUCCESS",
        entityType: "Session",
        entityId: principal.userId,
        changedFieldNames: [],
        createdAt: new Date(),
      });
      return { principal, sessionToken };
    },
    async createInvitation(
      actor: AuthPrincipal,
      input: { email: string; role: AuthRole; teamId: string | null },
    ): Promise<{ userId: string; url: string; expiresAt: Date }> {
      const newUser: DemoUser = {
        id: `user-${randomUUID().slice(0, 8)}`,
        email: input.email,
        displayName: input.email.split("@")[0] ?? "Thành viên mới",
        role: input.role,
        teamId: input.teamId,
      };
      activeUsers.push(newUser);
      const token = `inv-${randomUUID()}`;
      const expiresAt = new Date(Date.now() + 86400000);
      return {
        userId: newUser.id,
        url: `http://127.0.0.1:3000/invite/accept?token=${token}`,
        expiresAt,
      };
    },
    async acceptInvitation(input: {
      token: string;
      password: string;
      displayName: string;
    }): Promise<AuthPrincipal> {
      const principal: AuthPrincipal = {
        userId: `user-${randomUUID().slice(0, 8)}`,
        workspaceId: DEFAULT_WORKSPACE,
        role: "AM",
        teamId: "team-dian",
      };
      activeUsers.push({
        id: principal.userId,
        email: "invited@viettel.vn",
        displayName: input.displayName,
        role: "AM",
        teamId: "team-dian",
      });
      return principal;
    },
    async changeMembershipRole(
      _actor: AuthPrincipal,
      input: { targetUserId: string; role: AuthRole; teamId: string | null },
    ): Promise<void> {
      activeUsers = activeUsers.map((u) =>
        u.id === input.targetUserId
          ? { ...u, role: input.role, teamId: input.teamId }
          : u,
      );
    },
  };

  const leads: unknown = {
    async listLeads(_actor: AuthPrincipal, filter?: { stage?: string; query?: string }) {
      let filtered = [...leadsStore];
      if (filter?.stage) {
        filtered = filtered.filter((l) => l.stage === filter.stage);
      }
      if (filter?.query) {
        const q = filter.query.toLowerCase();
        filtered = filtered.filter(
          (l) =>
            l.companyName.toLowerCase().includes(q) ||
            l.district.toLowerCase().includes(q) ||
            l.industry.toLowerCase().includes(q),
        );
      }
      const items: LeadListItem[] = filtered.map((l) => ({
        id: l.id,
        companyName: l.companyName,
        industry: l.industry,
        district: l.district,
        province: l.province,
        stage: l.stage as never,
        ownerUserId: l.ownerUserId,
        ownerName: l.ownerName,
        updatedAt: new Date(),
        contacts: [
          {
            id: `c-${l.id}`,
            contactName: l.contactName,
            phone: l.phone.slice(0, 2) + "••••••" + l.phone.slice(-2),
            email: l.email.slice(0, 1) + "•••@" + l.email.split("@")[1],
            contactabilityStatus: l.contactabilityStatus as never,
          },
        ],
      }));
      return { items, total: items.length };
    },
    async getLeadDetail(_actor: AuthPrincipal, leadId: string): Promise<LeadDetail> {
      const found = leadsStore.find((l) => l.id === leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      return {
        id: found.id,
        companyName: found.companyName,
        industry: found.industry,
        district: found.district,
        province: found.province,
        website: "https://viettel-sme.vn",
        businessAddress: `${found.district}, ${found.province}`,
        stage: found.stage as never,
        ownerUserId: found.ownerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        contacts: [
          {
            id: `c-${found.id}`,
            contactName: found.contactName,
            phone: found.phone.slice(0, 2) + "••••••" + found.phone.slice(-2),
            email: found.email.slice(0, 1) + "•••@" + found.email.split("@")[1],
            contactabilityStatus: found.contactabilityStatus as never,
          },
        ],
        sources: [
          {
            id: `src-${found.id}`,
            sourceType: "AM_ENTERED",
            sourceLabel: "KCN Sóng Thần - Viettel Bình Dương",
            sourceUrl: null,
            collectedAt: new Date(),
            contactBasis: "CONSENT_RECORDED",
            recordedByUserId: found.ownerUserId,
            createdAt: new Date(),
          },
        ],
        consentReviews: [],
        suppressions: [],
        notes: found.notes.map((n) => ({
          id: n.id,
          content: n.content,
          authorUserId: found.ownerUserId,
          createdAt: new Date(n.createdAt),
          updatedAt: new Date(n.createdAt),
        })),
        productInterests: found.productInterests.map((p) => ({
          id: p.id,
          productCode: p.productName.toUpperCase().replace(/\s+/g, "_"),
          productName: p.productName,
          status: p.status as never,
          recordedByUserId: found.ownerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        timeline: found.timeline.map((t) => ({
          id: t.id,
          kind: "AUDIT" as const,
          action: t.type,
          at: new Date(t.createdAt),
          actorId: found.ownerUserId,
          changedFieldNames: [],
        })),
      };
    },
    async createLead(actor: AuthPrincipal, input: CreateLeadInput) {
      const id = `lead-${randomUUID().slice(0, 8)}`;
      const newLead: StoredLead = {
        id,
        workspaceId: actor.workspaceId,
        companyName: input.companyName,
        industry: input.industry ?? "SME Tổng hợp",
        district: input.district ?? "Dĩ An",
        province: input.province ?? "Bình Dương",
        stage: "NEW",
        ownerUserId: actor.userId,
        ownerName: activeUsers.find((u) => u.id === actor.userId)?.displayName ?? "AM Phụ trách",
        contactName: input.contact?.contactName ?? "Người liên hệ",
        phone: input.contact?.phoneNormalized ?? "0900000000",
        email: input.contact?.emailNormalized ?? "contact@example.vn",
        contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
        notes: [],
        timeline: [
          {
            id: `tl-${randomUUID().slice(0, 6)}`,
            type: "LEAD_CREATED",
            summary: "Tạo mới Lead trên hệ thống",
            createdAt: new Date().toISOString(),
          },
        ],
        productInterests: [],
      };
      leadsStore.unshift(newLead);
      return { leadId: id };
    },
    async updateLead(actor: AuthPrincipal, leadId: string, input: UpdateLeadInput) {
      const found = leadsStore.find((l) => l.id === leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      if (input.companyName) found.companyName = input.companyName;
      if (input.industry !== undefined) found.industry = input.industry ?? "";
      if (input.district !== undefined) found.district = input.district ?? "";
      if (input.province !== undefined) found.province = input.province ?? "";
      if (input.contact?.contactName) found.contactName = input.contact.contactName;
    },
    async transitionStage(_actor: AuthPrincipal, leadId: string, stage: string) {
      const found = leadsStore.find((l) => l.id === leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      found.stage = stage;
      found.timeline.unshift({
        id: `tl-${randomUUID().slice(0, 6)}`,
        type: "STAGE_CHANGE",
        summary: `Chuyển trạng thái sang ${stage}`,
        createdAt: new Date().toISOString(),
      });
    },
    async addNote(actor: AuthPrincipal, input: { leadId: string; content: string }) {
      const found = leadsStore.find((l) => l.id === input.leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      const noteId = `note-${randomUUID().slice(0, 6)}`;
      found.notes.unshift({
        id: noteId,
        content: input.content,
        createdAt: new Date().toISOString(),
        authorName: activeUsers.find((u) => u.id === actor.userId)?.displayName ?? "AM",
      });
      return { noteId };
    },
    async assignLead(_actor: AuthPrincipal, leadId: string, ownerUserId: string) {
      const found = leadsStore.find((l) => l.id === leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      found.ownerUserId = ownerUserId;
      const u = activeUsers.find((x) => x.id === ownerUserId);
      if (u) found.ownerName = u.displayName;
    },
    async reviewContactability(
      _actor: AuthPrincipal,
      input: { leadId: string; status: string; purpose: string },
    ) {
      const found = leadsStore.find((l) => l.id === input.leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      found.contactabilityStatus = input.status;
    },
    async suppressContact() {},
    async addSource() {
      return { sourceId: `src-${randomUUID().slice(0, 6)}` };
    },
  };

  const tasks: unknown = {
    async getDailyPlan(
      _actor: AuthPrincipal,
      _input: unknown,
    ): Promise<DailyPlan> {
      void _actor;
      void _input;
      const cardViews: TaskView[] = tasksStore.map((t) => ({
        id: t.id,
        workspaceId: DEFAULT_WORKSPACE,
        leadId: t.leadId,
        leadContactId: null,
        assigneeUserId: t.assigneeUserId,
        assignedByUserId: "user-admin",
        approvedByUserId: "user-admin",
        suggestedProductInterestId: null,
        type: t.type as never,
        contactChannel: "PHONE",
        outcomeGoal: t.outcomeGoal,
        estimatedMinutes: t.estimatedMinutes,
        dueAt: new Date(t.dueAt),
        status: t.status,
        approvalStatus: t.approvalStatus as never,
        priorityReason: "Ưu tiên kế hoạch ngày",
        nextAction: null,
        deferReason: null,
        cancelReason: null,
        completionOutcome: null,
        suggestedService: null,
        approvedAt: new Date(),
        completedAt: null,
        predecessorId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        leadStage: "NEW",
      }));
      return {
        day: new Date().toISOString().slice(0, 10),
        timezone: "Asia/Ho_Chi_Minh",
        targetCandidateRange: [5, 8] as const,
        candidates: cardViews,
        tasks: cardViews.map((task, idx) => ({
          task,
          scheduledStartAt: new Date(Date.now() + idx * 3600000),
          scheduledEndAt: new Date(Date.now() + (idx + 1) * 3600000),
        })),
        lockedBlocks: [],
        skipped: [],
      };
    },
    async listTasks() {
      return tasksStore.map((t) => ({
        id: t.id,
        type: t.type,
        outcomeGoal: t.outcomeGoal,
        dueAt: new Date(t.dueAt),
        estimatedMinutes: t.estimatedMinutes,
        approvalStatus: t.approvalStatus,
        leadId: t.leadId,
      }));
    },
    async createTask(_actor: AuthPrincipal, input: CreateTaskInput) {
      const id = `task-${randomUUID().slice(0, 8)}`;
      tasksStore.push({
        id,
        workspaceId: DEFAULT_WORKSPACE,
        assigneeUserId: input.assigneeUserId,
        type: input.type,
        outcomeGoal: input.outcomeGoal,
        dueAt: input.dueAt.toISOString(),
        estimatedMinutes: input.estimatedMinutes,
        approvalStatus: "APPROVED",
        leadId: input.leadId ?? null,
        status: "OPEN",
      });
      return { id };
    },
    async getTask(_actor: AuthPrincipal, id: string) {
      const t = tasksStore.find((x) => x.id === id);
      if (!t) throw new Error("TASK_NOT_FOUND");
      return t;
    },
    async assignTask(_actor: AuthPrincipal, id: string, assigneeUserId: string) {
      const t = tasksStore.find((x) => x.id === id);
      if (t) t.assigneeUserId = assigneeUserId;
      return t ?? { id };
    },
    async approveProposedContactTask(_actor: AuthPrincipal, id: string) {
      const t = tasksStore.find((x) => x.id === id);
      if (t) t.approvalStatus = "APPROVED";
      return t ?? { id };
    },
    async completeTask(_actor: AuthPrincipal, id: string) {
      const t = tasksStore.find((x) => x.id === id);
      if (t) t.status = "DONE";
      return t ?? { id };
    },
    async deferTask(_actor: AuthPrincipal, id: string) {
      const t = tasksStore.find((x) => x.id === id);
      if (t) t.status = "DEFERRED";
      return t ?? { id };
    },
    async cancelTask(_actor: AuthPrincipal, id: string) {
      const t = tasksStore.find((x) => x.id === id);
      if (t) t.status = "CANCELLED";
      return t ?? { id };
    },
    async listLockedTimeBlocks() {
      return [];
    },
    async createLockedTimeBlock() {
      return { id: `block-${randomUUID().slice(0, 6)}` };
    },
  };

  const previewPort: ImportPreviewPort = {
    previewWorkbook() {
      return {
        success: true,
        preview: {
          previewId: "preview-demo",
          headerInspection: {
            status: "READY",
            columnMap: [
              { sourceColumnIndex: 0, targetField: "company_name" },
              { sourceColumnIndex: 1, targetField: "phone" },
              { sourceColumnIndex: 2, targetField: "industry" },
              { sourceColumnIndex: 3, targetField: "district" },
            ],
            quarantinedColumns: [],
            errors: [],
            warnings: [],
          },
          rows: [],
          totalRows: 0,
          commitEligible: false,
          decisionStatus: "AWAITING_AM_REVIEW",
        },
      };
    },
    prepareReviewedCommit() {
      return {
        success: true,
        preparedCommitId: "prep-1",
        summary: {
          totalRows: 0,
          rowsToKeep: 0,
          rowsToMerge: 0,
          rowsToSkip: 0,
          duplicateCandidateRows: 0,
        },
      };
    },
    commitPrepared: async () => ({ success: true }),
    discardPreview: () => true,
    discardPreparedCommit: () => true,
  };

  const db: SqlPort = {
    async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
      void values;
      // User list query
      if (sql.includes('FROM "User"') || sql.includes("TeamMembership")) {
        return activeUsers.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          role: u.role,
          teamId: u.teamId,
          status: "ACTIVE",
          emailNormalized: u.email,
        })) as unknown as T[];
      }
      // Audit event query
      if (sql.includes('FROM "AuditEvent"')) {
        return auditEvents.map((a) => ({
          ...a,
          actorDisplayName:
            activeUsers.find((u) => u.id === a.actorId)?.displayName ?? "Hệ thống",
        })) as unknown as T[];
      }
      // Deduplication candidates query
      if (sql.includes('FROM "Lead"')) {
        return leadsStore.map((l) => ({
          id: l.id,
          companyName: l.companyName,
          phone: l.phone,
          email: l.email,
          district: l.district,
        })) as unknown as T[];
      }
      return [] as T[];
    },
    async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
      if (sql.includes('INSERT INTO "AuditEvent"')) {
        auditEvents.unshift({
          id: String(values[0] ?? randomUUID()),
          workspaceId: String(values[1] ?? DEFAULT_WORKSPACE),
          actorId: String(values[2] ?? "system"),
          actorRole: String(values[3] ?? "AM"),
          action: "AUDIT_RECORDED",
          entityType: "System",
          entityId: String(values[4] ?? ""),
          changedFieldNames: [],
          createdAt: new Date(),
        });
      }
    },
    async transaction<T>(work: (tx: SqlPort) => Promise<T>): Promise<T> {
      return work(this);
    },
  };

  const operations = new WorkspaceOperationsHub();

  return {
    auth,
    guard: new HttpAuthGuard(auth, { secure: false }),
    leads: leads as LeadRepository,
    tasks: tasks as TasksRepository,
    imports: new InMemoryImportApi(previewPort),
    db,
    operations,
    sessionCookie: {
      secure: false,
      maxAgeSeconds: 28800,
    },
  };
}
