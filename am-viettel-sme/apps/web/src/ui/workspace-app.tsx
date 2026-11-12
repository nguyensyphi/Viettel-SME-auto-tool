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
import { FacebookAutoPosterView } from "./facebook-auto-poster-view.js";
import { UIHealthInspector } from "./ui-health-inspector.js";

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
  | "fb-poster"
  | "campaigns"
  | "team"
  | "audit";
type Lead = {
  id: string;
  companyName: string;
  stage: string;
  district?: string | null;
  industry?: string | null;
  ownerName?: string | null;
  contacts?: readonly {
    id: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    contactabilityStatus: string;
  }[];
  leadScore?: {
    totalScore: number;
    tier: "A" | "B" | "C" | "D";
    recommendedProducts: string[];
    tierExplanation: string;
    industryScore: number;
    establishmentScore: number;
    scaleScore: number;
    productDemandScore: number;
    contactInfoScore: number;
    businessSignalScore: number;
  };
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

const inFlightRequests = new Map<string, Promise<unknown>>();

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";

  if (isGet) {
    const existing = inFlightRequests.get(path);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  const call = (async () => {
    try {
      const response = await fetch(`${API}${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
      });
      const payload = (await response.json().catch(() => ({}))) as T & ApiError;
      if (!response.ok) throw new Error(payload.error ?? `HTTP_${response.status}`);
      return payload;
    } finally {
      if (isGet) {
        inFlightRequests.delete(path);
      }
    }
  })();

  if (isGet) {
    inFlightRequests.set(path, call);
  }

  return call;
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

function formatUserFacingError(error: string): string {
  if (error.includes("PERSONAL_IDENTIFIER_COLUMN_BLOCKED")) {
    return "Phát hiện file chứa cột định danh cá nhân nhạy cảm (CMND, CCCD hoặc Ngày cấp) bị chặn theo Nghị định 13/2023/NĐ-CP để bảo vệ dữ liệu cá nhân. Vui lòng sử dụng file mẫu chuẩn hóa đã lọc bỏ CMND/CCCD hoặc xóa các cột CMND/CCCD trước khi tải lên.";
  }
  if (error.includes("WORKSHEET_NOT_FOUND")) {
    return "Không tìm thấy trang tính hợp lệ trong workbook. Tệp Excel (.xlsx) cần chứa ít nhất một trang tính hợp lệ có tiêu đề.";
  }
  if (error.includes("FILE_TOO_LARGE")) {
    return "Dung lượng tệp vượt quá giới hạn 5 MiB cho phép.";
  }
  if (error.includes("FILE_EXTENSION_NOT_ALLOWED")) {
    return "Định dạng tệp không được hỗ trợ. Chỉ chấp nhận tệp có phần mở rộng .xlsx.";
  }
  if (error.includes("EMPTY_FILE")) {
    return "Tệp Excel tải lên rỗng, không có dữ liệu.";
  }
  if (error.includes("HEADER_MAPPING_INVALID")) {
    return "Cấu trúc cột không hợp lệ hoặc thiếu cột Tên doanh nghiệp bắt buộc.";
  }
  if (error.includes("ACTIVE_IMPORT_LIMIT_REACHED")) {
    return "Đã đạt giới hạn tối đa 10 phiên import đồng thời.";
  }
  if (error.includes("LEAD_NOT_FOUND")) {
    return "Không tìm thấy khách hàng tiềm năng tương ứng.";
  }
  if (error.includes("UNAUTHORIZED") || error.includes("HTTP_401")) {
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  }
  if (error.includes("INVALID_REQUEST")) {
    return "Yêu cầu không hợp lệ. Vui lòng kiểm tra lại nội dung bài viết và danh sách nhóm đã chọn.";
  }
  if (error.includes("UNKNOWN_FIELD")) {
    return "Dữ liệu yêu cầu chứa trường không được hỗ trợ.";
  }
  if (error.includes("INVALID_DOCUMENT_FORMAT")) {
    return "Định dạng tài liệu không hợp lệ. Vui lòng kiểm tra lại cấu trúc bài viết.";
  }
  if (error.includes("KILL_SWITCH_ACTIVE")) {
    return "Công tắc dừng khẩn cấp toàn hệ thống (Kill Switch) đang bật. Toàn bộ tác vụ đăng bài và tiếp cận tạm thời dừng để bảo vệ an toàn tài khoản AM.";
  }
  if (error.includes("CIRCUIT_BREAKER_OPEN")) {
    return "Tài khoản tạm thời bị ngắt bảo vệ (Circuit Breaker OPEN) do phát hiện lỗi liên tiếp. Vui lòng khôi phục Circuit tại tab Tài khoản & Phiên.";
  }
  if (error.includes("ACCOUNT_NOT_CONNECTED")) {
    return "Tài khoản mạng xã hội chưa được kết nối hoặc phiên đăng nhập đã hết hạn. Vui lòng quét lại QR.";
  }
  if (error.includes("DUPLICATE_TAX_CODE") || error.includes("TAX_CODE_ALREADY_EXISTS")) {
    return "Mã số thuế của doanh nghiệp đã tồn tại trong hệ thống. Đã bảo lưu chống trùng lặp.";
  }
  if (error.includes("OUTREACH_BUSY")) {
    return "Đang có đợt gửi tin nhắn tiếp cận đang chạy. Vui lòng chờ hoàn tất đợt hiện tại.";
  }
  if (error.includes("CHECKPOINT_DETECTED")) {
    return "Phát hiện tài khoản bị yêu cầu xác minh bảo mật (Checkpoint / 2FA). Vui lòng dùng nút 'Mở trình duyệt đăng nhập' để xác thực trực tiếp trên Google Chrome.";
  }
  return error;
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
            <input
              name="workspaceId"
              defaultValue="viettel-sme"
              placeholder="viettel-sme"
              autoComplete="organization"
              required
            />
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
          {error && <Alert>{formatUserFacingError(error)}</Alert>}
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
          {error && <Alert>{formatUserFacingError(error)}</Alert>}
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
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<unknown>(null);
  const [homeData, setHomeData] = useState<readonly TaskCard[] | null>(null);
  const [plannerTasks, setPlannerTasks] = useState<readonly TaskCard[] | null>(null);
  const [accountsData, setAccountsData] = useState<unknown>(null);
  const [calendarData, setCalendarData] = useState<unknown>(null);
  const [campaignsData, setCampaignsData] = useState<unknown>(null);
  const [fbPosterData, setFbPosterData] = useState<any>(null);
  const [teamData, setTeamData] = useState<unknown>(null);
  const [auditData, setAuditData] = useState<unknown>(null);
  const [activeOutreachBatch, setActiveOutreachBatch] = useState<unknown>(null);
  const [leadList, setLeadList] = useState<unknown>(null);
  const [leadDetail, setLeadDetail] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importHandle, setImportHandle] = useState<ImportHandle | null>(null);
  const [validatingImport, setValidatingImport] = useState(false);
  const validatingImportRef = useRef(false);
  const activeTabRef = useRef<Tab>(tab);
  activeTabRef.current = tab;
  const loadSeqRef = useRef(0);
  const lastFetchedAtRef = useRef<Record<string, number>>({});
  const CACHE_TTL_MS = 60_000;
  const invalidateTabs = (...targetTabs: Tab[]) => {
    for (const t of targetTabs) {
      delete lastFetchedAtRef.current[t];
    }
  };
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
      { id: "fb-poster", label: "Auto Poster Facebook" },
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

  async function loadTab(selected = tab, options?: { force?: boolean }) {
    const seq = ++loadSeqRef.current;
    const isCurrent = () =>
      seq === loadSeqRef.current && activeTabRef.current === selected;

    const lastFetched = lastFetchedAtRef.current[selected] ?? 0;
    const isFresh = Date.now() - lastFetched < CACHE_TTL_MS;
    const hasData =
      (selected === "home" && (homeData !== null || (data !== null && activeTabRef.current === "home"))) ||
      (selected === "leads" && leadList !== null) ||
      (selected === "planner" && plannerTasks !== null) ||
      (selected === "accounts" && accountsData !== null) ||
      (selected === "calendar" && calendarData !== null) ||
      (selected === "fb-poster" && fbPosterData !== null) ||
      (selected === "campaigns" && campaignsData !== null) ||
      (selected === "team" && teamData !== null) ||
      (selected === "audit" && auditData !== null);

    if (!options?.force && isFresh && hasData) {
      return;
    }

    setError("");
    setNotice("");
    if (!hasData || options?.force) {
      setBusy(true);
    }
    try {
      if (selected === "home") {
        const [openTasks, inProgressTasks] = await Promise.all([
          api<TaskCard[]>("/tasks?status=OPEN"),
          api<TaskCard[]>("/tasks?status=IN_PROGRESS"),
        ]);
        if (isCurrent()) {
          const map = new Map<string, TaskCard>();
          for (const item of [...openTasks, ...inProgressTasks]) {
            map.set(item.id, item);
          }
          const taskList = Array.from(map.values());
          setHomeData(taskList);
          setData(taskList);
          lastFetchedAtRef.current["home"] = Date.now();
        }
      }
      if (selected === "leads") {
        const leads = await api("/leads?limit=50&offset=0");
        if (isCurrent()) {
          setLeadList(leads);
          setData(leads);
          lastFetchedAtRef.current["leads"] = Date.now();
        }
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
        if (isCurrent()) {
          const tasks = [...openTasks, ...inProgressTasks] as TaskCard[];
          setPlannerTasks(tasks);
          setData(tasks);
          setPlannerLeads(leadResult.items ?? []);
          setPlannerUsers(
            (usersResult.items ?? []).filter((user) => user.role === "AM"),
          );
          lastFetchedAtRef.current["planner"] = Date.now();
        }
      }
      if (selected === "accounts") {
        const [accounts, opsStatus] = await Promise.all([
          api<any>("/social-accounts"),
          api<{ killSwitch?: unknown }>("/ops/status").catch(() => null),
        ]);
        const items = Array.isArray(accounts)
          ? accounts
          : Array.isArray(accounts?.items)
            ? accounts.items
            : [];
        const combined = {
          items,
          ...(opsStatus?.killSwitch
            ? { killSwitch: opsStatus.killSwitch }
            : {}),
        };
        if (isCurrent()) {
          setAccountsData(combined);
          setData(combined);
          lastFetchedAtRef.current["accounts"] = Date.now();
        }
      }
      if (selected === "calendar") {
        const [calendar, contentsRes, jobsRes, analyticsRes] = await Promise.all([
          api<any>("/publishing-calendar"),
          api<{ items?: unknown[]; posts?: unknown[] }>("/contents").catch(() => null),
          api<{ items?: unknown[]; jobs?: unknown[] }>("/publishing/jobs").catch(() => null),
          api("/analytics/publishing-summary").catch(() => null),
        ]);
        const items = Array.isArray(calendar)
          ? calendar
          : Array.isArray(calendar?.items)
            ? calendar.items
            : [];
        const contentsList = contentsRes?.items ?? contentsRes?.posts;
        const jobsList = jobsRes?.jobs ?? jobsRes?.items;
        const combined = {
          items,
          ...(Array.isArray(contentsList) ? { contents: contentsList } : {}),
          ...(Array.isArray(jobsList) ? { jobs: jobsList } : {}),
          ...(analyticsRes &&
            typeof analyticsRes === "object" &&
            !Array.isArray(analyticsRes) &&
            "posts" in analyticsRes
            ? { analytics: analyticsRes }
            : {}),
        };
        if (isCurrent()) {
          setCalendarData(combined);
          setData(combined);
          lastFetchedAtRef.current["calendar"] = Date.now();
        }
      }
      if (selected === "campaigns") {
        const [overview, leadsRes, groupJobsRes, accountsRes] = await Promise.all([
          api("/campaigns-overview"),
          api<{ leads: any[] }>("/leads?limit=50&offset=0").catch(() => ({ leads: [] })),
          api<{ jobs?: unknown[] }>("/campaigns/group-jobs").catch(() => ({ jobs: [] })),
          api<any>("/social-accounts").catch(() => []),
        ]);
        const accountsList = Array.isArray(accountsRes)
          ? accountsRes
          : Array.isArray(accountsRes?.items)
            ? accountsRes.items
            : [];
        const combined = {
          ...(typeof overview === "object" && overview ? overview : {}),
          leads: (leadsRes as any)?.leads ?? [],
          groupJobs: groupJobsRes?.jobs ?? [],
          accounts: accountsList,
          activeOutreachBatch,
        };
        if (isCurrent()) {
          setCampaignsData(combined);
          setData(combined);
          lastFetchedAtRef.current["campaigns"] = Date.now();
        }
      }
      if (selected === "fb-poster") {
        const [accountsRes, overviewRes, groupJobsRes, contentsRes] = await Promise.all([
          api<any>("/social-accounts").catch(() => []),
          api<any>("/campaigns-overview").catch(() => null),
          api<any>("/campaigns/group-jobs").catch(() => ({ jobs: [] })),
          api<any>("/contents").catch(() => ({ items: [], posts: [] })),
        ]);
        const accountsList = Array.isArray(accountsRes)
          ? accountsRes
          : Array.isArray(accountsRes?.items)
            ? accountsRes.items
            : [];
        const groupsList = Array.isArray(overviewRes?.groups) ? overviewRes.groups : [];
        const contentsList = Array.isArray(contentsRes?.items)
          ? contentsRes.items
          : Array.isArray(contentsRes?.posts)
            ? contentsRes.posts
            : Array.isArray(contentsRes)
              ? contentsRes
              : [];
        const postsList = contentsList.map((c: any) => ({
          id: c.id ?? c.contentId ?? c.postCode ?? "POST-1",
          title: c.title ?? c.topic ?? c.id ?? "Bài viết",
          content: c.body ?? c.rawContent ?? c.content ?? c.topic ?? c.title ?? "",
          mediaPaths:
            Array.isArray(c.mediaPaths) && c.mediaPaths.length > 0
              ? c.mediaPaths
              : c.mediaHint && typeof c.mediaHint === "string" && c.mediaHint !== "AUTO"
                ? [c.mediaHint]
                : [
                    c.topicCode === "CHU_KY_SO"
                      ? "https://images.unsplash.com/photo-1450133064473-71024230f91b?w=600&auto=format&fit=crop&q=80"
                      : c.topicCode === "HOA_DON_DIEN_TU"
                        ? "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&auto=format&fit=crop&q=80"
                        : "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&auto=format&fit=crop&q=80",
                  ],
          createdAt: c.createdAt,
        }));
        const rawJobs = Array.isArray(groupJobsRes?.jobs)
          ? groupJobsRes.jobs
          : Array.isArray(groupJobsRes)
            ? groupJobsRes
            : [];
        const jobsList = rawJobs.map((j: any) => ({
          jobId: j.id ?? j.jobId ?? "job-1",
          campaignId: j.campaignId,
          groupName: j.groupName ?? j.groupId ?? "Nhóm Facebook",
          groupUrl: j.groupUrl ?? "",
          accountId: j.accountId ?? "fb-viettel-sme",
          content: j.content ?? "",
          status: j.status ?? "QUEUED",
          postUrl: j.postUrl ?? j.publishedUrl,
          error: j.error,
          dispatchedAt: j.dispatchedAt ?? new Date().toISOString(),
          executedAt: j.executedAt,
        }));
        const fbAccounts = accountsList.filter(
          (a: any) =>
            a.platform === "FACEBOOK" ||
            (!String(a.accountId).toLowerCase().startsWith("zalo") && a.platform !== "ZALO"),
        );
        const fbGroups = groupsList.filter(
          (g: any) =>
            g.platform === "FACEBOOK" ||
            (!String(g.url).includes("zalo.me") && g.platform !== "ZALO"),
        );
        const fbJobs = jobsList.filter(
          (j: any) => !String(j.groupUrl).includes("zalo.me"),
        );
        const combined = {
          accounts: fbAccounts,
          groups: fbGroups,
          posts: postsList,
          libraryPosts: postsList,
          logs: fbJobs,
        };
        if (isCurrent()) {
          setFbPosterData(combined);
          setData(combined);
          lastFetchedAtRef.current["fb-poster"] = Date.now();
        }
      }
      if (selected === "team") {
        const [users, teams] = await Promise.all([
          api("/users"),
          api("/teams"),
        ]);
        if (isCurrent()) {
          const combined = { users, teams };
          setTeamData(combined);
          setData(combined);
          lastFetchedAtRef.current["team"] = Date.now();
        }
      }
      if (selected === "audit") {
        const audit = await api("/audit-events?limit=50&offset=0");
        if (isCurrent()) {
          setAuditData(audit);
          setData(audit);
          lastFetchedAtRef.current["audit"] = Date.now();
        }
      }
    } catch (cause) {
      if (isCurrent()) {
        setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setBusy(false);
      }
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
    setHomeData(null);
    setLeadList(null);
    setPlannerTasks(null);
    setAccountsData(null);
    setCalendarData(null);
    setFbPosterData(null);
    setCampaignsData(null);
    setTeamData(null);
    setAuditData(null);
    lastFetchedAtRef.current = {};
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
    await loadTab(tab, { force: true });
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
      const hasSensitive = result.headerInspection?.quarantinedColumns.some(
        (q) => q.classification === "PERSONAL_IDENTIFIER",
      );
      setNotice(
        hasSensitive
          ? "Đã đọc tiêu đề workbook. Các cột CMND/CCCD/Ngày cấp đã được tự động loại bỏ để bảo vệ an toàn PII theo Nghị định 13/2023/NĐ-CP. Hãy kiểm tra mapping trước khi tạo preview."
          : "Đã đọc tiêu đề workbook. Hãy kiểm tra allow-list mapping trước khi tạo preview.",
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
      await loadTab(tab);
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
      await loadTab(tab);
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
          <button
            type="button"
            className="secondary"
            onClick={() => setIsInspectorOpen(true)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 4,
              backgroundColor: "#f0fdfa",
              color: "#0f766e",
              border: "1px solid #99f6e4",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            <span>🔍</span> Kiểm tra UI/UX
          </button>
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
                  activeTabRef.current = item.id;
                  setError("");
                  setNotice("");
                  setTab(item.id);
                  if (item.id !== "leads") {
                    setSelectedLead(null);
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <strong>Tự động hoá SME Viettel</strong>
            <span>Đa kênh Facebook, Zalo, Google Drive &amp; Excel.</span>
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
          {error && <Alert>{formatUserFacingError(error)}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          {tab === "home" && (
            <TodayDashboard
              data={homeData ?? (Array.isArray(data) ? (data as readonly TaskCard[]) : null)}
              onComplete={(id) => void completeTask(id)}
              onDefer={(id) => void deferTask(id)}
              onOpenPlanner={() => setTab("planner")}
              onSwitchTab={(target) => {
                activeTabRef.current = target;
                setTab(target);
                void loadTab(target);
              }}
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
              onSwitchToLeads={() => {
                activeTabRef.current = "leads";
                setTab("leads");
                void loadTab("leads", { force: true });
              }}
            />
          )}
          {tab === "planner" && (
            <section className="panel-grid">
              <div className="panel">
                <h2>Task list</h2>
                <TaskList
                  data={plannerTasks ?? (Array.isArray(data) ? (data as readonly TaskCard[]) : null)}
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
                <TeamView data={teamData ?? data} />
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
              data={accountsData}
              onTriggerQrLogin={(accountId, platform) => {
                void (async () => {
                  setError("");
                  try {
                    await api(
                      `/social-accounts/${encodeURIComponent(accountId)}/qr-login`,
                      jsonInit("POST", { platform }),
                    );
                    invalidateTabs("accounts", "fb-poster");
                    if (activeTabRef.current === "accounts") {
                      await loadTab("accounts", { force: true });
                    }
                    setNotice(
                      `Đã khởi chạy cửa sổ Playwright quét QR cho ${platform} (${accountId}).`,
                    );
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "QR_LOGIN_FAILED",
                    );
                  }
                })();
              }}
              onConnectAccount={(accountId, platform) => {
                void (async () => {
                  setError("");
                  try {
                    await api(
                      `/social-accounts/${encodeURIComponent(accountId)}/connect`,
                      jsonInit("POST", { platform }),
                    );
                    invalidateTabs("accounts", "fb-poster", "campaigns");
                    if (activeTabRef.current === "accounts") {
                      await loadTab("accounts", { force: true });
                    }
                    setNotice(
                      `Đã kết nối thành công tài khoản ${platform} (${accountId})!`,
                    );
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "CONNECT_FAILED",
                    );
                  }
                })();
              }}
              onDeclareAccount={async (accountId, platform) => {
                setError("");
                try {
                  await api(
                    `/social-accounts`,
                    jsonInit("POST", { accountId, platform }),
                  );
                  invalidateTabs("accounts", "fb-poster");
                  if (activeTabRef.current === "accounts") {
                    await loadTab("accounts", { force: true });
                  }
                  setNotice(`Đã khai báo tài khoản mới ${platform} (${accountId}).`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "DECLARE_ACCOUNT_FAILED",
                  );
                }
              }}
              onToggleKillSwitch={async (active, reason) => {
                setError("");
                try {
                  await api(
                    `/ops/kill-switch`,
                    jsonInit("POST", { active, ...(reason ? { reason } : {}) }),
                  );
                  invalidateTabs("accounts", "fb-poster", "calendar", "campaigns", "home");
                  if (activeTabRef.current === "accounts") {
                    await loadTab("accounts", { force: true });
                  }
                  setNotice(
                    active
                      ? "Đã kích hoạt Công tắc Dừng Khẩn cấp Toàn hệ thống!"
                      : "Đã khôi phục hoạt động toàn hệ thống.",
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "KILL_SWITCH_FAILED",
                  );
                }
              }}
              onResetCircuit={async (accountId, platform) => {
                setError("");
                try {
                  await api(
                    `/social-accounts/${encodeURIComponent(accountId)}/reset-circuit`,
                    jsonInit("POST", { platform }),
                  );
                  invalidateTabs("accounts", "fb-poster");
                  if (activeTabRef.current === "accounts") {
                    await loadTab("accounts", { force: true });
                  }
                  setNotice(
                    `Đã khôi phục Circuit Breaker cho tài khoản ${platform} (${accountId}).`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "RESET_CIRCUIT_FAILED",
                  );
                }
              }}
            />
          )}
          {tab === "calendar" && (
            <CalendarView
              data={calendarData}
              onApprovePost={(contentId) => {
                void (async () => {
                  setError("");
                  try {
                    await api(
                      `/publishing-calendar/${encodeURIComponent(contentId)}/approve`,
                      jsonInit("POST", {}),
                    );
                    invalidateTabs("calendar", "fb-poster");
                    if (activeTabRef.current === "calendar") {
                      await loadTab("calendar", { force: true });
                    }
                    setNotice(`Đã ghi nhận duyệt bài ${contentId}.`);
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "APPROVE_POST_FAILED",
                    );
                  }
                })();
              }}
              onSchedulePost={async (input) => {
                setError("");
                try {
                  await api(`/publishing-calendar`, jsonInit("POST", input));
                  invalidateTabs("calendar", "fb-poster", "home");
                  if (activeTabRef.current === "calendar") {
                    await loadTab("calendar", { force: true });
                  }
                  setNotice(`Đã lên lịch thành công bài viết ${input.contentId}!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "SCHEDULE_POST_FAILED",
                  );
                }
              }}
              onImportGoogleDocsText={async (rawText) => {
                setError("");
                try {
                  const res = await api<{ importedCount?: number }>(
                    `/contents/import-text`,
                    jsonInit("POST", { rawText }),
                  );
                  invalidateTabs("calendar", "fb-poster");
                  if (activeTabRef.current === "calendar") {
                    await loadTab("calendar", { force: true });
                  }
                  setNotice(
                    `Đã nhập ${res.importedCount ?? 1} bài viết từ Google Docs vào Thư viện!`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "IMPORT_GOOGLE_DOCS_FAILED",
                  );
                }
              }}
              onMatchMedia={async (postId) => {
                setError("");
                try {
                  const res = await api<{ matched?: unknown[] }>(
                    `/contents/${encodeURIComponent(postId)}/match-media`,
                    jsonInit("POST", {}),
                  );
                  invalidateTabs("calendar", "fb-poster");
                  if (activeTabRef.current === "calendar") {
                    await loadTab("calendar", { force: true });
                  }
                  setNotice(
                    `Đã ghép tự động ${res.matched?.length ?? 0} hình ảnh từ Google Drive!`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "MATCH_MEDIA_FAILED",
                  );
                }
              }}
              onValidateContent={async (postId) => {
                setError("");
                try {
                  const res = await api<{ valid?: boolean; errors?: string[] }>(
                    `/contents/${encodeURIComponent(postId)}/validate`,
                    jsonInit("POST", {}),
                  );
                  if (res.valid) {
                    setNotice(`Bài viết hợp lệ, sẵn sàng xuất bản!`);
                  } else {
                    setError(
                      `Bài viết chưa đạt chuẩn: ${(res.errors ?? []).join(", ")}`,
                    );
                  }
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "VALIDATE_CONTENT_FAILED",
                  );
                }
              }}
              onConfirmAssistedJob={async (jobId) => {
                setError("");
                try {
                  await api(
                    `/publishing/jobs/${encodeURIComponent(jobId)}/confirm-assisted`,
                    jsonInit("POST", {}),
                  );
                  invalidateTabs("calendar", "fb-poster", "home");
                  if (activeTabRef.current === "calendar") {
                    await loadTab("calendar", { force: true });
                  }
                  setNotice(`Đã xác nhận xuất bản thành công bài viết (${jobId})!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "CONFIRM_ASSISTED_JOB_FAILED",
                  );
                }
              }}
            />
          )}
          {tab === "fb-poster" && (
            <FacebookAutoPosterView
              accounts={
                (fbPosterData?.accounts ??
                  (data && typeof data === "object" && "accounts" in data
                    ? (data as any).accounts
                    : [])) ||
                []
              }
              posts={
                (fbPosterData?.posts ??
                  (data && typeof data === "object" && "posts" in data
                    ? (data as any).posts
                    : [])) ||
                []
              }
              groups={
                (fbPosterData?.groups ??
                  (data && typeof data === "object" && "groups" in data
                    ? (data as any).groups
                    : [])) ||
                []
              }
              logs={
                (fbPosterData?.logs ??
                  (data && typeof data === "object" && "logs" in data
                    ? (data as any).logs
                    : [])) ||
                []
              }
              libraryPosts={
                (fbPosterData?.libraryPosts ??
                  (data && typeof data === "object" && "libraryPosts" in data
                    ? (data as any).libraryPosts
                    : [])) ||
                []
              }
              onDispatchPost={async ({ accountId, postId, groupIds, delaySeconds }) => {
                setError("");
                try {
                  const currentPosts =
                    fbPosterData?.posts ??
                    (data && typeof data === "object" && "posts" in data
                      ? (data as any).posts
                      : []);
                  const targetPost = currentPosts?.find(
                    (p: any) => p.id === postId,
                  );
                  const content =
                    (targetPost?.content && targetPost.content.trim()) ||
                    (targetPost?.body && targetPost.body.trim()) ||
                    (targetPost?.title && targetPost.title.trim()) ||
                    "Nội dung bài viết giải pháp số Viettel SME";
                  await api(
                    `/fb-poster/dispatch-post`,
                    jsonInit("POST", {
                      accountId,
                      postId,
                      postTitle: targetPost?.title ?? postId,
                      content,
                      groupIds,
                      delaySeconds: delaySeconds ?? 60,
                    }),
                  );
                  invalidateTabs("fb-poster", "calendar", "campaigns", "home");
                  if (activeTabRef.current === "fb-poster") {
                    await loadTab("fb-poster", { force: true });
                  }
                  setNotice(
                    `Đã xếp hàng ${groupIds.length} bài vào Hàng đợi (QUEUED)! Hãy bấm [Chạy đăng bài] hoặc [🚀 Chạy toàn bộ hàng đợi] ở bảng bên dưới để Playwright đăng lên Facebook và nhận Link minh chứng.`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "DISPATCH_FB_POST_FAILED",
                  );
                }
              }}
              onDispatchPagePost={async ({ accountId, postId, targetType, targetUrl, callToActionUrl }) => {
                setError("");
                try {
                  const currentPosts =
                    fbPosterData?.posts ??
                    (data && typeof data === "object" && "posts" in data
                      ? (data as any).posts
                      : []);
                  const targetPost = currentPosts?.find(
                    (p: any) => p.id === postId,
                  );
                  const content =
                    (targetPost?.content && targetPost.content.trim()) ||
                    (targetPost?.body && targetPost.body.trim()) ||
                    (targetPost?.title && targetPost.title.trim()) ||
                    "Nội dung bài viết giải pháp số Viettel SME";
                  await api(
                    `/fb-poster/dispatch-page-post`,
                    jsonInit("POST", {
                      accountId,
                      postId,
                      postTitle: targetPost?.title ?? postId,
                      content,
                      targetType,
                      ...(targetUrl ? { targetUrl } : {}),
                      ...(callToActionUrl ? { callToActionUrl } : {}),
                      ...(targetPost?.mediaPaths ? { mediaPaths: targetPost.mediaPaths } : {}),
                    }),
                  );
                  invalidateTabs("fb-poster", "calendar", "campaigns", "home");
                  if (activeTabRef.current === "fb-poster") {
                    await loadTab("fb-poster", { force: true });
                  }
                  setNotice(
                    `Đã tạo lệnh phát sóng bài viết lên ${targetType === "FANPAGE" ? "Fanpage" : "Trang cá nhân"}! Hãy bấm [Chạy đăng bài] ở bảng bên dưới để hoàn tất và nhận Link minh chứng.`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "DISPATCH_PAGE_POST_FAILED",
                  );
                }
              }}
              onRunJob={async (jobId) => {
                setError("");
                try {
                  const res = await api<{ status?: string; postUrl?: string }>(
                    `/campaigns/group-jobs/${encodeURIComponent(jobId)}/run`,
                    jsonInit("POST", {}),
                  );
                  invalidateTabs("fb-poster", "calendar", "campaigns", "home");
                  if (activeTabRef.current === "fb-poster") {
                    await loadTab("fb-poster", { force: true });
                  }
                  setNotice(
                    `🎉 Đã xuất bản thành công (${res.status})! Link minh chứng: ${res.postUrl ?? "Đã cập nhật trong bảng"}`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "RUN_FB_JOB_FAILED",
                  );
                }
              }}
              onCreatePost={async ({ title, content, mediaPaths }) => {
                setError("");
                try {
                  await api(
                    `/contents`,
                    jsonInit("POST", {
                      title,
                      content,
                      topic: "CHU_KY_SO",
                      platforms: ["FACEBOOK"],
                      mediaPaths: mediaPaths ?? [],
                    }),
                  );
                  invalidateTabs("fb-poster", "calendar");
                  if (activeTabRef.current === "fb-poster") {
                    await loadTab("fb-poster", { force: true });
                  }
                  setNotice(`Đã thêm bài viết mới vào Master Posts thành công!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "CREATE_POST_FAILED",
                  );
                }
              }}
          onDeleteGroup={async (groupId) => {
            setError("");
            try {
              await api(`/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
              invalidateTabs("fb-poster", "campaigns");
              if (activeTabRef.current === "fb-poster") {
                await loadTab("fb-poster", { force: true });
              }
              setNotice("Đã xoá nhóm khỏi danh sách mục tiêu.");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "DELETE_GROUP_FAILED");
            }
          }}
          onBulkImportGroups={async (urls) => {
            setError("");
            try {
              const res = await api<{ added: number; existing: number }>(
                `/groups/bulk-import`,
                jsonInit("POST", { urls, platform: "FACEBOOK" }),
              );
              invalidateTabs("fb-poster", "campaigns");
              if (activeTabRef.current === "fb-poster") {
                await loadTab("fb-poster", { force: true });
              }
              setNotice(
                `Đã import thành công ${res.added} nhóm mới (${res.existing} nhóm đã tồn tại).`,
              );
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "BULK_IMPORT_GROUPS_FAILED",
              );
            }
          }}
          onSyncAccounts={async () => {
            setError("");
            try {
              const res = await api<any>(`/fb-poster/sync-accounts`, jsonInit("POST", {}));
              invalidateTabs("fb-poster", "accounts");
              if (activeTabRef.current === "fb-poster") {
                await loadTab("fb-poster", { force: true });
              }
              const count = res?.accounts?.length ?? 0;
              setNotice(`Đã quét và đồng bộ ${count} tài khoản Facebook thành công!`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "SYNC_ACCOUNTS_FAILED");
            }
          }}
          onLaunchBrowser={async (accountId) => {
            setError("");
            try {
              await api(`/social-accounts/launch-browser`, jsonInit("POST", { accountId, platform: "FACEBOOK" }));
              setNotice(`Đang mở Google Chrome cho tài khoản [${accountId}]. Hãy hoàn tất đăng nhập trên màn hình.`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "LAUNCH_BROWSER_FAILED");
            }
          }}
          onAddAccount={async (accountName) => {
            setError("");
            try {
              await api(`/social-accounts/declare-and-launch`, jsonInit("POST", { accountName, platform: "FACEBOOK" }));
              invalidateTabs("fb-poster", "accounts");
              if (activeTabRef.current === "fb-poster") {
                await loadTab("fb-poster", { force: true });
              }
              setNotice(`Đã tạo hồ sơ cho [${accountName}] và mở Google Chrome đăng nhập.`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "ADD_ACCOUNT_FAILED");
            }
          }}
          onVerifyAccount={async (accountId) => {
            setError("");
            try {
              const res = await api<{ status: string; reason: string }>(
                `/social-accounts/${encodeURIComponent(accountId)}/verify-session`,
                jsonInit("POST", {}),
              );
              invalidateTabs("fb-poster", "accounts");
              if (activeTabRef.current === "fb-poster") {
                await loadTab("fb-poster", { force: true });
              }
              if (res.status === "CONNECTED") {
                setNotice(`🟢 Tài khoản [${accountId}] đã xác minh: Đã đăng nhập và sẵn sàng tác nghiệp!`);
              } else if (res.status === "CHECKPOINT_2FA") {
                setError(`🔴 Tài khoản [${accountId}] đang yêu cầu xác minh bảo mật (2FA / Checkpoint)!`);
              } else {
                setError(`🟡 Tài khoản [${accountId}] chưa đăng nhập Facebook: ${res.reason}`);
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "VERIFY_ACCOUNT_FAILED");
            }
          }}
            />
          )}
          {tab === "campaigns" && (
            <CampaignView
              data={campaignsData}
              onApproveCampaign={async (campaignId) => {
                setError("");
                try {
                  await api(
                    `/campaigns/${encodeURIComponent(campaignId)}/approve`,
                    jsonInit("POST", {}),
                  );
                  invalidateTabs("campaigns", "fb-poster");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã phê duyệt chiến dịch ${campaignId}.`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "APPROVE_CAMPAIGN_FAILED",
                  );
                }
              }}
              onDispatchCampaign={async (campaignId, options) => {
                setError("");
                try {
                  const res = await api<{ jobs?: unknown[]; skippedGroups?: unknown[] }>(
                    `/campaigns/${encodeURIComponent(campaignId)}/dispatch`,
                    jsonInit("POST", {
                      accountId: options?.accountId ?? "fb-viettel-sme",
                      groupIds: options?.groupIds,
                    }),
                  );
                  invalidateTabs("campaigns", "fb-poster", "calendar", "home");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(
                    `Đã điều phối chiến dịch ${campaignId}: ${res.jobs?.length ?? 0} nhóm hợp lệ, ${res.skippedGroups?.length ?? 0} nhóm bỏ qua.`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "DISPATCH_CAMPAIGN_FAILED",
                  );
                }
              }}
              onRunGroupJob={async (jobId) => {
                setError("");
                try {
                  const res = await api<{ status?: string; postUrl?: string }>(
                    `/campaigns/group-jobs/${encodeURIComponent(jobId)}/run`,
                    jsonInit("POST", {}),
                  );
                  invalidateTabs("campaigns", "fb-poster", "calendar", "home");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(
                    `Đã thực thi đăng bài (${res.status}): ${res.postUrl ?? "Đang xử lý"}`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "RUN_GROUP_JOB_FAILED",
                  );
                }
              }}
              onBulkImportGroups={async (urls) => {
                setError("");
                try {
                  const res = await api<{ added: number; existing: number }>(
                    `/groups/bulk-import`,
                    jsonInit("POST", { urls, platform: "FACEBOOK" }),
                  );
                  invalidateTabs("campaigns", "fb-poster");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(
                    `Đã nhập hàng loạt nhóm Facebook: ${res.added} nhóm mới, ${res.existing} nhóm đã tồn tại.`,
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "BULK_IMPORT_GROUPS_FAILED",
                  );
                }
              }}
              onRegisterGroup={async (input) => {
                setError("");
                try {
                  await api(`/groups`, jsonInit("POST", input));
                  invalidateTabs("campaigns", "fb-poster");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã thêm hội nhóm ${input.name} (${input.groupId})!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "REGISTER_GROUP_FAILED",
                  );
                }
              }}
              onRecordReferral={async (input) => {
                setError("");
                try {
                  await api(
                    `/partners/${encodeURIComponent(input.partnerId)}/referrals`,
                    jsonInit("POST", {
                      referralId: input.referralId,
                      companyName: input.companyName,
                      taxCode: input.taxCode,
                      productCodes: input.productCodes,
                    }),
                  );
                  invalidateTabs("campaigns");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã ghi nhận giới thiệu SME ${input.companyName} (${input.taxCode})!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "RECORD_REFERRAL_FAILED",
                  );
                }
              }}
              onRecordConversion={async (input) => {
                setError("");
                try {
                  await api(
                    `/partners/conversions`,
                    jsonInit("POST", {
                      ...input,
                      commissionPolicyConfirmedByAmId: principal?.userId ?? "user-am",
                    }),
                  );
                  invalidateTabs("campaigns", "home");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã chốt hợp đồng thành công cho referral ${input.referralId}! Hoa hồng đã được chuyển sang danh sách chờ chi trả.`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "RECORD_CONVERSION_FAILED",
                  );
                }
              }}
              onMarkConversionPaid={async (conversionId, payoutReference) => {
                setError("");
                try {
                  await api(
                    `/partners/conversions/${encodeURIComponent(conversionId)}/payout`,
                    jsonInit("POST", { payoutReference }),
                  );
                  invalidateTabs("campaigns");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã xác nhận chi trả hoa hồng (${payoutReference})!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "PAYOUT_CONVERSION_FAILED",
                  );
                }
              }}
              onCreateCampaign={async (input) => {
                setError("");
                try {
                  await api(`/campaigns`, jsonInit("POST", input));
                  invalidateTabs("campaigns", "fb-poster");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã tạo mới chiến dịch ${input.campaignId}!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "CREATE_CAMPAIGN_FAILED",
                  );
                }
              }}
              onRegisterPartner={async (input) => {
                setError("");
                try {
                  await api(`/partners`, jsonInit("POST", input));
                  invalidateTabs("campaigns");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã đăng ký CTV ${input.fullName} (${input.partnerId})!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "REGISTER_PARTNER_FAILED",
                  );
                }
              }}
              onTransitionPartnerStage={async (partnerId, newStage) => {
                setError("");
                try {
                  await api(
                    `/partners/${encodeURIComponent(partnerId)}/stage`,
                    jsonInit("POST", { newStage }),
                  );
                  invalidateTabs("campaigns");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã chuyển giai đoạn CTV ${partnerId} sang ${newStage}.`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "TRANSITION_PARTNER_STAGE_FAILED",
                  );
                }
              }}
              onCreateOutreachBatch={async (input) => {
                setError("");
                try {
                  const res = await api<any>(`/outreach/batches`, jsonInit("POST", input));
                  setActiveOutreachBatch(res);
                  invalidateTabs("campaigns", "leads");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã khởi tạo đợt tiếp cận Zalo "${input.batchName}" (${input.leadIds.length} khách hàng)!`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "CREATE_OUTREACH_BATCH_FAILED",
                  );
                }
              }}
              onRunNextOutreachTask={async (batchId) => {
                setError("");
                try {
                  const res = await api<any>(`/outreach/batches/${encodeURIComponent(batchId)}/run-next`, jsonInit("POST", {}));
                  setActiveOutreachBatch(res.batch);
                  invalidateTabs("campaigns", "leads");
                  if (activeTabRef.current === "campaigns") {
                    await loadTab("campaigns", { force: true });
                  }
                  setNotice(`Đã xử lý: Khách hàng ${res.leadId} -> Trạng thái: ${res.result?.status ?? "Xong"}`);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "RUN_OUTREACH_TASK_FAILED",
                  );
                }
              }}
            />
          )}
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
              <AuditView data={auditData ?? data} />
            </section>
          )}
        </main>
      </div>
      <footer className="footer">
        Chỉ dùng local/staging với dữ liệu tổng hợp hoặc được phê duyệt. Preview
        import mất khi tiến trình dừng.
      </footer>
      <UIHealthInspector
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        activeTab={tab}
      />
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
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState("ALL");

  if (!result) return <p className="empty">Đang tải hoặc chưa có lead.</p>;
  if (!result.items?.length)
    return <p className="empty">Chưa có lead trong phạm vi được cấp.</p>;

  const filteredItems = result.items.filter((lead) => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchesName = lead.companyName?.toLowerCase().includes(term);
      const matchesDistrict = lead.district?.toLowerCase().includes(term);
      const matchesIndustry = lead.industry?.toLowerCase().includes(term);
      if (!matchesName && !matchesDistrict && !matchesIndustry) return false;
    }
    if (tierFilter !== "ALL") {
      if (!lead.leadScore || lead.leadScore.tier !== tierFilter) return false;
    }
    return true;
  });

  return (
    <>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="🔍 Tìm theo tên doanh nghiệp, quận huyện..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ flex: "1 1 200px", padding: "6px 10px", fontSize: "13px", borderRadius: "6px" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", margin: 0 }}>
          <span>Lọc theo Tier:</span>
          <select
            aria-label="Lọc theo Tier"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            style={{ padding: "6px 10px", fontSize: "13px", borderRadius: "6px" }}
          >
            <option value="ALL">Tất cả Tier</option>
            <option value="A">Tier A (Tiềm năng cao)</option>
            <option value="B">Tier B (Tiềm năng)</option>
            <option value="C">Tier C (Trung bình)</option>
            <option value="D">Tier D</option>
          </select>
        </label>
      </div>
      <p className="muted" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Hiển thị {filteredItems.length} / {result.total ?? result.items.length} lead</span>
        {searchTerm && <span style={{ color: "#0284c7" }}>Đang lọc: "{searchTerm}"</span>}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Doanh nghiệp</th>
              <th>Đánh giá AI</th>
              <th>Giai đoạn</th>
              <th>Địa bàn</th>
              <th>Liên hệ (đã che)</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((lead) => (
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
                  {lead.leadScore ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#fff",
                          width: "fit-content",
                          background:
                            lead.leadScore.tier === "A"
                              ? "#16a34a"
                              : lead.leadScore.tier === "B"
                              ? "#2563eb"
                              : lead.leadScore.tier === "C"
                              ? "#d97706"
                              : "#6b7280",
                        }}
                      >
                        Tier {lead.leadScore.tier} · {lead.leadScore.totalScore}đ
                      </span>
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
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
  const [quickOutreachBusy, setQuickOutreachBusy] = useState(false);
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
    classification?: {
      segment: string;
      recommendedServices: string[];
      screeningQuestions: string[];
      suggestedCta: string;
      suggestionStatus: string;
    };
    productMatches?: readonly {
      serviceId: string;
      serviceName: string;
      bundleAvailable: boolean;
      bundleName?: string;
      painPointsAddressed: string[];
      policyStatus: string;
      requiredConfirmations: string[];
    }[];
    leadScore?: {
      totalScore: number;
      tier: "A" | "B" | "C" | "D";
      recommendedProducts: string[];
      tierExplanation: string;
      industryScore: number;
      establishmentScore: number;
      scaleScore: number;
      productDemandScore: number;
      contactInfoScore: number;
      businessSignalScore: number;
    };
  } | null;

  async function triggerQuickOutreach() {
    if (!lead || !lead.id || quickOutreachBusy) return;
    setQuickOutreachBusy(true);
    try {
      await api(
        "/outreach/batches",
        jsonInit("POST", {
          batchName: `Tiếp cận Zalo: ${lead.companyName}`,
          leadIds: [lead.id],
          templateCode:
            lead.classification?.segment === "ACCOUNTING"
              ? "ZALO_ACCOUNTING_PARTNER_V1"
              : "ZALO_DNMTL_INTRO_V1",
          action: "ADD_FRIEND_AND_SEND_MESSAGE",
          accountId: "zalo-dian-am01",
        }),
      );
      onNotice(
        `Đã tạo đợt tiếp cận Zalo cho ${lead.companyName}! Chuyển sang tab "Chiến dịch & CTV" để theo dõi.`,
      );
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : "Không thể khởi tạo tiếp cận Zalo.",
      );
    } finally {
      setQuickOutreachBusy(false);
    }
  }
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

      {lead.leadScore && (
        <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "15px", color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🎯 AI Lead Scoring (Thang điểm 100)</span>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#fff",
                    background:
                      lead.leadScore.tier === "A"
                        ? "#16a34a"
                        : lead.leadScore.tier === "B"
                        ? "#2563eb"
                        : lead.leadScore.tier === "C"
                        ? "#d97706"
                        : "#6b7280",
                  }}
                >
                  Tier {lead.leadScore.tier} — {lead.leadScore.totalScore}/100 điểm
                </span>
              </h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                {lead.leadScore.tierExplanation}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a" }}>
                {lead.leadScore.totalScore}
              </span>
              <span style={{ fontSize: "13px", color: "#94a3b8" }}>/100</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "12px" }}>
            <div style={{ background: "#ffffff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Ngành nghề phù hợp</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{lead.leadScore.industryScore} <span style={{ fontSize: "11px", fontWeight: 400, color: "#94a3b8" }}>/20đ</span></div>
            </div>
            <div style={{ background: "#ffffff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Thời gian thành lập</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{lead.leadScore.establishmentScore} <span style={{ fontSize: "11px", fontWeight: 400, color: "#94a3b8" }}>/15đ</span></div>
            </div>
            <div style={{ background: "#ffffff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Quy mô doanh nghiệp</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{lead.leadScore.scaleScore} <span style={{ fontSize: "11px", fontWeight: 400, color: "#94a3b8" }}>/15đ</span></div>
            </div>
            <div style={{ background: "#ffffff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Nhu cầu SP dự kiến</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{lead.leadScore.productDemandScore} <span style={{ fontSize: "11px", fontWeight: 400, color: "#94a3b8" }}>/25đ</span></div>
            </div>
            <div style={{ background: "#ffffff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Thông tin liên hệ</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{lead.leadScore.contactInfoScore} <span style={{ fontSize: "11px", fontWeight: 400, color: "#94a3b8" }}>/15đ</span></div>
            </div>
            <div style={{ background: "#ffffff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Tín hiệu kinh doanh</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{lead.leadScore.businessSignalScore} <span style={{ fontSize: "11px", fontWeight: 400, color: "#94a3b8" }}>/10đ</span></div>
            </div>
          </div>

          <div style={{ fontSize: "11px", color: "#64748b", fontStyle: "italic", background: "#f1f5f9", padding: "6px 10px", borderRadius: "4px" }}>
            💡 Nguyên tắc tính điểm: Thuộc tính thiếu hoặc chưa xác minh nhận 0 điểm, không tự suy diễn cộng điểm.
          </div>
        </div>
      )}

      {lead.classification && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "14px", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 600, color: "#166534" }}>Phân loại khách hàng:</span>
              <span className="badge" style={{ background: "#15803d", color: "#fff", padding: "2px 8px", borderRadius: "4px", fontSize: "12px" }}>
                {lead.classification.segment}
              </span>
            </div>
            <button
              type="button"
              className="primary"
              disabled={quickOutreachBusy}
              onClick={triggerQuickOutreach}
              style={{ fontSize: "13px", padding: "6px 12px" }}
            >
              {quickOutreachBusy ? "Đang tạo..." : "Khởi tạo tiếp cận Zalo ngay"}
            </button>
          </div>
          <p style={{ margin: "4px 0", fontSize: "13px", color: "#374151" }}>
            <strong>Gợi ý tiếp cận (CTA):</strong> {lead.classification.suggestedCta}
          </p>
          {lead.classification.screeningQuestions.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#4b5563" }}>Câu hỏi gợi ý khi tư vấn:</span>
              <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: "12px", color: "#4b5563" }}>
                {lead.classification.screeningQuestions.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {lead.productMatches && lead.productMatches.length > 0 && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: "14px", color: "#1e293b" }}>
            Đề xuất giải pháp Viettel phù hợp ({lead.productMatches.length} dịch vụ):
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
            {lead.productMatches.map((prod) => (
              <div key={prod.serviceId} style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "10px" }}>
                <div style={{ fontWeight: 600, fontSize: "13px", color: "#0f172a" }}>{prod.serviceName}</div>
                {prod.bundleName && (
                  <span style={{ fontSize: "11px", color: "#0284c7", background: "#e0f2fe", padding: "2px 6px", borderRadius: "3px", display: "inline-block", marginTop: "4px" }}>
                    {prod.bundleName}
                  </span>
                )}
                {prod.painPointsAddressed.length > 0 && (
                  <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "11px", color: "#64748b" }}>
                    {prod.painPointsAddressed.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
  onSwitchToLeads,
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
  onSwitchToLeads?: () => void;
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
      <div
        className="template-download-box"
        style={{
          background: "var(--color-surface, #f8fafc)",
          padding: "12px 16px",
          borderRadius: "8px",
          border: "1px solid var(--color-border, #e2e8f0)",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div>
            <strong>Mẫu chuẩn hóa Doanh nghiệp Mới Thành Lập (DNMTL):</strong>
            <p className="muted" style={{ margin: "4px 0 0 0", fontSize: "13px" }}>
              File mẫu chuẩn hóa 5.003 doanh nghiệp Dĩ An / Bình Dương (tuân thủ Nghị định 13/2023/NĐ-CP đã lọc bỏ CMND/CCCD).
            </p>
          </div>
          <a
            href="/api/v1/import-template"
            download="DNMTL_T7_2026_Standard_Template.xlsx"
            className="secondary"
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            📥 Tải file mẫu (.xlsx - 5.003 DN)
          </a>
        </div>
      </div>
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
            <div
              style={{
                marginTop: "16px",
                padding: "16px 20px",
                borderRadius: "8px",
                border: "1px solid #86efac",
                backgroundColor: "#f0fdf4",
                color: "#166534",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: 700, color: "#15803d" }}>
                    🎉 Nhập dữ liệu Excel thành công!
                  </h3>
                  <p style={{ margin: 0, fontSize: "14px" }}>
                    Đã chuẩn bị &amp; nạp {state.summary?.rowsToKeep ?? (state.commitResult as any)?.count ?? "các"} lead mới vào cơ sở dữ liệu hệ thống.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      onSwitchToLeads?.();
                    }}
                  >
                    👉 Xem danh sách Lead ngay
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setState(null);
                      setFile(null);
                      setMapping({});
                      setDecisions({});
                    }}
                  >
                    Tải file khác
                  </button>
                </div>
              </div>
            </div>
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
  onSwitchTab,
}: {
  data: unknown;
  onComplete: (id: string) => void;
  onDefer: (id: string) => void;
  onOpenPlanner: () => void;
  onSwitchTab?: (tab: Tab) => void;
}) {
  const tasks = data as readonly TaskCard[] | null;
  const today = hcmToday();
  const dueToday = tasks ? tasks.filter((task) => hcmDate(task.dueAt) === today) : [];
  const overdue = tasks
    ? tasks.filter((task) => {
        const date = hcmDate(task.dueAt);
        return date !== "" && date < today;
      })
    : [];

  return (
    <section className="panel-grid">
      <div className="panel" style={{ gridColumn: "1 / -1", padding: "16px 20px" }}>
        <div className="panel-heading" style={{ marginBottom: "12px" }}>
          <h2 style={{ fontSize: "16px", margin: 0 }}>📊 Tổng quan hoạt động hôm nay</h2>
          <span className="muted">Hệ thống Tự động hóa SME Viettel</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Tác vụ cần làm</span>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
              {dueToday.length} việc hôm nay
            </div>
            <span style={{ fontSize: "12px", color: overdue.length > 0 ? "#dc2626" : "#059669" }}>
              {overdue.length > 0 ? `⚠️ ${overdue.length} việc quá hạn` : "✓ Không có việc quá hạn"}
            </span>
          </div>
          <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Phễu SME &amp; Lead</span>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#0284c7", marginTop: "4px" }}>
              Tiếp cận &amp; Chăm sóc
            </div>
            <button
              type="button"
              className="text-button"
              style={{ fontSize: "12px", color: "#0284c7", padding: 0 }}
              onClick={() => onSwitchTab?.("leads")}
            >
              👉 Đến danh sách Lead
            </button>
          </div>
          <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Tự động hoá MXH</span>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#059669", marginTop: "4px" }}>
              Facebook &amp; Zalo
            </div>
            <button
              type="button"
              className="text-button"
              style={{ fontSize: "12px", color: "#059669", padding: 0 }}
              onClick={() => onSwitchTab?.("fb-poster")}
            >
              👉 Mở Auto Poster
            </button>
          </div>
          <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Cơ chế An toàn</span>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#16a34a", marginTop: "4px" }}>
              🛡️ Sẵn sàng
            </div>
            <button
              type="button"
              className="text-button"
              style={{ fontSize: "12px", color: "#64748b", padding: 0 }}
              onClick={() => onSwitchTab?.("accounts")}
            >
              Kiểm tra Kill Switch &amp; Phiên
            </button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ minHeight: tasks ? undefined : 200 }}>
        <div className="panel-heading">
          <h2>Đến hạn hôm nay · {today}</h2>
          <span className="muted">{tasks ? `${dueToday.length} task` : "Đang tải…"}</span>
        </div>
        {tasks ? (
          <TaskList
            data={dueToday}
            onComplete={onComplete}
            onDefer={onDefer}
            emptyMessage="Không có task đến hạn hôm nay."
          />
        ) : (
          <p className="empty">Đang tải tác vụ trong phạm vi được cấp.</p>
        )}
      </div>

      <div className="panel" style={{ minHeight: tasks ? undefined : 200 }}>
        <div className="panel-heading">
          <h2>Quá hạn</h2>
          <span className="muted">{tasks ? `${overdue.length} task` : "Đang tải…"}</span>
        </div>
        {tasks ? (
          <TaskList
            data={overdue}
            onComplete={onComplete}
            onDefer={onDefer}
            emptyMessage="Không có task quá hạn."
          />
        ) : (
          <p className="empty">Đang kiểm tra…</p>
        )}
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
