"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccountsView } from "./accounts-view.js";
import { CalendarView } from "./calendar-view.js";
import { CampaignView } from "./campaign-view.js";

type Principal = {
  userId: string;
  workspaceId: string;
  role: "AM" | "MANAGER" | "ADMIN";
  teamId: string | null;
};
type Tab =
  | "home"
  | "leads"
  | "import"
  | "planner"
  | "accounts"
  | "calendar"
  | "campaigns"
  | "team"
  | "audit";
type Lead = {
  id: string;
  companyName: string;
  stage: string;
  district?: string | null;
  ownerName?: string | null;
  contacts?: readonly {
    id: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    contactabilityStatus: string;
  }[];
};
type ImportHandle = {
  handle: string;
  status: string;
  expiresAt: string | null;
  headers?: readonly { index: number; name: string | null }[];
  suggestedMapping?: readonly {
    sourceColumnIndex: number;
    targetField: string;
  }[];
  headerInspection?: {
    status: string;
    columnMap: readonly { sourceColumnIndex: number; targetField: string }[];
    quarantinedColumns: readonly {
      sourceColumnIndex: number;
      classification: string;
    }[];
    warnings: readonly { code: string; sourceColumnIndex?: number }[];
  };
  preview?: {
    totalRows: number;
    rows: readonly ImportRow[];
    commitEligible: false;
  };
  summary?: {
    totalRows: number;
    rowsToKeep: number;
    rowsToMerge: number;
    rowsToSkip: number;
    duplicateCandidateRows: number;
  };
  commitResult?: unknown;
};
type ImportRow = {
  rowNumber: number;
  status: "READY" | "INVALID";
  companyName: string | null;
  stage: string | null;
  contact: { phoneMasked: string | null; emailMasked: string | null };
  issues: readonly { code: string; field?: string }[];
  provenanceReviewReasons: readonly string[];
  suppressionIntent: string | null;
  duplicateReview: {
    candidates: readonly {
      leadId: string;
      display: {
        companyName: string;
        phone: string | null;
        email: string | null;
        district: string | null;
      };
      matchTypes: readonly string[];
      confidence: string;
    }[];
  } | null;
};
type TaskCard = {
  id: string;
  type: string;
  outcomeGoal: string;
  dueAt: string;
  estimatedMinutes: number;
  approvalStatus: string;
  leadId: string | null;
};
type ApiError = { error?: string };

const API = "/api/v1";
const fieldNames = [
  "lead_id",
  "company_name",
  "contact_name",
  "phone",
  "email",
  "industry",
  "district",
  "source",
  "source_url",
  "lawful_contact_basis",
  "consent_status",
  "product_interest",
  "owner_am",
  "stage",
  "last_contact_at",
  "next_action_at",
  "notes",
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(payload.error ?? `HTTP_${response.status}`);
  return payload;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function hcmDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function hcmToday(): string {
  return hcmDate(new Date());
}

function Alert({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "success" | "info";
}) {
  return (
    <div
      className={`alert ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

function LoginPanel({ onLogin }: { onLogin: (principal: Principal) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: Principal }>(
        "/auth/login",
        jsonInit("POST", {
          workspaceId: data.get("workspaceId"),
          email: data.get("email"),
          password: data.get("password"),
        }),
      );
      onLogin(result.user);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Đăng nhập không thành công.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">VT</div>
        <p className="eyebrow">AM VIETTEL SME · NỘI BỘ</p>
        <h1>Đăng nhập workspace</h1>
        <p className="muted">
          Truy cập chỉ dành cho tài khoản được Admin mời. Không có đăng ký công
          khai.
        </p>
        <form onSubmit={submit} className="form-stack">
          <label>
            Workspace ID
            <input name="workspaceId" autoComplete="organization" required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && <Alert>{error}</Alert>}
          <button className="primary" disabled={busy}>
            {busy ? "Đang xác thực…" : "Đăng nhập"}
          </button>
        </form>
        <p className="fine-print">
          Nếu chưa có lời mời, hãy liên hệ Admin workspace. Không nhập dữ liệu
          khách hàng thật vào môi trường thử nghiệm.
        </p>
      </section>
    </main>
  );
}

function InvitePanel() {
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = new URL(window.location.href);
    setToken(url.searchParams.get("token") ?? "");
    url.searchParams.delete("token");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setTokenReady(true);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api(
        "/auth/invitations/accept",
        jsonInit("POST", {
          token,
          displayName: data.get("displayName"),
          password: data.get("password"),
        }),
      );
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể chấp nhận lời mời.",
      );
    }
  }
  if (done)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">LỜI MỜI</p>
          <h1>Tài khoản đã kích hoạt</h1>
          <Alert kind="success">
            Bạn có thể quay lại trang đăng nhập. Việc tạo tài khoản chỉ được
            thực hiện từ lời mời hợp lệ.
          </Alert>
          <a className="button primary link-button" href="/">
            Đi tới đăng nhập
          </a>
        </section>
      </main>
    );
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">VT</div>
        <p className="eyebrow">LỜI MỜI WORKSPACE</p>
        <h1>Hoàn tất tài khoản</h1>
        <p className="muted">Liên kết lời mời dùng một lần và có thời hạn.</p>
        {tokenReady && !token && (
          <Alert>
            Liên kết thiếu token lời mời. Hãy yêu cầu Admin tạo link mới.
          </Alert>
        )}
        <form onSubmit={submit} className="form-stack">
          <label>
            Tên hiển thị
            <input
              name="displayName"
              autoComplete="name"
              maxLength={120}
              required
            />
          </label>
          <label>
            Mật khẩu (ít nhất 12 ký tự)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          {error && <Alert>{error}</Alert>}
          <button className="primary" disabled={!tokenReady || !token}>
            Chấp nhận lời mời
          </button>
        </form>
      </section>
    </main>
  );
}

export function WorkspaceApp({
  initialView = "workspace",
}: {
  initialView?: "workspace" | "invite";
}) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [checking, setChecking] = useState(initialView === "workspace");
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<unknown>(null);
  const [leadList, setLeadList] = useState<unknown>(null);
  const [leadDetail, setLeadDetail] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importHandle, setImportHandle] = useState<ImportHandle | null>(null);
  const [validatingImport, setValidatingImport] = useState(false);
  const validatingImportRef = useRef(false);
  const [commitIdempotencyKey, setCommitIdempotencyKey] = useState("");
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [confirmIgnored, setConfirmIgnored] = useState(false);
  const [planDay, setPlanDay] = useState(hcmToday());
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [plan, setPlan] = useState<unknown>(null);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [plannerLeads, setPlannerLeads] = useState<Lead[]>([]);
  const [plannerUsers, setPlannerUsers] = useState<
    { id: string; displayName: string | null; role: string }[]
  >([]);

  useEffect(() => {
    if (initialView !== "workspace") return;
    api<{ user: Principal }>("/auth/me")
      .then((result) => setPrincipal(result.user))
      .catch(() => setPrincipal(null))
      .finally(() => setChecking(false));
  }, [initialView]);

  const canSeeAdmin =
    principal?.role === "MANAGER" || principal?.role === "ADMIN";
  const tabs: { id: Tab; label: string }[] = useMemo(
    () => [
      { id: "home", label: "Dashboard hôm nay" },
      { id: "leads", label: "Lead" },
      { id: "import", label: "Import Excel" },
      { id: "planner", label: "Tác vụ & Planner" },
      { id: "accounts", label: "Tài khoản & Phiên" },
      { id: "calendar", label: "Lịch nội dung" },
      { id: "campaigns", label: "Chiến dịch & CTV" },
      ...(canSeeAdmin
        ? [
            { id: "team" as const, label: "Nhóm & quyền" },
            { id: "audit" as const, label: "Audit" },
          ]
        : []),
    ],
    [canSeeAdmin],
  );

  async function loadTab(selected = tab) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (selected === "home") {
        const [openTasks, inProgressTasks] = await Promise.all([
          api<TaskCard[]>("/tasks?status=OPEN"),
          api<TaskCard[]>("/tasks?status=IN_PROGRESS"),
        ]);
        setData([...openTasks, ...inProgressTasks]);
      }
      if (selected === "leads") {
        const leads = await api("/leads?limit=50&offset=0");
        setLeadList(leads);
        setData(leads);
      }
      if (selected === "planner") {
        const [openTasks, inProgressTasks, leadResult, usersResult] =
          await Promise.all([
            api<unknown[]>("/tasks?status=OPEN"),
            api<unknown[]>("/tasks?status=IN_PROGRESS"),
            api<{ items?: Lead[] }>("/leads?limit=100&offset=0"),
            principal?.role === "AM"
              ? Promise.resolve({
                  items: [
                    {
                      id: principal.userId,
                      displayName: principal.userId,
                      role: "AM",
                    },
                  ],
                })
              : api<{
                  items?: {
                    id: string;
                    displayName: string | null;
                    role: string;
                  }[];
                }>("/users"),
          ]);
        setData([...openTasks, ...inProgressTasks]);
        setPlannerLeads(leadResult.items ?? []);
        setPlannerUsers(
          (usersResult.items ?? []).filter((user) => user.role === "AM"),
        );
      }
      if (selected === "accounts") {
        setData(await api("/social-accounts").catch(() => ({ items: [] })));
      }
      if (selected === "calendar") {
        setData(await api("/publishing-calendar").catch(() => ({ items: [] })));
      }
      if (selected === "campaigns") {
        setData(
          await api("/campaigns-overview").catch(() => ({
            campaigns: [],
            partners: [],
          })),
        );
      }
      if (selected === "team") {
        const [users, teams] = await Promise.all([
          api("/users"),
          api("/teams"),
        ]);
        setData({ users, teams });
      }
      if (selected === "audit")
        setData(await api("/audit-events?limit=50&offset=0"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (principal && tab !== "import")
      void loadTab(tab); /* data is loaded on tab change */
  }, [principal, tab]);

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* cookie is cleared by the endpoint when available */
    }
    setPrincipal(null);
    setData(null);
    setSelectedLead(null);
  }

  async function selectLead(id: string) {
    setSelectedLead(id);
    setError("");
    setBusy(true);
    try {
      setLeadDetail(await api(`/leads/${encodeURIComponent(id)}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    await loadTab(tab);
  }

  if (initialView === "invite") return <InvitePanel />;
  if (checking)
    return (
      <main className="loading-shell" aria-live="polite">
        Đang kiểm tra phiên đăng nhập…
      </main>
    );
  if (!principal)
    return (
      <LoginPanel
        onLogin={(user) => {
          setPrincipal(user);
          setTab("home");
        }}
      />
    );

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    try {
      const created = await api<{ leadId: string }>(
        "/leads",
        jsonInit("POST", {
          companyName: form.get("companyName"),
          district: form.get("district") || null,
          industry: form.get("industry") || null,
          source: {
            sourceType: form.get("sourceType"),
            sourceLabel: form.get("sourceLabel"),
            contactBasis: form.get("contactBasis"),
          },
        }),
      );
      formElement.reset();
      await loadTab("leads");
      setSelectedLead(created.leadId);
      await selectLead(created.leadId);
      setNotice(
        "Đã tạo lead ở trạng thái PENDING_REVIEW và ghi nhận nguồn khai báo.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo lead.");
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLead) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(
        `/leads/${encodeURIComponent(selectedLead)}/notes`,
        jsonInit("POST", { content: form.get("content") }),
      );
      setNotice("Đã thêm ghi chú.");
      await selectLead(selectedLead);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể thêm ghi chú.",
      );
    }
  }

  async function startUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile) return;
    setError("");
    setNotice("");
    if (!importFile.name.toLowerCase().endsWith(".xlsx")) {
      setError("FILE_EXTENSION_NOT_ALLOWED");
      return;
    }
    if (importFile.size > 5 * 1024 * 1024) {
      setError("FILE_TOO_LARGE");
      return;
    }
    const form = new FormData();
    form.set("file", importFile);
    try {
      const result = await api<ImportHandle>("/import-jobs", {
        method: "POST",
        body: form,
      });
      setImportHandle(result);
      setCommitIdempotencyKey(crypto.randomUUID());
      setMapping(
        Object.fromEntries(
          (result.suggestedMapping ?? []).map((entry) => [
            entry.sourceColumnIndex,
            entry.targetField,
          ]),
        ),
      );
      setDecisions({});
      setNotice(
        "Đã đọc tiêu đề workbook. Hãy kiểm tra allow-list mapping trước khi tạo preview.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể đọc workbook.",
      );
    }
  }

  async function validateImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile || !importHandle || validatingImportRef.current) return;
    validatingImportRef.current = true;
    setValidatingImport(true);
    setError("");
    const entries = Object.entries(mapping)
      .filter(([, target]) => target)
      .map(([index, targetField]) => ({
        sourceColumnIndex: Number(index),
        targetField,
      }));
    try {
      const mapped = await api<ImportHandle>(
        `/import-jobs/${importHandle.handle}/mapping`,
        jsonInit("PUT", { mapping: entries }),
      );
      setImportHandle(mapped);
      const form = new FormData();
      form.set("file", importFile);
      const preview = await api<ImportHandle>(
        `/import-jobs/${importHandle.handle}/validate`,
        { method: "POST", body: form },
      );
      setImportHandle((current) => ({ ...(current ?? mapped), ...preview }));
      const next: Record<number, string> = {};
      for (const row of preview.preview?.rows ?? [])
        next[row.rowNumber] =
          row.status === "INVALID"
            ? "SKIP"
            : row.duplicateReview?.candidates.length
              ? ""
              : "KEEP";
      setDecisions(next);
      setNotice(
        `Preview đã sẵn sàng (${preview.preview?.totalRows ?? 0} dòng). Chưa có dữ liệu nào được ghi vào database.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể tạo preview.",
      );
    } finally {
      validatingImportRef.current = false;
      setValidatingImport(false);
    }
  }

  async function approveImport() {
    if (!importHandle?.preview) return;
    const rows = importHandle.preview.rows;
    const chosen = rows.map((row) => {
      const value = decisions[row.rowNumber] ?? "";
      if (value.startsWith("MERGE:"))
        return {
          rowNumber: row.rowNumber,
          action: "MERGE",
          targetLeadId: value.slice(6),
        };
      return {
        rowNumber: row.rowNumber,
        action: value || (row.status === "INVALID" ? "SKIP" : "KEEP"),
      };
    });
    try {
      const result = await api<{ summary: ImportHandle["summary"] }>(
        `/import-jobs/${importHandle.handle}/approve`,
        jsonInit("POST", {
          decisions: chosen,
          confirmIgnoredColumns: confirmIgnored,
        }),
      );
      setImportHandle((current) =>
        current
          ? {
              ...current,
              status: "APPROVED",
              ...(result.summary ? { summary: result.summary } : {}),
            }
          : current,
      );
      setNotice(
        "Quyết định review đã được chuẩn bị. Bước này chưa commit dữ liệu.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể xác nhận review.",
      );
    }
  }

  async function commitImport() {
    if (!importHandle) return;
    try {
      const idempotencyKey = commitIdempotencyKey || crypto.randomUUID();
      setCommitIdempotencyKey(idempotencyKey);
      const result = await api<unknown>(
        `/import-jobs/${importHandle.handle}/commit`,
        jsonInit("POST", { idempotencyKey }),
      );
      setImportHandle((current) =>
        current
          ? { ...current, status: "COMMITTED", commitResult: result }
          : current,
      );
      setNotice("Import đã hoàn tất. Kết quả đã được lưu trong job audit.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commit thất bại.");
    }
  }

  async function loadPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      setPlan(
        await api(
          `/planner/today?day=${encodeURIComponent(planDay)}&windowStart=${encodeURIComponent(windowStart)}&windowEnd=${encodeURIComponent(windowEnd)}`,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể lập planner.",
      );
    }
  }

  async function completeTask(taskId: string) {
    const outcome = window.prompt(
      "Kết quả thực hiện (không nhập thông tin cá nhân nhạy cảm):",
    );
    if (!outcome) return;
    try {
      await api(
        `/tasks/${encodeURIComponent(taskId)}/complete`,
        jsonInit("POST", { outcome }),
      );
      await loadTab("planner");
      setNotice("Đã hoàn tất task.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể hoàn tất task.",
      );
    }
  }

  async function deferTask(taskId: string) {
    const reason = window.prompt(
      "Lý do hoãn (không nhập thông tin cá nhân nhạy cảm):",
    );
    if (!reason) return;
    try {
      await api(
        `/tasks/${encodeURIComponent(taskId)}/defer`,
        jsonInit("POST", { reason }),
      );
      await loadTab("planner");
      setNotice("Đã hoãn task và ghi nhận lý do.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể hoãn task.");
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const type = String(form.get("type"));
    const leadId =
      type === "REVIEW_LEAD" ? String(form.get("leadId") ?? "") : "";
    const assigneeUserId =
      principal?.role === "AM"
        ? principal.userId
        : String(form.get("assigneeUserId") ?? "");
    if (type === "REVIEW_LEAD" && !leadId) {
      setError("Chọn lead cần review.");
      return;
    }
    if (!assigneeUserId) {
      setError("Chọn AM được giao task.");
      return;
    }
    try {
      await api(
        "/tasks",
        jsonInit("POST", {
          assigneeUserId,
          type,
          leadId: leadId || null,
          outcomeGoal: form.get("outcomeGoal"),
          estimatedMinutes: Number(form.get("estimatedMinutes")),
          dueAt: new Date(
            `${form.get("dueDate")}T${form.get("dueTime")}:00+07:00`,
          ).toISOString(),
          priorityReason: "AM nhập thủ công",
        }),
      );
      formElement.reset();
      await loadTab("planner");
      setNotice("Đã tạo task.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo task.");
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await api<{ invitationUrl: string }>(
        "/users",
        jsonInit("POST", {
          email: form.get("email"),
          role: form.get("role"),
          teamId: form.get("teamId") || null,
        }),
      );
      setInvitationUrl(result.invitationUrl);
      setNotice(
        "Đã tạo lời mời. Link chỉ hiển thị cho Admin trong phiên này; không có email/tin nhắn tự gửi.",
      );
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể tạo lời mời.",
      );
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="AM Viettel SME">
          VT <span>AM SME</span>
        </a>
        <div className="account">
          <span className="role-chip">{principal.role}</span>
          <span className="account-id" title={principal.userId}>
            Tài khoản {principal.userId.slice(0, 8)}
          </span>
          <button className="quiet" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </header>
      <div className="workspace-layout">
        <aside className="sidebar">
          <p className="eyebrow">WORKSPACE</p>
          <nav aria-label="Điều hướng chính">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${tab === item.id ? "active" : ""}`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => {
                  setTab(item.id);
                  setData(null);
                  setSelectedLead(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <strong>Local-first · P0</strong>
            <span>Excel là nguồn dữ liệu. Không có gửi tin Zalo/Telegram.</span>
          </div>
        </aside>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">KHÔNG GIAN LÀM VIỆC</p>
              <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
            </div>
            <button
              className="secondary"
              onClick={() => void refresh()}
              disabled={busy}
            >
              {busy ? "Đang tải…" : "Làm mới"}
            </button>
          </div>
          {error && <Alert>{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          {tab === "home" && (
            <TodayDashboard
              data={data}
              onComplete={(id) => void completeTask(id)}
              onDefer={(id) => void deferTask(id)}
              onOpenPlanner={() => setTab("planner")}
            />
          )}
          {tab === "leads" && (
            <section className="panel-grid">
              <div className="panel">
                <div className="panel-heading">
                  <h2>Danh sách lead</h2>
                  <span className="muted">PII liên hệ được che mặc định</span>
                </div>
                <LeadList
                  data={leadList ?? data}
                  onSelect={(id) => void selectLead(id)}
                  selectedLead={selectedLead}
                />
              </div>
              <div className="panel">
                <h2>Tạo lead</h2>
                <form className="form-stack" onSubmit={submitLead}>
                  <label>
                    Tên doanh nghiệp
                    <input name="companyName" maxLength={200} required />
                  </label>
                  <label>
                    Quận/huyện
                    <input name="district" maxLength={120} />
                  </label>
                  <label>
                    Ngành
                    <input name="industry" maxLength={120} />
                  </label>
                  <label>
                    Loại nguồn
                    <select name="sourceType" defaultValue="AM_ENTERED">
                      <option value="AM_ENTERED">AM nhập thủ công</option>
                      <option value="CUSTOMER_REQUEST">
                        Khách hàng chủ động yêu cầu
                      </option>
                      <option value="REFERRAL">Giới thiệu</option>
                      <option value="WEB_SOURCE">Nguồn web</option>
                      <option value="OTHER">Khác</option>
                    </select>
                  </label>
                  <label>
                    Mô tả nguồn
                    <input
                      name="sourceLabel"
                      maxLength={160}
                      defaultValue="AM nhập thủ công"
                    />
                  </label>
                  <label>
                    Căn cứ liên hệ (chưa ghi nhận nghĩa là UNKNOWN)
                    <select name="contactBasis" defaultValue="UNKNOWN">
                      <option value="UNKNOWN">Chưa xác định</option>
                      <option value="CUSTOMER_REQUEST">
                        Khách hàng yêu cầu
                      </option>
                      <option value="EXISTING_RELATIONSHIP">
                        Quan hệ hiện hữu
                      </option>
                      <option value="CONSENT_RECORDED">
                        Đã ghi nhận consent
                      </option>
                      <option value="OTHER_REVIEW_REQUIRED">
                        Khác — cần review
                      </option>
                    </select>
                  </label>
                  <button className="primary">Tạo PENDING_REVIEW</button>
                </form>
                <p className="fine-print">
                  Lead mới bắt đầu ở PENDING_REVIEW. Ghi nhận nguồn không đồng
                  nghĩa với quyền liên hệ; contactability vẫn cần review riêng.
                </p>
              </div>
              {selectedLead && (
                <LeadDetail
                  data={leadDetail}
                  selectedLead={selectedLead}
                  onAddNote={addNote}
                  onRefresh={() => void selectLead(selectedLead)}
                  onError={setError}
                  onNotice={setNotice}
                />
              )}
            </section>
          )}
          {tab === "import" && (
            <ImportPanel
              file={importFile}
              setFile={(file) => {
                setImportFile(file);
                setImportHandle(null);
                setCommitIdempotencyKey("");
                setMapping({});
                setDecisions({});
                setConfirmIgnored(false);
              }}
              state={importHandle}
              setState={setImportHandle}
              mapping={mapping}
              setMapping={setMapping}
              decisions={decisions}
              setDecisions={setDecisions}
              confirmIgnored={confirmIgnored}
              setConfirmIgnored={setConfirmIgnored}
              validating={validatingImport}
              onUpload={startUpload}
              onValidate={validateImport}
              onApprove={approveImport}
              onCommit={commitImport}
            />
          )}
          {tab === "planner" && (
            <section className="panel-grid">
              <div className="panel">
                <h2>Task list</h2>
                <TaskList
                  data={data}
                  onComplete={(id) => void completeTask(id)}
                  onDefer={(id) => void deferTask(id)}
                />
                <details className="inline-details">
                  <summary>Tạo task</summary>
                  <form className="form-stack" onSubmit={createTask}>
                    <label>
                      Loại
                      <select name="type">
                        <option value="REVIEW_LEAD">Review lead</option>
                        <option value="INTERNAL">Nội bộ</option>
                      </select>
                    </label>
                    <label>
                      Lead cần review (bắt buộc khi loại là REVIEW_LEAD)
                      <select name="leadId" defaultValue="">
                        <option value="">Chọn lead</option>
                        {plannerLeads.map((lead) => (
                          <option key={lead.id} value={lead.id}>
                            {lead.companyName} · {lead.stage}
                          </option>
                        ))}
                      </select>
                    </label>
                    {principal.role !== "AM" && (
                      <label>
                        Giao cho AM
                        <select name="assigneeUserId" defaultValue="">
                          <option value="">Chọn AM</option>
                          {plannerUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.displayName ?? user.id} ·{" "}
                              {user.id.slice(0, 8)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Mục tiêu
                      <input name="outcomeGoal" maxLength={300} required />
                    </label>
                    <label>
                      Ngày đến hạn
                      <input
                        type="date"
                        name="dueDate"
                        defaultValue={hcmToday()}
                        required
                      />
                    </label>
                    <label>
                      Giờ đến hạn
                      <input
                        type="time"
                        name="dueTime"
                        defaultValue="17:00"
                        required
                      />
                    </label>
                    <label>
                      Thời lượng (phút)
                      <input
                        name="estimatedMinutes"
                        type="number"
                        min={5}
                        max={480}
                        defaultValue={30}
                        required
                      />
                    </label>
                    <button className="primary">Tạo task</button>
                  </form>
                  <p className="fine-print">
                    Không tạo task gọi/email/Zalo. Chỉ REVIEW_LEAD hoặc INTERNAL
                    tại P0.
                  </p>
                </details>
              </div>
              <div className="panel">
                <h2>Lập kế hoạch hôm nay</h2>
                <p className="muted">
                  Nhập khoảng thời gian rảnh; hệ thống không tự giả định giờ
                  làm.
                </p>
                <form className="form-grid" onSubmit={loadPlan}>
                  <label>
                    Ngày
                    <input
                      type="date"
                      value={planDay}
                      onChange={(e) => setPlanDay(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Từ
                    <input
                      type="time"
                      value={windowStart}
                      onChange={(e) => setWindowStart(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Đến
                    <input
                      type="time"
                      value={windowEnd}
                      onChange={(e) => setWindowEnd(e.target.value)}
                      required
                    />
                  </label>
                  <button className="primary">Tính kế hoạch</button>
                </form>
                <PlanView data={plan} />
              </div>
            </section>
          )}
          {tab === "team" && (
            <section className="panel-grid">
              <div className="panel">
                <h2>Thành viên trong phạm vi được phép</h2>
                <TeamView data={data} />
                <button
                  className="secondary"
                  onClick={() => void loadTab("team")}
                >
                  Tải thành viên/nhóm
                </button>
              </div>
              {principal.role === "ADMIN" && (
                <div className="panel">
                  <h2>Mời thành viên</h2>
                  <form className="form-stack" onSubmit={inviteUser}>
                    <label>
                      Email
                      <input name="email" type="email" required />
                    </label>
                    <label>
                      Vai trò
                      <select name="role">
                        <option value="AM">AM</option>
                        <option value="MANAGER">Manager</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </label>
                    <label>
                      Team ID (để trống nếu chưa gán)
                      <input name="teamId" />
                    </label>
                    <button className="primary">Tạo lời mời</button>
                  </form>
                  {invitationUrl && (
                    <div className="invite-url">
                      <p>Link lời mời (chỉ Admin được xem):</p>
                      <a href={invitationUrl}>{invitationUrl}</a>
                      <button
                        className="quiet"
                        onClick={() => {
                          void navigator.clipboard?.writeText(invitationUrl);
                          setNotice("Đã sao chép link lời mời.");
                        }}
                      >
                        Sao chép
                      </button>
                    </div>
                  )}
                  <p className="fine-print">
                    Không gửi lời mời qua email, Telegram hoặc Zalo tự động.
                  </p>
                </div>
              )}
            </section>
          )}
          {tab === "accounts" && (
            <AccountsView
              data={data}
              onTriggerQrLogin={(accountId, platform) => {
                setNotice(
                  `Đã gửi yêu cầu mở trình duyệt quét QR cho ${platform} (${accountId}).`,
                );
              }}
            />
          )}
          {tab === "calendar" && (
            <CalendarView
              data={data}
              onApprovePost={(contentId) => {
                setNotice(`Đã ghi nhận duyệt bài ${contentId}.`);
              }}
            />
          )}
          {tab === "campaigns" && <CampaignView data={data} />}
          {tab === "audit" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Sự kiện audit</h2>
                <a
                  className="button secondary link-button"
                  href={`${API}/audit-events?format=csv&limit=100`}
                >
                  Tải CSV (được audit)
                </a>
              </div>
              <AuditView data={data} />
            </section>
          )}
        </main>
      </div>
      <footer className="footer">
        Chỉ dùng local/staging với dữ liệu tổng hợp hoặc được phê duyệt. Preview
        import mất khi tiến trình dừng.
      </footer>
    </div>
  );
}

function LeadList({
  data,
  onSelect,
  selectedLead,
}: {
  data: unknown;
  onSelect: (id: string) => void;
  selectedLead: string | null;
}) {
  const result = data as { items?: Lead[]; total?: number } | null;
  if (!result) return <p className="empty">Đang tải hoặc chưa có lead.</p>;
  if (!result.items?.length)
    return <p className="empty">Chưa có lead trong phạm vi được cấp.</p>;
  return (
    <>
      <p className="muted">{result.total ?? result.items.length} lead</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Doanh nghiệp</th>
              <th>Giai đoạn</th>
              <th>Địa bàn</th>
              <th>Liên hệ (đã che)</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((lead) => (
              <tr
                key={lead.id}
                className={selectedLead === lead.id ? "selected-row" : ""}
              >
                <td>
                  <button
                    className="text-button"
                    onClick={() => onSelect(lead.id)}
                  >
                    {lead.companyName}
                  </button>
                </td>
                <td>
                  <span className="stage-pill">{lead.stage}</span>
                </td>
                <td>{lead.district ?? "—"}</td>
                <td>
                  {lead.contacts
                    ?.map((contact) => contact.phone || contact.email || "—")
                    .join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LeadDetail({
  data,
  selectedLead,
  onAddNote,
  onRefresh,
  onError,
  onNotice,
}: {
  data: unknown;
  selectedLead: string;
  onAddNote: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const lead = data as {
    id?: string;
    companyName?: string;
    stage?: string;
    notes?: readonly { id: string; content: string; createdAt: string }[];
    contacts?: readonly {
      id: string;
      contactName: string | null;
      phone: string | null;
      email: string | null;
      contactabilityStatus: string;
    }[];
    timeline?: readonly {
      action: string;
      at: string;
      changedFieldNames: readonly string[];
    }[];
  } | null;
  if (!lead || lead.id !== selectedLead)
    return (
      <div className="panel span-two">
        <h2>Chi tiết lead</h2>
        <p className="empty">
          Chọn một doanh nghiệp trong danh sách để xem chi tiết.
        </p>
      </div>
    );
  async function stageChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stage = new FormData(event.currentTarget).get("stage");
    try {
      await api(
        `/leads/${encodeURIComponent(selectedLead)}/stage`,
        jsonInit("POST", { stage }),
      );
      onNotice("Đã cập nhật giai đoạn.");
      onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Không thể đổi stage.");
    }
  }
  return (
    <div className="panel span-two">
      <div className="panel-heading">
        <div>
          <h2>{lead.companyName}</h2>
          <p className="muted">
            {lead.id} · {lead.stage}
          </p>
        </div>
        <form className="inline-form" onSubmit={stageChange}>
          <label htmlFor="lead-stage">Chuyển stage</label>
          <select id="lead-stage" name="stage" defaultValue={lead.stage}>
            <option value="PENDING_REVIEW">PENDING_REVIEW</option>
            <option value="NEW">NEW</option>
            <option value="QUALIFIED">QUALIFIED</option>
            <option value="CONTACTED">CONTACTED</option>
            <option value="MEETING_SET">MEETING_SET</option>
            <option value="PROPOSAL">PROPOSAL</option>
            <option value="WON">WON</option>
            <option value="LOST">LOST</option>
          </select>
          <button className="secondary">Lưu</button>
        </form>
      </div>
      <div className="details-grid">
        <section>
          <h3>Liên hệ</h3>
          {lead.contacts?.length ? (
            lead.contacts.map((contact) => (
              <div className="contact-card" key={contact.id}>
                <strong>{contact.contactName ?? "Đầu mối"}</strong>
                <span>{contact.phone ?? "—"}</span>
                <span>{contact.email ?? "—"}</span>
                <small>{contact.contactabilityStatus}</small>
              </div>
            ))
          ) : (
            <p className="empty">Chưa có đầu mối.</p>
          )}
          <h3>Ghi chú</h3>
          <form className="form-stack" onSubmit={onAddNote}>
            <label>
              Ghi chú nghiệp vụ
              <textarea name="content" maxLength={5000} required rows={3} />
            </label>
            <button className="secondary">Thêm ghi chú</button>
          </form>
          {lead.notes?.map((note) => (
            <article className="note" key={note.id}>
              <p>{note.content}</p>
              <time>
                {new Date(note.createdAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </time>
            </article>
          ))}
        </section>
        <section>
          <h3>Timeline</h3>
          {lead.timeline?.map((event, index) => (
            <div className="timeline-item" key={`${event.action}-${index}`}>
              <strong>{event.action}</strong>
              <span>{event.changedFieldNames.join(", ")}</span>
              <time>
                {new Date(event.at).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </time>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function ImportPanel({
  file,
  setFile,
  state,
  setState,
  mapping,
  setMapping,
  decisions,
  setDecisions,
  confirmIgnored,
  setConfirmIgnored,
  validating,
  onUpload,
  onValidate,
  onApprove,
  onCommit,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
  state: ImportHandle | null;
  setState: (state: ImportHandle | null) => void;
  mapping: Record<number, string>;
  setMapping: (mapping: Record<number, string>) => void;
  decisions: Record<number, string>;
  setDecisions: (decisions: Record<number, string>) => void;
  confirmIgnored: boolean;
  setConfirmIgnored: (value: boolean) => void;
  validating: boolean;
  onUpload: (event: FormEvent<HTMLFormElement>) => void;
  onValidate: (event: FormEvent<HTMLFormElement>) => void;
  onApprove: () => void;
  onCommit: () => void;
}) {
  const ignoredCount = state?.headerInspection?.quarantinedColumns.length ?? 0;
  return (
    <section className="panel import-panel">
      <div className="stepper" aria-label="Etapas import">
        <span className={!state ? "current" : "done"}>1 · Tải file</span>
        <span
          className={
            state?.status === "UPLOADED" ? "current" : state ? "done" : ""
          }
        >
          2 · Mapping
        </span>
        <span
          className={
            state?.status === "VALIDATED"
              ? "current"
              : ["APPROVED", "COMMITTED"].includes(state?.status ?? "")
                ? "done"
                : ""
          }
        >
          3 · Review
        </span>
        <span
          className={
            state?.status === "APPROVED"
              ? "current"
              : state?.status === "COMMITTED"
                ? "done"
                : ""
          }
        >
          4 · Commit
        </span>
      </div>
      <p className="muted">
        Chỉ .xlsx, tối đa 5 MiB. File được xử lý trong request; không lưu
        workbook thô. Preview PII chỉ ở RAM tối đa 30 phút.
      </p>
      <form className="upload-form" onSubmit={onUpload}>
        <label>
          Workbook (.xlsx)
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
        </label>
        <button className="primary" disabled={!file}>
          Đọc tiêu đề
        </button>
      </form>
      {state?.status === "UPLOADED" && (
        <form className="mapping-form" onSubmit={onValidate}>
          <h2>Mapping allow-list</h2>
          <p className="muted">
            Chọn đích cho từng cột cần nhập. Bỏ trống để bỏ qua cột; trường công
            ty là bắt buộc.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cột nguồn</th>
                  <th>Đưa vào trường</th>
                </tr>
              </thead>
              <tbody>
                {(state.headers ?? []).map((header) => (
                  <tr key={header.index}>
                    <td>
                      <span className="column-index">{header.index + 1}</span>{" "}
                      {header.name ?? "(header trống)"}
                      {state.headerInspection?.quarantinedColumns.some(
                        (column) => column.sourceColumnIndex === header.index,
                      ) && <span className="warning-tag">Bỏ qua mặc định</span>}
                    </td>
                    <td>
                      <select
                        aria-label={`Mapping cột ${header.index + 1}`}
                        value={mapping[header.index] ?? ""}
                        onChange={(event) =>
                          setMapping({
                            ...mapping,
                            [header.index]: event.target.value,
                          })
                        }
                      >
                        <option value="">— Bỏ qua —</option>
                        {fieldNames.map((field) => (
                          <option
                            key={field}
                            value={field}
                            disabled={
                              fieldNames.includes(
                                mapping[header.index] ?? "",
                              ) &&
                              mapping[header.index] !== field &&
                              Object.entries(mapping).some(
                                ([index, selected]) =>
                                  Number(index) !== header.index &&
                                  selected === field,
                              )
                            }
                          >
                            {field}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ignoredCount > 0 && (
            <p className="fine-print">
              Có {ignoredCount} cột ngoài mapping allow-list sẽ bị quarantine.
            </p>
          )}
          <button className="primary" disabled={validating}>
            {validating ? "Đang tạo preview…" : "Tạo preview"}
          </button>
        </form>
      )}
      {state?.preview && (
        <div className="review-area">
          <div className="panel-heading">
            <div>
              <h2>Review {state.preview.totalRows} dòng</h2>
              <p className="muted">
                Trạng thái commitEligible=false cho tới khi từng dòng được xử
                lý.
              </p>
            </div>
            <span className="expiry-chip">
              Hết hạn:{" "}
              {state.expiresAt
                ? new Date(state.expiresAt).toLocaleTimeString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })
                : "—"}
            </span>
          </div>
          {ignoredCount > 0 && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmIgnored}
                onChange={(e) => setConfirmIgnored(e.target.checked)}
              />{" "}
              Tôi xác nhận các cột quarantine không được nhập
            </label>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>Doanh nghiệp</th>
                  <th>Liên hệ đã che</th>
                  <th>Kiểm tra</th>
                  <th>Quyết định AM</th>
                </tr>
              </thead>
              <tbody>
                {state.preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.companyName ?? "—"}</td>
                    <td>
                      {row.contact.phoneMasked ?? "—"}
                      <br />
                      {row.contact.emailMasked ?? "—"}
                    </td>
                    <td>
                      {row.status === "INVALID" ? (
                        row.issues
                          .map(
                            (issue) => `${issue.field ?? "row"}: ${issue.code}`,
                          )
                          .join("; ")
                      ) : (
                        <>
                          {row.provenanceReviewReasons.join(", ") ||
                            "Không có cảnh báo provenance"}
                          {row.suppressionIntent && (
                            <strong className="danger-text">
                              {" "}
                              · OPT-OUT / SUPPRESSION
                            </strong>
                          )}
                          {row.duplicateReview?.candidates.map((candidate) => (
                            <div className="candidate" key={candidate.leadId}>
                              <span>
                                {candidate.display.companyName} ·{" "}
                                {candidate.matchTypes.join(", ")} ·{" "}
                                {candidate.confidence}
                              </span>
                              <small>
                                {candidate.display.phone ??
                                  candidate.display.email ??
                                  "Liên hệ đã che"}
                              </small>
                            </div>
                          ))}
                        </>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label={`Quyết định dòng ${row.rowNumber}`}
                        value={decisions[row.rowNumber] ?? ""}
                        onChange={(event) =>
                          setDecisions({
                            ...decisions,
                            [row.rowNumber]: event.target.value,
                          })
                        }
                      >
                        <option value="">Chọn quyết định</option>
                        <option value="KEEP">Giữ như lead mới</option>
                        {row.duplicateReview?.candidates.map((candidate) => (
                          <option
                            key={candidate.leadId}
                            value={`MERGE:${candidate.leadId}`}
                          >
                            Merge vào {candidate.display.companyName}
                          </option>
                        ))}
                        <option value="SKIP">Bỏ qua dòng</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.status === "VALIDATED" && (
            <button className="primary" onClick={onApprove}>
              Xác nhận review (chưa commit)
            </button>
          )}
          {state.status === "APPROVED" && (
            <div className="commit-box">
              <p>
                Đã chuẩn bị: giữ {state.summary?.rowsToKeep}, merge{" "}
                {state.summary?.rowsToMerge}, bỏ qua {state.summary?.rowsToSkip}
                .
              </p>
              <button className="primary danger-button" onClick={onCommit}>
                Commit riêng biệt
              </button>
            </div>
          )}
          {state.status === "COMMITTED" && (
            <Alert kind="success">
              Commit đã hoàn tất. {JSON.stringify(state.commitResult)}
            </Alert>
          )}
        </div>
      )}
      {state?.status === "EXPIRED" && (
        <Alert>PREVIEW_EXPIRED · Tải lại file để bắt đầu phiên mới.</Alert>
      )}
      {state && state.status !== "COMMITTED" && (
        <button
          className="quiet"
          onClick={() => {
            setState(null);
            setFile(null);
            setMapping({});
            setDecisions({});
          }}
        >
          Hủy import
        </button>
      )}
    </section>
  );
}

function TodayDashboard({
  data,
  onComplete,
  onDefer,
  onOpenPlanner,
}: {
  data: unknown;
  onComplete: (id: string) => void;
  onDefer: (id: string) => void;
  onOpenPlanner: () => void;
}) {
  const tasks = data as readonly TaskCard[] | null;
  if (!tasks)
    return <p className="empty">Đang tải tác vụ trong phạm vi được cấp.</p>;
  const today = hcmToday();
  const dueToday = tasks.filter((task) => hcmDate(task.dueAt) === today);
  const overdue = tasks.filter((task) => {
    const date = hcmDate(task.dueAt);
    return date !== "" && date < today;
  });
  return (
    <section className="panel-grid">
      <div className="panel">
        <div className="panel-heading">
          <h2>Đến hạn hôm nay · {today}</h2>
          <span className="muted">{dueToday.length} task</span>
        </div>
        <TaskList
          data={dueToday}
          onComplete={onComplete}
          onDefer={onDefer}
          emptyMessage="Không có task đến hạn hôm nay."
        />
      </div>
      <div className="panel">
        <div className="panel-heading">
          <h2>Quá hạn</h2>
          <span className="muted">{overdue.length} task</span>
        </div>
        <TaskList
          data={overdue}
          onComplete={onComplete}
          onDefer={onDefer}
          emptyMessage="Không có task quá hạn."
        />
      </div>
      <div className="panel">
        <h2>Lập kế hoạch trong thời gian rảnh</h2>
        <p className="muted">
          Planner không tự giả định giờ làm; nhập khoảng thời gian phù hợp với
          lịch của bạn.
        </p>
        <button className="secondary" onClick={onOpenPlanner}>
          Mở Planner
        </button>
      </div>
    </section>
  );
}

function TaskList({
  data,
  onComplete,
  onDefer,
  emptyMessage = "Không có task đang mở.",
}: {
  data: unknown;
  onComplete: (id: string) => void;
  onDefer: (id: string) => void;
  emptyMessage?: string;
}) {
  const tasks = data as readonly TaskCard[] | null;
  if (!tasks) return <p className="empty">Tải task để xem danh sách.</p>;
  if (!tasks.length) return <p className="empty">{emptyMessage}</p>;
  return (
    <div className="task-list">
      {tasks.map((task) => (
        <article className="task-card" key={task.id}>
          <div>
            <span className="stage-pill">{task.type}</span>
            <h3>{task.outcomeGoal}</h3>
            <p>
              {new Date(task.dueAt).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}{" "}
              · {task.estimatedMinutes} phút
            </p>
            <small>
              {task.approvalStatus}
              {task.leadId ? ` · Lead ${task.leadId.slice(0, 8)}` : " · Nội bộ"}
            </small>
          </div>
          <div className="button-group">
            <button className="secondary" onClick={() => onComplete(task.id)}>
              Hoàn tất
            </button>
            <button className="quiet" onClick={() => onDefer(task.id)}>
              Hoãn
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function PlanView({ data }: { data: unknown }) {
  if (!data)
    return (
      <p className="empty">
        Chưa tính kế hoạch. Ngày được hiểu theo Asia/Ho_Chi_Minh.
      </p>
    );
  const plan = data as {
    tasks?: readonly {
      task: { id: string; type: string; outcomeGoal: string };
      scheduledStartAt: string;
      scheduledEndAt: string;
    }[];
    skipped?: readonly { taskId: string; reason: string }[];
    lockedBlocks?: readonly {
      label: string | null;
      startsAt: string;
      endsAt: string;
    }[];
  };
  return (
    <div className="plan-list">
      {plan.tasks?.length ? (
        plan.tasks.map((item) => (
          <article key={item.task.id} className="plan-item">
            <span>
              {new Date(item.scheduledStartAt).toLocaleTimeString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <div>
              <strong>{item.task.type}</strong>
              <p>{item.task.outcomeGoal}</p>
            </div>
          </article>
        ))
      ) : (
        <p className="empty">
          Không có task đủ điều kiện trong khoảng thời gian này.
        </p>
      )}
      {plan.lockedBlocks?.map((block, index) => (
        <p className="fine-print" key={index}>
          Lịch khóa giữ nguyên: {block.label ?? "Bận"} ·{" "}
          {new Date(block.startsAt).toLocaleTimeString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
          })}
          –
          {new Date(block.endsAt).toLocaleTimeString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
          })}
        </p>
      ))}
      {Boolean(plan.skipped?.length) && (
        <details>
          <summary>{plan.skipped?.length} task bị bỏ qua</summary>
          <ul>
            {plan.skipped?.map((item) => (
              <li key={item.taskId}>
                {item.taskId.slice(0, 8)} · {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TeamView({ data }: { data: unknown }) {
  if (!data) return <p className="empty">Tải dữ liệu thành viên.</p>;
  const view = data as {
    users?: readonly {
      id: string;
      displayName: string | null;
      role: string;
      teamId: string | null;
      status: string;
    }[];
    teams?: readonly { id: string; name: string; memberCount: number }[];
  };
  return (
    <>
      <h3>Nhóm</h3>
      {view.teams?.length ? (
        <ul>
          {view.teams.map((team) => (
            <li key={team.id}>
              {team.name} · {team.memberCount} thành viên{" "}
              <small>({team.id})</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Không có nhóm trong phạm vi.</p>
      )}
      <h3>Thành viên</h3>
      {view.users?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Vai trò</th>
                <th>Nhóm</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {view.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName ?? "(chưa nhận lời mời)"}</td>
                  <td>{user.role}</td>
                  <td>{user.teamId ?? "—"}</td>
                  <td>{user.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Không có thành viên.</p>
      )}
    </>
  );
}

function AuditView({ data }: { data: unknown }) {
  if (!data) return <p className="empty">Tải audit events.</p>;
  const items =
    (
      data as {
        items?: readonly {
          id: string;
          actorId: string | null;
          actorRole: string | null;
          action: string;
          entityType: string;
          entityId: string;
          changedFieldNames: readonly string[];
          createdAt: string;
        }[];
      }
    ).items ?? [];
  if (!items.length) return <p className="empty">Chưa có audit event.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Thời điểm</th>
            <th>Actor</th>
            <th>Hành động</th>
            <th>Đối tượng</th>
            <th>Trường đổi</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                {new Date(item.createdAt).toLocaleString("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </td>
              <td>
                {item.actorRole ?? "SYSTEM"}
                <small>{item.actorId?.slice(0, 8)}</small>
              </td>
              <td>{item.action}</td>
              <td>
                {item.entityType} · {item.entityId.slice(0, 8)}
              </td>
              <td>{item.changedFieldNames.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
