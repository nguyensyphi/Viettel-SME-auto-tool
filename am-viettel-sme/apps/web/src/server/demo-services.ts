import { randomUUID } from "node:crypto";
import {
  parseXlsxWorkbook,
  inspectHeaders,
  validateColumnMapping,
  mapLeadRow,
  type ColumnMappingEntry,
  type MappedLeadDraft,
  type ParsedXlsxWorkbook,
} from "@am-sme/excel-import";
import type {
  ImportPreviewRow,
  PreparedImportSummary,
  ImportReviewChoice,
} from "@am-sme/database/import-workflow";
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
import {
  GoogleOAuthService,
  GoogleDriveConnector,
  GoogleDocsConnector,
  GoogleDocsSyncService,
  TopicClassifier,
} from "@am-sme/content-library";
import type { GoogleConnectionRepository } from "@am-sme/database/google-connections";
import type {
  ContentLibraryRepository,
  GoogleDocumentRecord,
  ContentPostRecord,
  ContentVersionRecord,
  MediaAssetRecord,
  MediaVersionRecord,
  ContentMediaLinkRecord,
  LinkedMediaAssetRecord,
  ContentApprovalRecord,
  SocialAccountRecord,
  PublishingCampaignRecord,
  PublishingScheduleRecord,
  PublishingJobRecord,
  PublishingJobStepRecord,
  PublishingResultRecord,
} from "@am-sme/database/content-library";

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
    async addNote(
      actor: AuthPrincipal,
      leadIdOrInput: string | { leadId: string; content: string },
      contentParam?: string,
    ) {
      const leadId =
        typeof leadIdOrInput === "string" ? leadIdOrInput : leadIdOrInput.leadId;
      const content =
        typeof leadIdOrInput === "string"
          ? contentParam ?? ""
          : leadIdOrInput.content;
      const found = leadsStore.find((l) => l.id === leadId);
      if (!found) throw new Error("LEAD_NOT_FOUND");
      const noteId = `note-${randomUUID().slice(0, 6)}`;
      found.notes.unshift({
        id: noteId,
        content,
        createdAt: new Date().toISOString(),
        authorName:
          activeUsers.find((u) => u.id === actor.userId)?.displayName ?? "AM",
      });
      return { noteId, content, id: noteId, authorUserId: actor.userId, createdAt: new Date() };
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
    async listTasks(
      _actor?: AuthPrincipal,
      filter?: { status?: string; assigneeUserId?: string },
    ) {
      return tasksStore
        .filter((t) => {
          if (filter?.status && t.status !== filter.status) return false;
          if (filter?.assigneeUserId && t.assigneeUserId !== filter.assigneeUserId)
            return false;
          return true;
        })
        .map((t) => ({
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

  interface InMemoryPreviewSession {
    previewId: string;
    parsed: ParsedXlsxWorkbook;
    columnMap: ColumnMappingEntry[];
    mappedRows: {
      rowNumber: number;
      lead: MappedLeadDraft | null;
      status: "READY" | "INVALID";
    }[];
    prepared?: {
      preparedCommitId: string;
      decisions: readonly ImportReviewChoice[];
      summary: PreparedImportSummary;
    };
  }
  const previewSessions = new Map<string, InMemoryPreviewSession>();

  const previewPort: ImportPreviewPort = {
    previewWorkbook(input) {
      const parsed = parseXlsxWorkbook(input.filename, input.bytes, {
        maxRows: 10_001,
        maxColumns: 64,
      });
      if (!parsed.success) {
        return { success: false, errorCode: parsed.errorCode };
      }

      let headerInspection = inspectHeaders(parsed.headers);
      if (input.mapping) {
        const validated = validateColumnMapping(input.mapping);
        if (validated.status !== "READY") {
          return {
            success: false,
            errorCode: "HEADER_MAPPING_INVALID",
            headerInspection,
          };
        }
        headerInspection = {
          ...headerInspection,
          columnMap: validated.columnMap,
        };
      }

      const columnMap = headerInspection.columnMap;
      const mappedRows: {
        rowNumber: number;
        lead: MappedLeadDraft | null;
        status: "READY" | "INVALID";
      }[] = [];
      const publicRows: ImportPreviewRow[] = [];

      for (const row of parsed.rows) {
        const mapped = mapLeadRow(row.values, columnMap);
        if (mapped.success) {
          mappedRows.push({
            rowNumber: row.rowNumber,
            lead: mapped.lead,
            status: "READY",
          });
          publicRows.push({
            rowNumber: row.rowNumber,
            status: "READY",
            companyName: mapped.lead.company_name,
            stage: mapped.lead.stage,
            contact: {
              phoneMasked: mapped.lead.phone
                ? mapped.lead.phone.replace(/(\d{3})\d{4}(\d{3})/, "$1****$2")
                : null,
              emailMasked: mapped.lead.email
                ? mapped.lead.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")
                : null,
            },
            issues: [],
            consentStatus: mapped.lead.consent_status,
            contactabilityStatus: mapped.lead.contactability_status,
            provenanceReviewReasons: [],
            suppressionIntent: null,
            duplicateReview: null,
            humanDecisionRequired: true as const,
          });
        } else {
          mappedRows.push({
            rowNumber: row.rowNumber,
            lead: null,
            status: "INVALID",
          });
          publicRows.push({
            rowNumber: row.rowNumber,
            status: "INVALID",
            companyName: String(row.values[0] ?? `Dòng ${row.rowNumber}`),
            stage: "PENDING_REVIEW" as const,
            contact: { phoneMasked: null, emailMasked: null },
            issues: [...mapped.errors],
            consentStatus: "UNKNOWN",
            contactabilityStatus: "UNKNOWN",
            provenanceReviewReasons: [],
            suppressionIntent: null,
            duplicateReview: null,
            humanDecisionRequired: true as const,
          });
        }
      }

      const previewId = randomUUID();
      previewSessions.set(previewId, {
        previewId,
        parsed,
        columnMap: [...columnMap],
        mappedRows,
      });

      return {
        success: true,
        preview: {
          previewId,
          headerInspection,
          rows: publicRows,
          totalRows: parsed.rows.length,
          commitEligible: false as const,
          decisionStatus: "AWAITING_AM_REVIEW",
        },
      };
    },

    prepareReviewedCommit(input) {
      const session = previewSessions.get(input.previewId);
      if (!session) return { success: false, errorCode: "PREVIEW_NOT_FOUND" };

      const preparedCommitId = randomUUID();
      const rowsToKeep = input.decisions.filter((d) => d.action === "KEEP").length;
      const rowsToMerge = input.decisions.filter((d) => d.action === "MERGE").length;
      const rowsToSkip = input.decisions.filter((d) => d.action === "SKIP").length;
      const summary: PreparedImportSummary = {
        totalRows: session.mappedRows.length,
        rowsToKeep,
        rowsToMerge,
        rowsToSkip,
        duplicateCandidateRows: 0,
      };

      session.prepared = {
        preparedCommitId,
        decisions: input.decisions,
        summary,
      };

      return {
        success: true,
        preparedCommitId,
        summary,
      };
    },

    commitPrepared: async (preparedCommitId, context) => {
      let targetSession: InMemoryPreviewSession | undefined;
      for (const s of previewSessions.values()) {
        if (s.prepared?.preparedCommitId === preparedCommitId) {
          targetSession = s;
          break;
        }
      }
      if (!targetSession || !targetSession.prepared) {
        return { success: false, errorCode: "COMMIT_NOT_PREPARED" };
      }

      const decisionsMap = new Map(
        targetSession.prepared.decisions.map((d) => [d.rowNumber, d.action]),
      );
      let importedCount = 0;

      for (const row of targetSession.mappedRows) {
        const decision =
          decisionsMap.get(row.rowNumber) ?? (row.status === "READY" ? "KEEP" : "SKIP");
        if (decision === "KEEP" && row.status === "READY" && row.lead) {
          const newLeadId = `lead-${randomUUID().slice(0, 8)}`;
          const stored: StoredLead = {
            id: newLeadId,
            workspaceId: DEFAULT_WORKSPACE,
            companyName: row.lead.company_name,
            industry: row.lead.industry ?? "Chưa phân loại",
            district: row.lead.district ?? "TP.HCM",
            province: "TP. Hồ Chí Minh",
            stage: "NEW",
            ownerUserId: "user-am",
            ownerName: "Lê Văn AM",
            contactName: row.lead.contact_name ?? "Đại diện pháp luật",
            phone: row.lead.phone ?? "Chưa có",
            email: row.lead.email ?? "Chưa có",
            contactabilityStatus: "UNKNOWN",
            notes: row.lead.notes
              ? [
                  {
                    id: randomUUID(),
                    content: row.lead.notes,
                    createdAt: new Date().toISOString(),
                    authorName: "Hệ thống Import Excel",
                  },
                ]
              : [],
            timeline: [
              {
                id: randomUUID(),
                type: "LEAD_CREATED",
                summary: "Nhập khẩu từ file Excel",
                createdAt: new Date().toISOString(),
              },
            ],
            productInterests: [
              {
                id: randomUUID(),
                productName: "Chữ ký số Viettel-CA",
                status: "AM_CONFIRMED",
              },
              {
                id: randomUUID(),
                productName: "Hóa đơn điện tử S-Invoice",
                status: "AM_CONFIRMED",
              },
            ],
          };
          leadsStore.unshift(stored);
          importedCount++;
        }
      }

      auditEvents.push({
        id: randomUUID(),
        actorId: context.actorId,
        actorRole: "AM",
        action: "EXCEL_IMPORT_COMMITTED",
        entityType: "LeadImportJob",
        entityId: preparedCommitId,
        changedFieldNames: ["leadsCount"],
        createdAt: new Date(),
      });

      return { success: true, count: importedCount };
    },

    discardPreview: (id) => previewSessions.delete(id),
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

  const googleConnectionsStore: Array<{
    id: string;
    workspaceId: string;
    provider: string;
    accountEmail: string;
    scopes: readonly string[];
    status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
    encryptedRefreshToken: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [
    {
      id: "conn-viettel-dian",
      workspaceId: DEFAULT_WORKSPACE,
      provider: "GOOGLE",
      accountEmail: "am.vietteldian@gmail.com",
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
      ],
      status: "CONNECTED",
      encryptedRefreshToken: "enc:demo-refresh-token",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const googleFoldersStore: Array<{
    id: string;
    connectionId: string;
    driveFolderId: string;
    folderName: string;
    folderType: "ROOT" | "CONTENT" | "MEDIA" | "ARCHIVE" | "OTHER";
    pathHint: string | null;
    registeredAt: Date;
    lastSyncedAt: Date | null;
  }> = [
    {
      id: "folder-viettel-am-root",
      connectionId: "conn-viettel-dian",
      driveFolderId: "drive_root_viettel_am",
      folderName: "VIETTEL_AM",
      folderType: "ROOT",
      pathHint: "/VIETTEL_AM",
      registeredAt: new Date(),
      lastSyncedAt: new Date(),
    },
    {
      id: "folder-content",
      connectionId: "conn-viettel-dian",
      driveFolderId: "drive_content_dir",
      folderName: "CONTENT",
      folderType: "CONTENT",
      pathHint: "/VIETTEL_AM/PERSONAL_BRANDING/CONTENT",
      registeredAt: new Date(),
      lastSyncedAt: new Date(),
    },
    {
      id: "folder-media",
      connectionId: "conn-viettel-dian",
      driveFolderId: "drive_media_dir",
      folderName: "MEDIA",
      folderType: "MEDIA",
      pathHint: "/VIETTEL_AM/PERSONAL_BRANDING/MEDIA",
      registeredAt: new Date(),
      lastSyncedAt: new Date(),
    },
  ];

  const googleSyncLogsStore: Array<{
    id: string;
    connectionId: string;
    entityId: string;
    syncType: string;
    syncStatus: "SUCCESS" | "FAILED" | "IN_PROGRESS";
    itemsSynced: number;
    errorMessage: string | null;
    createdAt: Date;
  }> = [];

  const googleConnectionsRepo = {
    async createConnection(input: any) {
      const conn = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        provider: "GOOGLE",
        accountEmail: input.accountEmail,
        scopes: input.scopes,
        status: "CONNECTED" as const,
        encryptedRefreshToken: input.encryptedRefreshToken ?? null,
        expiresAt: input.expiresAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      googleConnectionsStore.unshift(conn);
      return conn;
    },
    async getConnectionById(wsId: string, id: string) {
      return (
        googleConnectionsStore.find(
          (c) => c.workspaceId === wsId && c.id === id,
        ) ?? null
      );
    },
    async listConnections(wsId: string) {
      return googleConnectionsStore.filter((c) => c.workspaceId === wsId);
    },
    async updateConnectionStatus(
      wsId: string,
      id: string,
      status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR",
    ) {
      const found = googleConnectionsStore.find(
        (c) => c.workspaceId === wsId && c.id === id,
      );
      if (found) {
        found.status = status;
        found.updatedAt = new Date();
        return true;
      }
      return false;
    },
    async revokeConnection(wsId: string, id: string) {
      const found = googleConnectionsStore.find(
        (c) => c.workspaceId === wsId && c.id === id,
      );
      if (found) {
        found.status = "REVOKED";
        found.encryptedRefreshToken = null;
        found.updatedAt = new Date();
        return true;
      }
      return false;
    },
    async registerFolder(input: any) {
      const folder = {
        id: randomUUID(),
        connectionId: input.connectionId,
        driveFolderId: input.driveFolderId,
        folderName: input.folderName,
        folderType: input.folderType,
        pathHint: input.pathHint ?? null,
        registeredAt: new Date(),
        lastSyncedAt: null,
      };
      googleFoldersStore.push(folder);
      return folder;
    },
    async listFolders(wsId: string, connectionId: string) {
      return googleFoldersStore.filter((f) => f.connectionId === connectionId);
    },
    async updateFolderSyncTime(folderId: string) {
      const folder = googleFoldersStore.find((f) => f.id === folderId);
      if (folder) folder.lastSyncedAt = new Date();
    },
    async appendSyncLog(input: any) {
      const log = {
        id: randomUUID(),
        connectionId: input.connectionId,
        entityId: input.entityId,
        syncType: input.syncType,
        syncStatus: input.syncStatus,
        itemsSynced: input.itemsSynced,
        errorMessage: input.errorMessage ?? null,
        createdAt: new Date(),
      };
      googleSyncLogsStore.unshift(log);
      return log;
    },
    async listSyncLogs(connectionId: string, limit = 50) {
      return googleSyncLogsStore
        .filter((l) => l.connectionId === connectionId)
        .slice(0, limit);
    },
  } as unknown as GoogleConnectionRepository;

  const googleOAuth = new GoogleOAuthService(
    {
      clientId: "viettel-am-google-oauth-client-id",
      clientSecret: "viettel-am-google-oauth-secret",
      redirectUri: "http://127.0.0.1:3000/api/v1/google/oauth/callback",
    },
    {
      async postJson(url) {
        if (url === "https://oauth2.googleapis.com/token") {
          return {
            status: 200,
            data: {
              access_token: "demo-google-access-token",
              refresh_token: "demo-google-refresh-token",
              expires_in: 3600,
              scope:
                "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly",
              token_type: "Bearer",
            },
          };
        }
        return { status: 200, data: {} };
      },
      async getJson(url) {
        if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
          return {
            status: 200,
            data: {
              email: "am.vietteldian@gmail.com",
              email_verified: true,
            },
          };
        }
        return { status: 200, data: {} };
      },
    },
  );

  const demoDriveFiles = [
    { id: "img-cks-01", name: "chu_ky_so_01.jpg", mimeType: "image/jpeg" },
    { id: "img-hddt-01", name: "hoa_don_dien_tu_01.png", mimeType: "image/png" },
    { id: "img-vcontract-01", name: "vcontract_hop_dong_01.jpg", mimeType: "image/jpeg" },
    { id: "img-ftth-01", name: "ftth_internet_doanh_nghiep.png", mimeType: "image/png" },
    {
      id: "doc-pb-01",
      name: "Viettel_AM_Personal_Branding_Posts.gdoc",
      mimeType: "application/vnd.google-apps.document",
    },
  ];

  const googleDrive = new GoogleDriveConnector({
    async listFolderFiles() {
      return demoDriveFiles;
    },
    async downloadFileBytes() {
      return new Uint8Array([137, 80, 78, 71]);
    },
    async getFileMetadata(id: string) {
      return {
        id,
        name: "VIETTEL_AM",
        mimeType: "application/vnd.google-apps.folder",
      };
    },
  });

  const googleDocumentsStore: GoogleDocumentRecord[] = [
    {
      id: "doc-pb-01",
      connectionId: "conn-viettel-dian",
      documentId: "gdoc_viettel_am_posts",
      name: "Viettel_AM_Personal_Branding_Posts",
      revisionId: "rev_001",
      contentHash: "hash-doc-demo-01",
      postCount: 3,
      modifiedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    },
  ];

  const contentPostsStore: ContentPostRecord[] = [
    {
      id: "post-demo-01",
      workspaceId: DEFAULT_WORKSPACE,
      documentId: "doc-pb-01",
      postCode: "PB001",
      title: "Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?",
      body: "Chữ ký số giúp doanh nghiệp kê khai thuế điện tử, nộp BHXH và ký hóa đơn nhanh chóng, bảo mật tuyệt đối với chứng thư số đạt chuẩn quốc tế của Viettel-CA.",
      topicCode: "CHU_KY_SO",
      targetAudience: "BUSINESS_OWNER",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      priority: "HIGH",
      mediaHint: "AUTO",
      hashtags: ["#Viettel", "#ChuKySo", "#DoanhNghiep"],
      version: 1,
      contentHash: "hash-pb001",
      validFrom: null,
      validUntil: null,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "post-demo-02",
      workspaceId: DEFAULT_WORKSPACE,
      documentId: "doc-pb-01",
      postCode: "PB002",
      title: "Hóa đơn điện tử S-Invoice và những điều kế toán cần lưu ý",
      body: "Khởi tạo nhanh chóng, tích hợp phần mềm kế toán và lưu trữ an toàn 10 năm trên hạ tầng đám mây Viettel đạt chuẩn Tier 3.",
      topicCode: "HOA_DON_DIEN_TU",
      targetAudience: "BUSINESS_OWNER",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      priority: "NORMAL",
      mediaHint: "AUTO",
      hashtags: ["#HoaDonDienTu", "#Viettel", "#SInvoice"],
      version: 1,
      contentHash: "hash-pb002",
      validFrom: null,
      validUntil: null,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      updatedAt: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: "post-demo-03",
      workspaceId: DEFAULT_WORKSPACE,
      documentId: "doc-pb-01",
      postCode: "PB003",
      title: "Hợp đồng điện tử vContract - Ký kết mọi lúc, mọi nơi",
      body: "Rút ngắn 80% thời gian ký kết hợp đồng thương mại, pháp lý vững chắc được Bộ Công Thương chứng thực Trục phát triển hợp đồng điện tử Việt Nam.",
      topicCode: "VCONTRACT",
      targetAudience: "BUSINESS_OWNER",
      platforms: ["ZALO"],
      status: "DRAFT",
      priority: "NORMAL",
      mediaHint: null,
      hashtags: ["#vContract", "#Viettel"],
      version: 1,
      contentHash: "hash-pb003",
      validFrom: null,
      validUntil: null,
      createdAt: new Date(Date.now() - 10800000).toISOString(),
      updatedAt: new Date(Date.now() - 10800000).toISOString(),
    },
  ];

  const contentVersionsStore: ContentVersionRecord[] = [
    {
      id: "ver-demo-01",
      contentId: "post-demo-01",
      version: 1,
      contentHash: "hash-pb001",
      title: contentPostsStore[0]!.title,
      body: contentPostsStore[0]!.body,
      topicCode: contentPostsStore[0]!.topicCode,
      hashtags: contentPostsStore[0]!.hashtags,
      createdAt: contentPostsStore[0]!.createdAt,
    },
    {
      id: "ver-demo-02",
      contentId: "post-demo-02",
      version: 1,
      contentHash: "hash-pb002",
      title: contentPostsStore[1]!.title,
      body: contentPostsStore[1]!.body,
      topicCode: contentPostsStore[1]!.topicCode,
      hashtags: contentPostsStore[1]!.hashtags,
      createdAt: contentPostsStore[1]!.createdAt,
    },
    {
      id: "ver-demo-03",
      contentId: "post-demo-03",
      version: 1,
      contentHash: "hash-pb003",
      title: contentPostsStore[2]!.title,
      body: contentPostsStore[2]!.body,
      topicCode: contentPostsStore[2]!.topicCode,
      hashtags: contentPostsStore[2]!.hashtags,
      createdAt: contentPostsStore[2]!.createdAt,
    },
  ];

  const mediaAssetsStore: MediaAssetRecord[] = [
    {
      id: "media-demo-01",
      workspaceId: DEFAULT_WORKSPACE,
      connectionId: "conn-demo-01",
      driveFileId: "drive-media-cks-01",
      fileName: "PB001_CHU_KY_SO_1.png",
      mimeType: "image/png",
      sizeBytes: 312000,
      checksum: "sha256-demo-cks-01",
      topicCode: "CHU_KY_SO",
      postCodeHint: "PB001",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: false,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "media-demo-02",
      workspaceId: DEFAULT_WORKSPACE,
      connectionId: "conn-demo-01",
      driveFileId: "drive-media-shared-01",
      fileName: "SHARED_VIETTEL_SME.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 245000,
      checksum: "sha256-demo-shared-01",
      topicCode: "SHARED_MEDIA",
      postCodeHint: null,
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: true,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      updatedAt: new Date(Date.now() - 7200000).toISOString(),
    },
  ];

  const mediaVersionsStore: MediaVersionRecord[] = [
    {
      id: "mv-demo-01",
      mediaId: "media-demo-01",
      version: 1,
      checksum: "sha256-demo-cks-01",
      sizeBytes: 312000,
      createdAt: mediaAssetsStore[0]!.createdAt,
    },
    {
      id: "mv-demo-02",
      mediaId: "media-demo-02",
      version: 1,
      checksum: "sha256-demo-shared-01",
      sizeBytes: 245000,
      createdAt: mediaAssetsStore[1]!.createdAt,
    },
  ];

  const contentMediaLinksStore: ContentMediaLinkRecord[] = [];
  const contentApprovalsStore: ContentApprovalRecord[] = [];

  const socialAccountsStore: SocialAccountRecord[] = [
    {
      id: "acc-demo-zalo-01",
      workspaceId: DEFAULT_WORKSPACE,
      accountCode: "zalo-dian-am01",
      platform: "ZALO",
      displayName: "Zalo Lê Văn AM - Viettel Dĩ An",
      ownerUserId: "user-am",
      profileDir: "storage/browser_profiles/zalo-dian-am01",
      assignedTopics: ["CHU_KY_SO", "HOA_DON_DIEN_TU", "VCONTRACT"],
      maxPostsPerDay: 2,
      minIntervalMinutes: 180,
      preferredWindows: ["08:00-10:00", "13:30-15:30"],
      status: "ACTIVE",
      lastSessionCheckAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "acc-demo-fb-01",
      workspaceId: DEFAULT_WORKSPACE,
      accountCode: "fb-viettel-sme",
      platform: "FACEBOOK",
      displayName: "Facebook Lê Văn AM - Giải pháp Doanh nghiệp",
      ownerUserId: "user-am",
      profileDir: "storage/browser_profiles/fb-viettel-sme",
      assignedTopics: ["CHU_KY_SO", "HOA_DON_DIEN_TU"],
      maxPostsPerDay: 2,
      minIntervalMinutes: 180,
      preferredWindows: ["08:30-10:30", "19:30-21:00"],
      status: "ACTIVE",
      lastSessionCheckAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const publishingCampaignsStore: PublishingCampaignRecord[] = [];
  const publishingSchedulesStore: PublishingScheduleRecord[] = [];
  const publishingJobsStore: PublishingJobRecord[] = [];
  const publishingJobStepsStore: PublishingJobStepRecord[] = [];
  const publishingResultsStore: PublishingResultRecord[] = [];

  const contentLibrary = {
    async upsertGoogleDocument(input: any) {
      const idx = googleDocumentsStore.findIndex(
        (d) => d.connectionId === input.connectionId && d.documentId === input.documentId,
      );
      if (idx >= 0) {
        const updated = {
          ...googleDocumentsStore[idx]!,
          name: input.name,
          revisionId: input.revisionId ?? googleDocumentsStore[idx]!.revisionId,
          contentHash: input.contentHash ?? googleDocumentsStore[idx]!.contentHash,
          postCount: input.postCount ?? googleDocumentsStore[idx]!.postCount,
          modifiedAt: input.modifiedAt ? new Date(input.modifiedAt).toISOString() : googleDocumentsStore[idx]!.modifiedAt,
          syncedAt: new Date().toISOString(),
        };
        googleDocumentsStore[idx] = updated;
        return updated;
      }
      const created: GoogleDocumentRecord = {
        id: randomUUID(),
        connectionId: input.connectionId,
        documentId: input.documentId,
        name: input.name,
        revisionId: input.revisionId ?? null,
        contentHash: input.contentHash ?? null,
        postCount: input.postCount ?? 0,
        modifiedAt: input.modifiedAt ? new Date(input.modifiedAt).toISOString() : null,
        syncedAt: new Date().toISOString(),
      };
      googleDocumentsStore.push(created);
      return created;
    },
    async getGoogleDocument(connectionId: any, documentId: any) {
      return (
        googleDocumentsStore.find(
          (d) => d.connectionId === connectionId && d.documentId === documentId,
        ) ?? null
      );
    },
    async listGoogleDocuments(connectionId: any) {
      return googleDocumentsStore.filter(
        (d) => !connectionId || d.connectionId === connectionId,
      );
    },
    async upsertPost(input: any) {
      const idx = contentPostsStore.findIndex(
        (p) => p.workspaceId === input.workspaceId && p.postCode === input.postCode,
      );
      if (idx < 0) {
        const id = randomUUID();
        const post: ContentPostRecord = {
          id,
          workspaceId: input.workspaceId,
          documentId: input.documentId ?? null,
          postCode: input.postCode,
          title: input.title,
          body: input.body,
          topicCode: input.topicCode,
          targetAudience: input.targetAudience ?? "BUSINESS_OWNER",
          platforms: [...(input.platforms ?? [])],
          status: input.status ?? "DRAFT",
          priority: input.priority ?? "NORMAL",
          mediaHint: input.mediaHint ?? null,
          hashtags: [...(input.hashtags ?? [])],
          version: 1,
          contentHash: input.contentHash,
          validFrom: input.validFrom ? new Date(input.validFrom).toISOString() : null,
          validUntil: input.validUntil ? new Date(input.validUntil).toISOString() : null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        contentPostsStore.unshift(post);
        contentVersionsStore.push({
          id: randomUUID(),
          contentId: id,
          version: 1,
          contentHash: input.contentHash,
          title: input.title,
          body: input.body,
          topicCode: input.topicCode,
          hashtags: [...(input.hashtags ?? [])],
          createdAt: post.createdAt,
        });
        return post;
      }
      const existing = contentPostsStore[idx]!;
      if (existing.contentHash === input.contentHash) {
        return existing;
      }
      const nextVersion = existing.version + 1;
      const updated: ContentPostRecord = {
        ...existing,
        documentId: input.documentId ?? existing.documentId,
        title: input.title,
        body: input.body,
        topicCode: input.topicCode,
        targetAudience: input.targetAudience ?? existing.targetAudience,
        platforms: [...(input.platforms ?? existing.platforms)],
        priority: input.priority ?? existing.priority,
        mediaHint: input.mediaHint ?? existing.mediaHint,
        hashtags: [...(input.hashtags ?? existing.hashtags)],
        version: nextVersion,
        contentHash: input.contentHash,
        validFrom: input.validFrom ? new Date(input.validFrom).toISOString() : existing.validFrom,
        validUntil: input.validUntil ? new Date(input.validUntil).toISOString() : existing.validUntil,
        updatedAt: new Date().toISOString(),
      };
      contentPostsStore[idx] = updated;
      contentVersionsStore.push({
        id: randomUUID(),
        contentId: existing.id,
        version: nextVersion,
        contentHash: input.contentHash,
        title: input.title,
        body: input.body,
        topicCode: input.topicCode,
        hashtags: [...(input.hashtags ?? existing.hashtags)],
        createdAt: updated.updatedAt,
      });
      return updated;
    },
    async getPostById(wsId: any, id: any) {
      return contentPostsStore.find((p) => p.workspaceId === wsId && p.id === id) ?? null;
    },
    async getPostByCode(wsId: any, code: any) {
      return contentPostsStore.find((p) => p.workspaceId === wsId && p.postCode === code) ?? null;
    },
    async listPosts(wsId: any, filters?: any) {
      return contentPostsStore.filter((p) => {
        if (p.workspaceId !== wsId) return false;
        if (filters?.topicCode && p.topicCode !== filters.topicCode) return false;
        if (filters?.status && p.status !== filters.status) return false;
        if (filters?.documentId && p.documentId !== filters.documentId) return false;
        return true;
      });
    },
    async listPostVersions(contentId: any) {
      return contentVersionsStore.filter((v) => v.contentId === contentId);
    },
    async updatePostStatus(wsId: any, id: any, status: any) {
      const post = contentPostsStore.find((p) => p.workspaceId === wsId && p.id === id);
      if (!post) return null;
      (post as any).status = status;
      (post as any).updatedAt = new Date().toISOString();
      return post;
    },
    async upsertMediaAsset(input: any) {
      const idx = mediaAssetsStore.findIndex(
        (m) => m.workspaceId === input.workspaceId && m.driveFileId === input.driveFileId,
      );
      if (idx < 0) {
        const id = randomUUID();
        const nowIso = new Date().toISOString();
        const created: MediaAssetRecord = {
          id,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId ?? null,
          driveFileId: input.driveFileId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          topicCode: input.topicCode,
          postCodeHint: input.postCodeHint ?? null,
          platforms: [...(input.platforms ?? ["ZALO", "FACEBOOK"])],
          status: input.status ?? "VALID",
          version: 1,
          isSharedMedia: Boolean(input.isSharedMedia),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        mediaAssetsStore.unshift(created);
        mediaVersionsStore.push({
          id: randomUUID(),
          mediaId: id,
          version: 1,
          checksum: input.checksum,
          sizeBytes: input.sizeBytes,
          createdAt: nowIso,
        });
        return created;
      }

      const existing = mediaAssetsStore[idx]!;
      if (existing.checksum === input.checksum) {
        return existing;
      }
      const nextVersion = existing.version + 1;
      const nowIso = new Date().toISOString();
      const updated: MediaAssetRecord = {
        ...existing,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
        topicCode: input.topicCode,
        postCodeHint: input.postCodeHint ?? existing.postCodeHint,
        platforms: [...(input.platforms ?? existing.platforms)],
        status: input.status ?? existing.status,
        version: nextVersion,
        isSharedMedia:
          input.isSharedMedia !== undefined ? input.isSharedMedia : existing.isSharedMedia,
        updatedAt: nowIso,
      };
      mediaAssetsStore[idx] = updated;
      mediaVersionsStore.push({
        id: randomUUID(),
        mediaId: existing.id,
        version: nextVersion,
        checksum: input.checksum,
        sizeBytes: input.sizeBytes,
        createdAt: nowIso,
      });
      return updated;
    },
    async getMediaById(wsId: any, id: any) {
      return mediaAssetsStore.find((m) => m.workspaceId === wsId && m.id === id) ?? null;
    },
    async getMediaByDriveFileId(wsId: any, driveFileId: any) {
      return (
        mediaAssetsStore.find((m) => m.workspaceId === wsId && m.driveFileId === driveFileId) ??
        null
      );
    },
    async findMediaByChecksum(wsId: any, checksum: any) {
      return mediaAssetsStore.find((m) => m.workspaceId === wsId && m.checksum === checksum) ?? null;
    },
    async listMediaAssets(wsId: any, filters?: any) {
      return mediaAssetsStore.filter((m) => {
        if (m.workspaceId !== wsId) return false;
        if (filters?.topicCode && m.topicCode !== filters.topicCode) return false;
        if (filters?.status && m.status !== filters.status) return false;
        return true;
      });
    },
    async listMediaVersions(mediaId: any) {
      return mediaVersionsStore.filter((v) => v.mediaId === mediaId);
    },
    async updateMediaStatus(wsId: any, id: any, status: any) {
      const media = mediaAssetsStore.find((m) => m.workspaceId === wsId && m.id === id);
      if (!media) return null;
      (media as any).status = status;
      (media as any).updatedAt = new Date().toISOString();
      return media;
    },
    async linkMediaToContent(input: any) {
      const idx = contentMediaLinksStore.findIndex(
        (l) => l.contentId === input.contentId && l.mediaId === input.mediaId,
      );
      const link: ContentMediaLinkRecord = {
        id: idx >= 0 ? contentMediaLinksStore[idx]!.id : randomUUID(),
        contentId: input.contentId,
        mediaId: input.mediaId,
        position: input.position ?? 0,
        matchMethod: input.matchMethod ?? "AUTO",
        matchScore: input.matchScore ?? 0,
        createdAt: new Date().toISOString(),
      };
      if (idx >= 0) {
        contentMediaLinksStore[idx] = link;
      } else {
        contentMediaLinksStore.push(link);
      }
      return link;
    },
    async listMediaForContent(contentId: any) {
      const links = contentMediaLinksStore
        .filter((l) => l.contentId === contentId)
        .sort((a, b) => a.position - b.position);
      const result: LinkedMediaAssetRecord[] = [];
      for (const link of links) {
        const asset = mediaAssetsStore.find((m) => m.id === link.mediaId);
        if (asset) {
          result.push({
            ...asset,
            position: link.position,
            matchMethod: link.matchMethod,
            matchScore: link.matchScore,
          });
        }
      }
      return result;
    },
    async recordContentApproval(input: any) {
      const rec: ContentApprovalRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        contentId: input.contentId,
        contentVersion: input.contentVersion,
        mediaVersion: input.mediaVersion ?? null,
        approvedBy: input.approvedBy,
        status: input.status,
        approvedPlatforms: [...(input.approvedPlatforms ?? [])],
        notes: input.notes ?? null,
        createdAt: new Date().toISOString(),
      };
      contentApprovalsStore.push(rec);
      return rec;
    },
    async listContentApprovals(contentId: any) {
      return contentApprovalsStore.filter((a) => a.contentId === contentId);
    },
    async upsertSocialAccount(input: any) {
      const cleanCode = input.accountCode.trim();
      const idx = socialAccountsStore.findIndex(
        (a) => a.workspaceId === input.workspaceId && a.accountCode === cleanCode,
      );
      if (idx >= 0) {
        const existing = socialAccountsStore[idx]!;
        const updated: SocialAccountRecord = {
          ...existing,
          displayName: input.displayName,
          assignedTopics: [...(input.assignedTopics ?? existing.assignedTopics)],
          maxPostsPerDay: input.maxPostsPerDay ?? existing.maxPostsPerDay,
          minIntervalMinutes: input.minIntervalMinutes ?? existing.minIntervalMinutes,
          preferredWindows: [...(input.preferredWindows ?? existing.preferredWindows)],
          status: input.status ?? existing.status,
          updatedAt: new Date().toISOString(),
        };
        socialAccountsStore[idx] = updated;
        return updated;
      }
      const nowIso = new Date().toISOString();
      const created: SocialAccountRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        accountCode: cleanCode,
        platform: input.platform,
        displayName: input.displayName,
        ownerUserId: input.ownerUserId,
        profileDir: input.profileDir ?? `storage/browser_profiles/${cleanCode}`,
        assignedTopics: [...(input.assignedTopics ?? [])],
        maxPostsPerDay: input.maxPostsPerDay ?? 2,
        minIntervalMinutes: input.minIntervalMinutes ?? 180,
        preferredWindows: [...(input.preferredWindows ?? [])],
        status: input.status ?? "ACTIVE",
        lastSessionCheckAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      socialAccountsStore.push(created);
      return created;
    },
    async getSocialAccountById(wsId: any, id: any) {
      return (
        socialAccountsStore.find(
          (a) => a.workspaceId === wsId && (a.id === id || a.accountCode === id),
        ) ?? null
      );
    },
    async getSocialAccountByCode(wsId: any, code: any) {
      return (
        socialAccountsStore.find(
          (a) => a.workspaceId === wsId && a.accountCode === code,
        ) ?? null
      );
    },
    async listSocialAccounts(wsId: any, filters?: any) {
      return socialAccountsStore.filter((a) => {
        if (a.workspaceId !== wsId) return false;
        if (filters?.platform && a.platform !== filters.platform) return false;
        if (filters?.status && a.status !== filters.status) return false;
        return true;
      });
    },
    async updateSocialAccount(wsId: any, id: any, input: any) {
      const idx = socialAccountsStore.findIndex(
        (a) => a.workspaceId === wsId && (a.id === id || a.accountCode === id),
      );
      if (idx < 0) return null;
      const existing = socialAccountsStore[idx]!;
      const updated: SocialAccountRecord = {
        ...existing,
        displayName: input.displayName ?? existing.displayName,
        assignedTopics: input.assignedTopics
          ? [...input.assignedTopics]
          : existing.assignedTopics,
        maxPostsPerDay: input.maxPostsPerDay ?? existing.maxPostsPerDay,
        minIntervalMinutes: input.minIntervalMinutes ?? existing.minIntervalMinutes,
        preferredWindows: input.preferredWindows
          ? [...input.preferredWindows]
          : existing.preferredWindows,
        status: input.status ?? existing.status,
        lastSessionCheckAt:
          input.lastSessionCheckAt !== undefined
            ? input.lastSessionCheckAt
              ? new Date(input.lastSessionCheckAt).toISOString()
              : null
            : existing.lastSessionCheckAt,
        updatedAt: new Date().toISOString(),
      };
      socialAccountsStore[idx] = updated;
      return updated;
    },
    async createPublishingCampaign(input: any) {
      const nowIso = new Date().toISOString();
      const created: PublishingCampaignRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        topicCodes: [...(input.topicCodes ?? [])],
        accountIds: [...(input.accountIds ?? [])],
        startDate: input.startDate ? new Date(input.startDate).toISOString() : null,
        endDate: input.endDate ? new Date(input.endDate).toISOString() : null,
        status: input.status ?? "ACTIVE",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      publishingCampaignsStore.push(created);
      return created;
    },
    async listPublishingCampaigns(wsId: any) {
      return publishingCampaignsStore.filter((c) => c.workspaceId === wsId);
    },
    async createPublishingSchedule(input: any) {
      const nowIso = new Date().toISOString();
      const created: PublishingScheduleRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        campaignId: input.campaignId ?? null,
        contentId: input.contentId,
        accountId: input.accountId,
        platform: input.platform,
        scheduledAt: new Date(input.scheduledAt).toISOString(),
        publishMode: input.publishMode ?? "ASSISTED_PUBLISH",
        status: input.status ?? "SCHEDULED",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      publishingSchedulesStore.push(created);
      return created;
    },
    async listPublishingSchedules(wsId: any, filters?: any) {
      return publishingSchedulesStore.filter((s) => {
        if (s.workspaceId !== wsId) return false;
        if (filters?.accountId && s.accountId !== filters.accountId) return false;
        if (filters?.status && s.status !== filters.status) return false;
        return true;
      });
    },
    async createPublishingJob(input: any) {
      const nowIso = new Date().toISOString();
      const created: PublishingJobRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        scheduleId: input.scheduleId ?? null,
        contentId: input.contentId,
        accountId: input.accountId,
        platform: input.platform,
        publishMode: input.publishMode ?? "ASSISTED_PUBLISH",
        scheduledAt: new Date(input.scheduledAt).toISOString(),
        idempotencyKey: input.idempotencyKey,
        status: input.status ?? "QUEUED",
        errorCode: null,
        errorMessage: null,
        retryCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      publishingJobsStore.push(created);
      return created;
    },
    async getPublishingJobById(wsId: any, id: any) {
      return (
        publishingJobsStore.find((j) => j.workspaceId === wsId && j.id === id) ?? null
      );
    },
    async listPublishingJobs(wsId: any, filters?: any) {
      return publishingJobsStore.filter((j) => {
        if (j.workspaceId !== wsId) return false;
        if (filters?.accountId && j.accountId !== filters.accountId) return false;
        if (filters?.status && j.status !== filters.status) return false;
        return true;
      });
    },
    async updatePublishingJobStatus(wsId: any, id: any, input: any) {
      const idx = publishingJobsStore.findIndex(
        (j) => j.workspaceId === wsId && j.id === id,
      );
      if (idx < 0) return null;
      const existing = publishingJobsStore[idx]!;
      const updated: PublishingJobRecord = {
        ...existing,
        status: input.status,
        errorCode: input.errorCode !== undefined ? input.errorCode : existing.errorCode,
        errorMessage:
          input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage,
        retryCount: input.retryCount ?? existing.retryCount,
        updatedAt: new Date().toISOString(),
      };
      publishingJobsStore[idx] = updated;
      return updated;
    },
    async appendPublishingJobStep(input: any) {
      const step: PublishingJobStepRecord = {
        id: randomUUID(),
        jobId: input.jobId,
        stepName: input.stepName,
        status: input.status,
        details: input.details ?? null,
        createdAt: new Date().toISOString(),
      };
      publishingJobStepsStore.push(step);
      return step;
    },
    async listPublishingJobSteps(jobId: any) {
      return publishingJobStepsStore.filter((s) => s.jobId === jobId);
    },
    async recordPublishingResult(input: any) {
      const idx = publishingResultsStore.findIndex((r) => r.jobId === input.jobId);
      const rec: PublishingResultRecord = {
        id: idx >= 0 ? publishingResultsStore[idx]!.id : randomUUID(),
        jobId: input.jobId,
        workspaceId: input.workspaceId,
        contentId: input.contentId,
        accountId: input.accountId,
        platform: input.platform,
        status: input.status,
        publishedUrl: input.publishedUrl ?? null,
        screenshotPath: input.screenshotPath ?? null,
        confirmedBy: input.confirmedBy ?? null,
        publishedAt: new Date().toISOString(),
      };
      if (idx >= 0) {
        publishingResultsStore[idx] = rec;
      } else {
        publishingResultsStore.push(rec);
      }
      return rec;
    },
    async getPublishingResultByJobId(jobId: any) {
      return publishingResultsStore.find((r) => r.jobId === jobId) ?? null;
    },
  } as unknown as ContentLibraryRepository;

  const mockDocsTransport = {
    async fetchDocument(docId: string) {
      return {
        documentId: docId,
        title: "Viettel AM Chữ ký số & Hóa đơn điện tử",
        revisionId: "rev_demo_01",
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    textRun: {
                      content: `[POST_START]
POST_ID: PB_SYNC_01
TITLE: Hướng dẫn đăng ký Chữ ký số Viettel-CA online
TOPIC: CHU_KY_SO
PLATFORMS: ZALO, FACEBOOK
STATUS: APPROVED
CONTENT: Doanh nghiệp có thể đăng ký Chữ ký số Viettel-CA hoàn toàn online với thủ tục đơn giản.
HASHTAGS: #Viettel #ChuKySo
[POST_END]

[POST_START]
POST_ID: PB_SYNC_02
TITLE: Lợi ích chuyển đổi sang Hóa đơn điện tử S-Invoice
TOPIC: HOA_DON_DIEN_TU
PLATFORMS: ZALO
STATUS: DRAFT
CONTENT: Tiết kiệm chi phí in ấn và gửi hóa đơn cho khách hàng qua email hoặc tin nhắn SMS.
HASHTAGS: #SInvoice #Viettel
[POST_END]`,
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    },
  };

  const googleDocsConnector = new GoogleDocsConnector(mockDocsTransport);
  const topicClassifier = new TopicClassifier();
  const googleDocsSync = new GoogleDocsSyncService(
    googleDocsConnector,
    topicClassifier,
    contentLibrary,
  );

  return {
    auth,
    guard: new HttpAuthGuard(auth, { secure: false }),
    leads: leads as LeadRepository,
    tasks: tasks as TasksRepository,
    imports: new InMemoryImportApi(previewPort),
    db,
    operations,
    googleConnections: googleConnectionsRepo,
    googleOAuth,
    googleDrive,
    contentLibrary,
    googleDocsSync,
    sessionCookie: {
      secure: false,
      maxAgeSeconds: 28800,
    },
  };
}
