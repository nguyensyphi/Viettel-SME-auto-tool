"use client";

import { useState, useMemo, useEffect } from "react";

export interface MasterPostItem {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly mediaPaths?: readonly string[] | undefined;
  readonly createdAt?: string | undefined;
}

export interface MasterGroupItem {
  readonly groupId: string;
  readonly name: string;
  readonly url: string;
  readonly platform: "FACEBOOK" | "ZALO";
  readonly category?: string | undefined;
  readonly postingPermission?: string | undefined;
  readonly minHoursBetweenPosts?: number | undefined;
}

export interface PostingLogItem {
  readonly jobId: string;
  readonly campaignId?: string | undefined;
  readonly groupName: string;
  readonly groupUrl: string;
  readonly accountId: string;
  readonly content: string;
  readonly status: "QUEUED" | "RUNNING" | "PUBLISHED" | "PENDING_APPROVAL" | "FAILED";
  readonly postUrl?: string | undefined;
  readonly screenshotProofUrl?: string | undefined;
  readonly error?: string | undefined;
  readonly dispatchedAt: string;
  readonly executedAt?: string | undefined;
}

export interface FacebookAccountItem {
  readonly accountId: string;
  readonly displayName?: string | undefined;
  readonly platform: "FACEBOOK" | "ZALO";
  readonly status: string;
}

export interface FacebookAutoPosterViewProps {
  readonly accounts: readonly FacebookAccountItem[];
  readonly posts: readonly MasterPostItem[];
  readonly groups: readonly MasterGroupItem[];
  readonly logs: readonly PostingLogItem[];
  readonly libraryPosts?: readonly MasterPostItem[] | undefined;
  readonly onDispatchPost?:
    | ((input: { accountId: string; postId: string; groupIds: string[]; delaySeconds?: number }) => Promise<void>)
    | undefined;
  readonly onDispatchPagePost?:
    | ((input: {
        accountId: string;
        postId: string;
        targetType: "PERSONAL_WALL" | "FANPAGE";
        targetUrl?: string;
        callToActionUrl?: string;
      }) => Promise<void>)
    | undefined;
  readonly onRunJob?: ((jobId: string) => Promise<void>) | undefined;
  readonly onCreatePost?: ((input: { title: string; content: string; mediaPaths?: string[] }) => Promise<void>) | undefined;
  readonly onBulkImportGroups?: ((urls: string[]) => Promise<void>) | undefined;
  readonly onDeleteGroup?: ((groupId: string) => Promise<void>) | undefined;
  readonly onSyncAccounts?: (() => Promise<void>) | undefined;
  readonly onLaunchBrowser?: ((accountId: string) => Promise<void>) | undefined;
  readonly onAddAccount?: ((accountName: string) => Promise<void>) | undefined;
}

function resolveSpinTaxPreview(template: string, variables: Record<string, string> = {}): string {
  let result = template;
  for (const [key, val] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\[${key}\\]`, "g"), val);
  }
  const spinRegex = /\{([^{}]+)\}/;
  let match = spinRegex.exec(result);
  let max = 50;
  while (match && max > 0) {
    const choices = match[1]!.split("|");
    const chosen = choices[Math.floor(Math.random() * choices.length)] ?? "";
    result = result.replace(match[0], chosen);
    match = spinRegex.exec(result);
    max--;
  }
  return result;
}

const STOCK_VIETTEL_BANNERS = [
  {
    name: "Viettel-CA",
    url: "https://images.unsplash.com/photo-1450133064473-71024230f91b?w=600&auto=format&fit=crop&q=80",
    label: "🏷️ Viettel-CA (Ký số)",
  },
  {
    name: "S-Invoice",
    url: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&auto=format&fit=crop&q=80",
    label: "🏷️ S-Invoice (Hóa đơn)",
  },
  {
    name: "vContract",
    url: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&auto=format&fit=crop&q=80",
    label: "🏷️ vContract (Hợp đồng)",
  },
  {
    name: "FTTH",
    url: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=600&auto=format&fit=crop&q=80",
    label: "🏷️ FTTH Doanh nghiệp",
  },
];

export function FacebookAutoPosterView({
  accounts = [],
  posts = [],
  groups = [],
  logs = [],
  libraryPosts = [],
  onDispatchPost,
  onDispatchPagePost,
  onRunJob,
  onCreatePost,
  onBulkImportGroups,
  onDeleteGroup,
  onSyncAccounts,
  onLaunchBrowser,
  onAddAccount,
}: FacebookAutoPosterViewProps) {
  // Dual-channel Sub-tab state: "GROUPS" vs "PAGES"
  const [activeSubTab, setActiveSubTab] = useState<"GROUPS" | "PAGES">("GROUPS");

  // Filter strictly Facebook-only accounts, groups and logs
  const facebookAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.platform === "FACEBOOK" ||
          (!a.accountId.toLowerCase().startsWith("zalo") && a.platform !== "ZALO"),
      ),
    [accounts],
  );

  const facebookGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          g.platform === "FACEBOOK" ||
          (!g.url.includes("zalo.me") && g.platform !== "ZALO"),
      ),
    [groups],
  );

  const facebookLogs = useMemo(
    () => logs.filter((l) => !l.groupUrl.includes("zalo.me")),
    [logs],
  );

  // Modal states
  const [dispatchPostId, setDispatchPostId] = useState<string | null>(null);
  const [dispatchDelaySeconds, setDispatchDelaySeconds] = useState<number>(60);
  const [spintaxPreview, setSpintaxPreview] = useState<string | null>(null);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [viewProofImage, setViewProofImage] = useState<string | null>(null);
  const [viewZoomImage, setViewZoomImage] = useState<string | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [isExecutingBatch, setIsExecutingBatch] = useState<boolean>(false);

  // Fanpage / Profile Dispatch states
  const [pageDispatchPostId, setPageDispatchPostId] = useState<string | null>(null);
  const [pageTargetType, setPageTargetType] = useState<"PERSONAL_WALL" | "FANPAGE">("PERSONAL_WALL");
  const [fanpageUrlInput, setFanpageUrlInput] = useState("");
  const [ctaUrlInput, setCtaUrlInput] = useState("https://viettel.vn/sme");

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    facebookAccounts[0]?.accountId || "fb-viettel-sme",
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    facebookGroups.map((g) => g.groupId),
  );

  // Synchronize selectedAccountId when accounts arrive
  useEffect(() => {
    if (facebookAccounts.length > 0) {
      if (!facebookAccounts.some((a) => a.accountId === selectedAccountId)) {
        setSelectedAccountId(facebookAccounts[0]!.accountId);
      }
    }
  }, [facebookAccounts, selectedAccountId]);

  // Form states for creating new post with attached images
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newMediaInput, setNewMediaInput] = useState("");
  const [newMediaList, setNewMediaList] = useState<string[]>([]);
  const [postFormError, setPostFormError] = useState<string | null>(null);
  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [isDeletingGroupId, setIsDeletingGroupId] = useState<string | null>(null);

  // Form states for bulk group import
  const [bulkUrls, setBulkUrls] = useState("");
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [isSubmittingDispatch, setIsSubmittingDispatch] = useState(false);
  const [isSubmittingPageDispatch, setIsSubmittingPageDispatch] = useState(false);

  // Account management states
  const [isSyncingAccounts, setIsSyncingAccounts] = useState(false);
  const [isLaunchingBrowser, setIsLaunchingBrowser] = useState(false);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  const currentAccount = useMemo(
    () => facebookAccounts.find((a) => a.accountId === selectedAccountId),
    [facebookAccounts, selectedAccountId],
  );

  const getAccountHealthBadge = (status: string | undefined) => {
    switch (status) {
      case "CHECKPOINT_2FA":
        return {
          icon: "🔴",
          text: "Dính Checkpoint 2FA",
          desc: "Tài khoản đang bị chặn xác minh danh tính hoặc yêu cầu 2FA. Bấm mở Chrome để vượt qua.",
          color: "#ef4444",
          bg: "#fef2f2",
          border: "#fecaca",
        };
      case "SESSION_EXPIRED":
        return {
          icon: "🟡",
          text: "Hết hạn phiên (Session Expired)",
          desc: "Cookie đăng nhập đã hết hạn. Vui lòng mở Chrome để đăng nhập lại.",
          color: "#d97706",
          bg: "#fffbeb",
          border: "#fde68a",
        };
      case "RATE_LIMITED_BLOCK":
        return {
          icon: "🟠",
          text: "Bị hạn chế tính năng",
          desc: "Tài khoản bị Facebook hạn chế đăng bài tạm thời. Hãy tạm dừng và dùng nick khác.",
          color: "#ea580c",
          bg: "#fff7ed",
          border: "#ffedd5",
        };
      case "WARMUP_NEW_NICK":
        return {
          icon: "🔵",
          text: "Nick mới đang ngâm (Warmup)",
          desc: "Tài khoản mới tạo, khuyến nghị đăng tối đa 2-3 nhóm/ngày với khoảng cách 180 giây.",
          color: "#2563eb",
          bg: "#eff6ff",
          border: "#bfdbfe",
        };
      default:
        return {
          icon: "🟢",
          text: "Hoạt động (ACTIVE_OK)",
          desc: "Phiên đăng nhập bình thường, sẵn sàng điều phối đăng bài tự động.",
          color: "#059669",
          bg: "#ecfdf5",
          border: "#a7f3d0",
        };
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setNewMediaList((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const handleAddMediaUrl = () => {
    const trimmed = newMediaInput.trim();
    if (!trimmed) return;
    setNewMediaList((prev) => [...prev, trimmed]);
    setNewMediaInput("");
  };

  const handleRemoveMedia = (index: number) => {
    setNewMediaList((prev) => prev.filter((_, idx) => idx !== index));
  };

  const publishedCount = facebookLogs.filter((l) => l.status === "PUBLISHED").length;
  const pendingCount = facebookLogs.filter((l) => l.status === "PENDING_APPROVAL").length;
  const queuedCount = facebookLogs.filter((l) => l.status === "QUEUED" || l.status === "RUNNING").length;

  const handleOpenDispatch = (postId: string) => {
    setDispatchPostId(postId);
    setSpintaxPreview(null);
    if (!selectedAccountId && facebookAccounts.length > 0) {
      setSelectedAccountId(facebookAccounts[0]!.accountId);
    }
    setSelectedGroupIds(facebookGroups.map((g) => g.groupId));
  };

  const handleConfirmDispatch = async () => {
    if (!dispatchPostId || !selectedAccountId || selectedGroupIds.length === 0) return;
    setIsSubmittingDispatch(true);
    try {
      await onDispatchPost?.({
        accountId: selectedAccountId,
        postId: dispatchPostId,
        groupIds: selectedGroupIds,
        delaySeconds: dispatchDelaySeconds,
      });
      setDispatchPostId(null);
    } finally {
      setIsSubmittingDispatch(false);
    }
  };

  const handleOpenPageDispatch = (postId: string) => {
    setPageDispatchPostId(postId);
    if (!selectedAccountId && facebookAccounts.length > 0) {
      setSelectedAccountId(facebookAccounts[0]!.accountId);
    }
  };

  const handleConfirmPageDispatch = async () => {
    if (!pageDispatchPostId || !selectedAccountId) return;
    setIsSubmittingPageDispatch(true);
    try {
      await onDispatchPagePost?.({
        accountId: selectedAccountId,
        postId: pageDispatchPostId,
        targetType: pageTargetType,
        ...(pageTargetType === "FANPAGE" && fanpageUrlInput.trim() ? { targetUrl: fanpageUrlInput.trim() } : {}),
        ...(ctaUrlInput.trim() ? { callToActionUrl: ctaUrlInput.trim() } : {}),
      });
      setPageDispatchPostId(null);
    } finally {
      setIsSubmittingPageDispatch(false);
    }
  };

  const accountHealth = getAccountHealthBadge(currentAccount?.status);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* 1. Header & Metrics Bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#0f172a" }}>
              Auto Poster Facebook
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748b" }}>
              Hệ thống tự động đăng bài chuyên nghiệp: Hội nhóm Facebook &amp; Fanpage / Trang cá nhân qua Playwright Engine
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Tài khoản:</span>
            <select
              aria-label="Chọn tài khoản Facebook"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
                backgroundColor: "#f8fafc",
              }}
            >
              {facebookAccounts.length > 0 ? (
                facebookAccounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.status === "ACTIVE_OK" || a.status === "CONNECTED" ? "🟢" : a.status === "CHECKPOINT_2FA" ? "🔴" : "⚪"}{" "}
                    {a.displayName ? `${a.displayName} (${a.accountId})` : a.accountId}
                  </option>
                ))
              ) : (
                <option value="fb-viettel-sme">🟢 [FACEBOOK] fb-viettel-sme</option>
              )}
            </select>

            <button
              type="button"
              disabled={isLaunchingBrowser || !selectedAccountId}
              onClick={async () => {
                if (!selectedAccountId) return;
                setIsLaunchingBrowser(true);
                try {
                  await onLaunchBrowser?.(selectedAccountId);
                } finally {
                  setIsLaunchingBrowser(false);
                }
              }}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #0284c7",
                backgroundColor: "#f0f9ff",
                color: "#0284c7",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Mở Google Chrome thật với profile của tài khoản này để đăng nhập hoặc giải quyết Checkpoint"
            >
              🌐 {isLaunchingBrowser ? "Đang mở..." : "Mở trình duyệt đăng nhập"}
            </button>

            <button
              type="button"
              disabled={isSyncingAccounts}
              onClick={async () => {
                setIsSyncingAccounts(true);
                try {
                  await onSyncAccounts?.();
                } finally {
                  setIsSyncingAccounts(false);
                }
              }}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #059669",
                backgroundColor: "#ecfdf5",
                color: "#059669",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Quét và đồng bộ tài khoản có sẵn trong thư mục sessions"
            >
              🔄 {isSyncingAccounts ? "Đang quét..." : "Đồng bộ nick"}
            </button>

            <button
              type="button"
              onClick={() => setShowAddAccountModal(true)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #6366f1",
                backgroundColor: "#eef2ff",
                color: "#4f46e5",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ➕ Thêm nick mới
            </button>
          </div>
        </div>

        {/* Account Health Status Card */}
        <div
          style={{
            backgroundColor: accountHealth.bg,
            border: `1px solid ${accountHealth.border}`,
            borderRadius: 8,
            padding: "10px 16px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{accountHealth.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: accountHealth.color }}>
                Trạng thái tài khoản: {accountHealth.text}
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{accountHealth.desc}</div>
            </div>
          </div>
          {currentAccount?.status === "CHECKPOINT_2FA" && (
            <button
              type="button"
              onClick={() => selectedAccountId && onLaunchBrowser?.(selectedAccountId)}
              style={{
                backgroundColor: "#ef4444",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🛡️ Mở Chrome giải quyết Checkpoint ngay
            </button>
          )}
        </div>

        {/* Metric Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Tổng bài viết mẫu (Master Posts)</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>{posts.length}</div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Tổng nhóm mục tiêu (Master Groups)</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>{facebookGroups.length}</div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>Đã đăng thành công (Published)</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#059669", marginTop: 4 }}>{publishedCount}</div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "#d97706", fontWeight: 600 }}>Chờ kiểm duyệt / Đang chờ</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#d97706", marginTop: 4 }}>
              {pendingCount + queuedCount}
            </div>
          </div>
        </div>
      </div>

      {/* Dual-Channel Sub-Tabs Navigation */}
      <div
        role="tablist"
        style={{
          display: "flex",
          borderBottom: "2px solid #e2e8f0",
          gap: 16,
          backgroundColor: "#f8fafc",
          padding: "8px 16px 0",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "GROUPS"}
          onClick={() => setActiveSubTab("GROUPS")}
          style={{
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: activeSubTab === "GROUPS" ? "#0284c7" : "#64748b",
            borderBottom: activeSubTab === "GROUPS" ? "3px solid #0284c7" : "3px solid transparent",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          👥 Đăng Hội Nhóm Facebook (Group Auto Poster)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "PAGES"}
          onClick={() => setActiveSubTab("PAGES")}
          style={{
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: activeSubTab === "PAGES" ? "#0284c7" : "#64748b",
            borderBottom: activeSubTab === "PAGES" ? "3px solid #0284c7" : "3px solid transparent",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          📢 Đăng Fanpage &amp; Trang Cá Nhân (Profile &amp; Page Poster)
        </button>
      </div>

      {/* Sub-tab 1: GROUPS VIEW */}
      {activeSubTab === "GROUPS" && (
        <section className="panel-grid">
          {/* Left: Master Posts */}
          <div className="panel">
            <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2>Kho Bài Viết Mẫu (Master Posts)</h2>
                <span className="muted">Danh sách bài viết sẵn sàng phân phối</span>
              </div>
              {libraryPosts && libraryPosts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLibraryModal(true)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid #0284c7",
                    backgroundColor: "#f0f9ff",
                    color: "#0284c7",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  📥 Chọn từ Thư viện Google Docs
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tiêu đề / Nội dung</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ textAlign: "center", color: "#94a3b8", padding: 16 }}>
                        Chưa có bài viết mẫu. Hãy thêm bài viết bên dưới.
                      </td>
                    </tr>
                  ) : (
                    posts.map((p) => {
                      const hasImages = Array.isArray(p.mediaPaths) && p.mediaPaths.length > 0;
                      return (
                        <tr key={p.id}>
                          <td style={{ verticalAlign: "top" }}>
                            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                              {hasImages ? (
                                <div
                                  style={{ position: "relative", flexShrink: 0, cursor: "pointer" }}
                                  onClick={() => setViewZoomImage(p.mediaPaths![0]!)}
                                  title="Bấm để phóng to ảnh"
                                >
                                  <img
                                    src={p.mediaPaths![0]}
                                    alt={p.title}
                                    style={{
                                      width: 68,
                                      height: 68,
                                      objectFit: "cover",
                                      borderRadius: 6,
                                      border: "1px solid #cbd5e1",
                                      backgroundColor: "#f8fafc",
                                    }}
                                  />
                                  {p.mediaPaths!.length > 1 && (
                                    <span
                                      style={{
                                        position: "absolute",
                                        bottom: 2,
                                        right: 2,
                                        backgroundColor: "rgba(15, 23, 42, 0.8)",
                                        color: "#ffffff",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        padding: "1px 4px",
                                        borderRadius: 4,
                                      }}
                                    >
                                      +{p.mediaPaths!.length - 1}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div
                                  style={{
                                    width: 68,
                                    height: 68,
                                    backgroundColor: "#f1f5f9",
                                    borderRadius: 6,
                                    border: "1px dashed #cbd5e1",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "#94a3b8",
                                    fontSize: 10,
                                    flexShrink: 0,
                                  }}
                                >
                                  <span style={{ fontSize: 18 }}>🖼️</span>
                                  <span>Chưa có ảnh</span>
                                </div>
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <strong style={{ fontSize: 14, color: "#0f172a" }}>{p.title}</strong>
                                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#475569", lineHeight: 1.4 }}>
                                  {p.content.length > 110 ? `${p.content.slice(0, 110)}...` : p.content}
                                </p>
                                {hasImages && (
                                  <span style={{ fontSize: 11, color: "#0284c7", fontWeight: 600, display: "inline-block", marginTop: 4 }}>
                                    📸 {p.mediaPaths!.length} hình ảnh đính kèm
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                            <button
                              type="button"
                              className="primary"
                              style={{ fontSize: 12, padding: "6px 10px" }}
                              onClick={() => handleOpenDispatch(p.id)}
                            >
                              Đăng bài này lên nhóm
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Form thêm bài viết mới */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPostFormError(null);
                if (!newTitle.trim() || !newContent.trim()) {
                  setPostFormError("Vui lòng nhập đầy đủ tiêu đề và nội dung bài viết trước khi lưu.");
                  return;
                }
                setIsCreatingPost(true);
                const allMedia = [...newMediaList];
                if (newMediaInput.trim() && !allMedia.includes(newMediaInput.trim())) {
                  allMedia.push(newMediaInput.trim());
                }
                try {
                  await onCreatePost?.({
                    title: newTitle.trim(),
                    content: newContent.trim(),
                    ...(allMedia.length > 0 ? { mediaPaths: allMedia } : {}),
                  });
                  setNewTitle("");
                  setNewContent("");
                  setNewMediaList([]);
                  setNewMediaInput("");
                } finally {
                  setIsCreatingPost(false);
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, paddingTop: 16, borderTop: "1px dashed #cbd5e1" }}
            >
              <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Thêm bài viết mẫu mới</h4>
              {postFormError && (
                <div
                  style={{
                    color: "#ef4444",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {postFormError}
                </div>
              )}
              <input
                type="text"
                placeholder="Tiêu đề bài viết..."
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value);
                  if (postFormError) setPostFormError(null);
                }}
              />
              <textarea
                rows={3}
                placeholder="Nội dung bài viết giải pháp SME..."
                value={newContent}
                onChange={(e) => {
                  setNewContent(e.target.value);
                  if (postFormError) setPostFormError(null);
                }}
              />

              {/* Đính kèm hình ảnh & Stock Presets */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#f8fafc", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                    📸 Đính kèm hình ảnh bài viết ({newMediaList.length} ảnh):
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Chọn nhanh banner giải pháp Viettel:</span>
                </div>

                {/* Stock Banner Presets */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                  {STOCK_VIETTEL_BANNERS.map((banner, bIdx) => (
                    <button
                      key={bIdx}
                      type="button"
                      onClick={() => {
                        if (!newMediaList.includes(banner.url)) {
                          setNewMediaList((prev) => [...prev, banner.url]);
                        }
                      }}
                      style={{
                        padding: "3px 8px",
                        fontSize: 11,
                        borderRadius: 4,
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#ffffff",
                        cursor: "pointer",
                        color: "#0f172a",
                      }}
                    >
                      {banner.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="URL hoặc đường dẫn ảnh..."
                    value={newMediaInput}
                    onChange={(e) => setNewMediaInput(e.target.value)}
                    style={{ flex: 1, minWidth: 200, fontSize: 12, padding: "6px 10px", borderRadius: 4, border: "1px solid #cbd5e1" }}
                  />
                  <button
                    type="button"
                    onClick={handleAddMediaUrl}
                    disabled={!newMediaInput.trim()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: newMediaInput.trim() ? "pointer" : "not-allowed",
                    }}
                  >
                    ➕ Thêm link
                  </button>
                  <label
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #0284c7",
                      backgroundColor: "#f0f9ff",
                      color: "#0284c7",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    📁 Chọn ảnh từ máy
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>

                {/* Preview thumbnails strip */}
                {newMediaList.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {newMediaList.map((url, idx) => (
                      <div
                        key={idx}
                        style={{
                          position: "relative",
                          width: 56,
                          height: 56,
                          borderRadius: 6,
                          overflow: "hidden",
                          border: "1px solid #cbd5e1",
                        }}
                      >
                        <img
                          src={url}
                          alt={`Ảnh đính kèm ${idx + 1}`}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveMedia(idx)}
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            backgroundColor: "rgba(0, 0, 0, 0.7)",
                            color: "#ffffff",
                            border: "none",
                            fontSize: 9,
                            lineHeight: "16px",
                            textAlign: "center",
                            cursor: "pointer",
                            padding: 0,
                          }}
                          title="Xoá ảnh này"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button type="submit" className="secondary" disabled={isCreatingPost}>
                {isCreatingPost ? "Đang lưu..." : "Lưu vào kho bài mẫu"}
              </button>
            </form>
          </div>

          {/* Right: Master Groups & Bulk Importer */}
          <div className="panel">
            <div className="panel-heading">
              <h2>Danh Sách Nhóm Mục Tiêu (Master Groups)</h2>
              <span className="muted">Danh bạ hội nhóm Facebook đã phân loại</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tên nhóm</th>
                    <th>Link nhóm</th>
                    <th>Quyền đăng</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {facebookGroups.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "#94a3b8", padding: 16 }}>
                        Chưa có nhóm nào. Dán danh sách nhóm bên dưới để nạp nhanh.
                      </td>
                    </tr>
                  ) : (
                    facebookGroups.map((g) => (
                      <tr key={g.groupId}>
                        <td><strong>{g.name}</strong></td>
                        <td>
                          <a href={g.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>
                            {g.url}
                          </a>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "#ecfdf5", color: "#059669" }}>
                            {g.postingPermission || "ALLOWED"}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className="quiet"
                            aria-label="Xoá Xóa"
                            disabled={isDeletingGroupId === g.groupId}
                            onClick={async () => {
                              if (window.confirm(`Bạn có chắc muốn xoá nhóm "${g.name}" khỏi danh sách mục tiêu?`)) {
                                setIsDeletingGroupId(g.groupId);
                                try {
                                  await onDeleteGroup?.(g.groupId);
                                } finally {
                                  setIsDeletingGroupId(null);
                                }
                              }
                            }}
                            style={{
                              fontSize: 12,
                              padding: "4px 8px",
                              color: "#ef4444",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            title="Xoá nhóm này khỏi danh sách mục tiêu"
                          >
                            🗑️ Xoá
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Quick group importer */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const lines = bulkUrls
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0 && l.includes("facebook.com"));
                if (lines.length === 0) return;
                setIsBulkImporting(true);
                try {
                  await onBulkImportGroups?.(lines);
                  setBulkUrls("");
                } finally {
                  setIsBulkImporting(false);
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, paddingTop: 16, borderTop: "1px dashed #cbd5e1" }}
            >
              <h4 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Nhập nhanh link nhóm Facebook</h4>
              <textarea
                rows={3}
                placeholder="Dán danh sách URL nhóm Facebook (mỗi dòng một link, ví dụ: https://www.facebook.com/groups/...)"
                value={bulkUrls}
                onChange={(e) => setBulkUrls(e.target.value)}
              />
              <button
                type="submit"
                className="secondary"
                disabled={isBulkImporting || !bulkUrls.trim()}
              >
                {isBulkImporting ? "Đang nạp..." : "Nạp danh sách nhóm"}
              </button>
            </form>
          </div>
        </section>
      )}

      {/* Sub-tab 2: FANPAGE & PERSONAL PROFILE PUBLISHER */}
      {activeSubTab === "PAGES" && (
        <section className="panel" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                Đăng bài lên Fanpage &amp; Trang Cá Nhân (Profile &amp; Page Publisher)
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                Kênh xây dựng thương hiệu cá nhân AM Viettel và quản lý luồng bài giải pháp số trên Fanpage Doanh nghiệp
              </p>
            </div>
            <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, backgroundColor: "#e0f2fe", color: "#0369a1", fontWeight: 700 }}>
              📡 Luồng phát sóng độc lập
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Left: Master Posts Selection for Page Publishing */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#334155" }}>
                1. Chọn bài viết từ Kho mẫu để phát sóng:
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {posts.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>Chưa có bài viết mẫu.</div>
                ) : (
                  posts.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        backgroundColor: "#ffffff",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 13, color: "#0f172a" }}>{p.title}</strong>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.3 }}>
                          {p.content.slice(0, 90)}...
                        </p>
                        {p.mediaPaths && p.mediaPaths.length > 0 && (
                          <span style={{ fontSize: 11, color: "#0284c7", fontWeight: 600, display: "inline-block", marginTop: 4 }}>
                            📸 {p.mediaPaths.length} ảnh đính kèm
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="primary"
                        style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
                        onClick={() => handleOpenPageDispatch(p.id)}
                      >
                        Đăng lên Fanpage / Cá nhân
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right: Fanpage & Personal Profile Configuration */}
            <div style={{ backgroundColor: "#f8fafc", padding: 16, borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#334155" }}>
                2. Cấu hình luồng trang &amp; CTA giải pháp:
              </h3>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  Đích phát sóng bài viết:
                  <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="pageTargetType"
                        value="PERSONAL_WALL"
                        checked={pageTargetType === "PERSONAL_WALL"}
                        onChange={() => setPageTargetType("PERSONAL_WALL")}
                      />
                      <span>👤 Trang cá nhân (Personal Wall)</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="pageTargetType"
                        value="FANPAGE"
                        checked={pageTargetType === "FANPAGE"}
                        onChange={() => setPageTargetType("FANPAGE")}
                      />
                      <span>🏢 Fanpage Doanh nghiệp</span>
                    </label>
                  </div>
                </label>

                {pageTargetType === "FANPAGE" && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                    URL Fanpage mục tiêu:
                    <input
                      type="text"
                      placeholder="https://facebook.com/vietteldian.sme..."
                      value={fanpageUrlInput}
                      onChange={(e) => setFanpageUrlInput(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                    />
                  </label>
                )}

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  Đường dẫn Call To Action (CTA):
                  <input
                    type="text"
                    placeholder="https://viettel.vn/sme/..."
                    value={ctaUrlInput}
                    onChange={(e) => setCtaUrlInput(e.target.value)}
                    style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>
                    Tự động chèn link khám phá giải pháp số vào cuối bài viết
                  </span>
                </label>

                <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                    🏷️ Bộ Hashtag thương hiệu đề xuất:
                  </div>
                  <div style={{ color: "#2563eb", fontStyle: "italic" }}>
                    #ViettelSME #ChuyenDoiSo #ViettelCA #SInvoice #vContract #BinhDuong
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Dispatch Group Modal Popup (3-Stage Pipeline: Pre-flight, Stepper, Dispatch) */}
      {dispatchPostId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              maxWidth: 540,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                  Quy trình 3 giai đoạn: Đăng bài Hội nhóm Facebook
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                  Bài viết: <strong>{posts.find((p) => p.id === dispatchPostId)?.title || dispatchPostId}</strong>
                </p>
                {(() => {
                  const target = posts.find((p) => p.id === dispatchPostId);
                  if (target?.mediaPaths && target.mediaPaths.length > 0) {
                    return (
                      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Ảnh:</span>
                        {target.mediaPaths.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt={`Ảnh ${i + 1}`}
                            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, border: "1px solid #cbd5e1" }}
                          />
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              <button
                type="button"
                onClick={() => setDispatchPostId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}
              >
                ✕
              </button>
            </div>

            {/* Stepper overview */}
            <div style={{ display: "flex", justifyContent: "space-between", backgroundColor: "#f1f5f9", padding: "8px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#475569" }}>
              <span>1. Trước đăng (Pre-flight)</span>
              <span>➔</span>
              <span>2. Thao tác đăng (Playwright)</span>
              <span>➔</span>
              <span>3. Báo cáo (Proof)</span>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
              Tài khoản Facebook đăng bài
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                {facebookAccounts.length > 0 ? (
                  facebookAccounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      [{a.platform}] {a.displayName ? `${a.displayName} (${a.accountId})` : a.accountId} ({a.status})
                    </option>
                  ))
                ) : (
                  <option value="fb-viettel-sme">[FACEBOOK] fb-viettel-sme</option>
                )}
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Chọn nhóm đăng bài ({selectedGroupIds.length}/{facebookGroups.length} đã chọn):
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedGroupIds.length === facebookGroups.length) {
                      setSelectedGroupIds([]);
                    } else {
                      setSelectedGroupIds(facebookGroups.map((g) => g.groupId));
                    }
                  }}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12 }}
                >
                  {selectedGroupIds.length === facebookGroups.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
              </div>
              <div
                style={{
                  maxHeight: 160,
                  overflowY: "auto",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {facebookGroups.map((g) => (
                  <label
                    key={g.groupId}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(g.groupId)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedGroupIds([...selectedGroupIds, g.groupId]);
                        } else {
                          setSelectedGroupIds(selectedGroupIds.filter((id) => id !== g.groupId));
                        }
                      }}
                    />
                    <span>
                      <strong>{g.name}</strong> ({g.url})
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Delay Interval Selector (Anti-Checkpoint) & ETA */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
                Giãn cách đăng bài:
                <select
                  aria-label="Khoảng cách giữa các bài đăng"
                  value={dispatchDelaySeconds}
                  onChange={(e) => setDispatchDelaySeconds(Number(e.target.value))}
                  style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                >
                  <option value={30}>⚡ 30s / nhóm (Nhanh)</option>
                  <option value={60}>🛡️ 60s / nhóm (Khuyên dùng)</option>
                  <option value={120}>🔒 120s / nhóm (Rất an toàn)</option>
                  <option value={180}>🛑 180s / nhóm (Nick mới)</option>
                </select>
              </label>

              <div style={{ backgroundColor: "#f8fafc", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Ước tính thời gian chạy (ETA):</span>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
                  ~{Math.round((selectedGroupIds.length * dispatchDelaySeconds) / 60)} phút
                </div>
                <span style={{ fontSize: 11, color: "#059669" }}>
                  {selectedGroupIds.length} nhóm x {dispatchDelaySeconds}s
                </span>
              </div>
            </div>

            {/* Spin-tax Live Preview */}
            <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>
                  🎲 Thử nghiệm Spin-tax &amp; Biến thể nội dung:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const post = posts.find((p) => p.id === dispatchPostId);
                    if (!post) return;
                    const sampleGroup = facebookGroups.find((g) => selectedGroupIds.includes(g.groupId))?.name || "Hội Doanh nghiệp";
                    setSpintaxPreview(resolveSpinTaxPreview(post.content, { TÊN_NHÓM: sampleGroup }));
                  }}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#0284c7",
                  }}
                >
                  🎲 Xem thử biến thể ngẫu nhiên
                </button>
              </div>
              <div
                data-testid="spintax-preview"
                style={{
                  fontStyle: "italic",
                  color: "#475569",
                  background: "#ffffff",
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #cbd5e1",
                  maxHeight: 70,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {spintaxPreview || posts.find((p) => p.id === dispatchPostId)?.content || "Chưa có nội dung"}
              </div>
            </div>

            <div style={{ backgroundColor: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#1e40af", lineHeight: 1.4 }}>
              💡 <strong>Lưu ý vận hành an toàn:</strong> Sau khi xác nhận, hệ thống xếp bài vào <strong>Hàng đợi (QUEUED)</strong> để kiểm soát tần suất chống checkpoint. Hãy bấm <strong>[▶️ Chạy đăng bài]</strong> hoặc <strong>[🚀 Chạy toàn bộ hàng đợi]</strong> ở Bảng Nhật ký bên dưới để Playwright mở trình duyệt, đăng bài và hiển thị Link minh chứng thật.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setDispatchPostId(null)}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc" }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmDispatch}
                disabled={isSubmittingDispatch || !selectedAccountId || selectedGroupIds.length === 0}
              >
                {isSubmittingDispatch ? "Đang điều phối..." : "Xác nhận chạy đăng bài"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Fanpage / Profile Dispatch Confirmation Modal */}
      {pageDispatchPostId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              maxWidth: 500,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                Xác nhận đăng bài lên {pageTargetType === "FANPAGE" ? "Fanpage Doanh nghiệp" : "Trang cá nhân"}
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                Bài viết: <strong>{posts.find((p) => p.id === pageDispatchPostId)?.title}</strong>
              </p>
            </div>

            <div style={{ backgroundColor: "#f8fafc", padding: 12, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 13 }}>
              <div><strong>Tài khoản:</strong> {selectedAccountId}</div>
              <div style={{ marginTop: 4 }}>
                <strong>Đích đăng:</strong> {pageTargetType === "FANPAGE" ? (fanpageUrlInput || "Fanpage chính") : "Trang cá nhân (Personal Wall)"}
              </div>
              {ctaUrlInput && (
                <div style={{ marginTop: 4 }}>
                  <strong>Link CTA đính kèm:</strong> {ctaUrlInput}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setPageDispatchPostId(null)}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc" }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmPageDispatch}
                disabled={isSubmittingPageDispatch}
              >
                {isSubmittingPageDispatch ? "Đang phát sóng..." : "Bấm đăng ngay"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Proof Screenshot Modal */}
      {viewProofImage && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 24,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              maxWidth: 720,
              width: "100%",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                📸 Ảnh chụp màn hình minh chứng bài viết (Proof Screenshot)
              </h3>
              <button
                type="button"
                onClick={() => setViewProofImage(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}
              >
                ✕
              </button>
            </div>
            <div style={{ maxHeight: "75vh", overflow: "auto", textAlign: "center" }}>
              <img
                src={viewProofImage}
                alt="Minh chứng bài đăng"
                style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #cbd5e1" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 5b. Zoom Master Post Media Modal */}
      {viewZoomImage && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 24,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              maxWidth: 680,
              width: "100%",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🖼️ Xem ảnh bài viết mẫu</h3>
              <button
                type="button"
                onClick={() => setViewZoomImage(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}
              >
                ✕
              </button>
            </div>
            <div style={{ textAlign: "center" }}>
              <img
                src={viewZoomImage}
                alt="Xem ảnh lớn"
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 6 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 6. Google Docs Content Library Import Modal */}
      {showLibraryModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              maxWidth: 620,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              maxHeight: "85vh",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                  Thư viện Nội dung Google Docs (MOD-PB-002)
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                  Chọn bài viết đã được phê duyệt để nạp ngay vào Kho bài mẫu Facebook
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLibraryModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: 400 }}>
              {libraryPosts.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>
                  Chưa có bài viết nào được phê duyệt từ Google Docs.
                </div>
              ) : (
                libraryPosts.map((libPost) => (
                  <div
                    key={libPost.id}
                    style={{
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      padding: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 14, color: "#0f172a" }}>{libPost.title}</strong>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
                        {libPost.content.length > 100 ? `${libPost.content.slice(0, 100)}...` : libPost.content}
                      </p>
                      {libPost.mediaPaths && libPost.mediaPaths.length > 0 && (
                        <span style={{ fontSize: 11, color: "#0284c7", fontWeight: 600, marginTop: 4, display: "inline-block" }}>
                          📸 {libPost.mediaPaths.length} ảnh đính kèm
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="primary"
                      style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
                      onClick={async () => {
                        await onCreatePost?.({
                          title: libPost.title,
                          content: libPost.content,
                          ...(libPost.mediaPaths && libPost.mediaPaths.length > 0
                            ? { mediaPaths: [...libPost.mediaPaths] }
                            : {}),
                        });
                        setShowLibraryModal(false);
                      }}
                    >
                      Nạp bài này
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 7. Add Account Modal Popup */}
      {showAddAccountModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              maxWidth: 440,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                Thêm tài khoản Facebook mới
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                Hệ thống sẽ tạo hồ sơ trình duyệt Playwright riêng biệt và mở Google Chrome để bạn đăng nhập trực tiếp.
              </p>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
              Tên gợi nhớ tài khoản (viết liền không dấu, ví dụ: fb-am-nguyen):
              <input
                type="text"
                placeholder="Nhập tên tài khoản (ví dụ: fb-chi-hoa)"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1" }}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setShowAddAccountModal(false)}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc" }}
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isAddingAccount || !newAccountName.trim()}
                onClick={async () => {
                  if (!newAccountName.trim()) return;
                  setIsAddingAccount(true);
                  try {
                    await onAddAccount?.(newAccountName.trim());
                    setShowAddAccountModal(false);
                    setNewAccountName("");
                  } finally {
                    setIsAddingAccount(false);
                  }
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isAddingAccount || !newAccountName.trim() ? "not-allowed" : "pointer",
                }}
              >
                {isAddingAccount ? "Đang mở Chrome..." : "Mở Chrome đăng nhập"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Báo cáo & Nhật ký Đăng bài (Posting Log with Proof Viewer & Retry) */}
      <section className="panel">
        <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2>Báo Cáo &amp; Nhật Ký Đăng Bài (Posting Log)</h2>
            <span className="muted">Theo dõi tiến trình Playwright, minh chứng bài đăng và link thực tế</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {publishedCount > 0 && (
              <span style={{ fontSize: 12, color: "#059669", fontWeight: 600, backgroundColor: "#ecfdf5", border: "1px solid #a7f3d0", padding: "4px 8px", borderRadius: 4 }}>
                ✅ Đã đăng: {publishedCount}
              </span>
            )}
            {queuedCount > 0 && (
              <button
                type="button"
                className="primary"
                style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
                disabled={isExecutingBatch || Boolean(runningJobId)}
                onClick={async () => {
                  setIsExecutingBatch(true);
                  try {
                    const queuedJobs = facebookLogs.filter((l) => l.status === "QUEUED");
                    for (const j of queuedJobs) {
                      setRunningJobId(j.jobId);
                      await onRunJob?.(j.jobId);
                    }
                  } finally {
                    setRunningJobId(null);
                    setIsExecutingBatch(false);
                  }
                }}
              >
                {isExecutingBatch ? "⏳ Đang chạy toàn bộ..." : `🚀 Chạy toàn bộ hàng đợi (${queuedCount} bài)`}
              </button>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên nhóm / Đích đăng</th>
                <th>Tài khoản</th>
                <th>Thời gian</th>
                <th>Trạng thái</th>
                <th>Minh chứng / Link bài</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {facebookLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8", padding: 16 }}>
                    Chưa có lượt đăng bài nào. Hãy chọn bài viết mẫu và bấm đăng lên nhóm hoặc Fanpage.
                  </td>
                </tr>
              ) : (
                facebookLogs.map((l) => (
                  <tr key={l.jobId}>
                    <td>
                      <div><strong>{l.groupName}</strong></div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        {l.content ? (l.content.length > 50 ? `${l.content.slice(0, 50)}...` : l.content) : l.groupUrl}
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12, fontWeight: 600 }}>{l.accountId}</span></td>
                    <td style={{ fontSize: 12 }}>{new Date(l.dispatchedAt).toLocaleTimeString("vi-VN")}</td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 4,
                          backgroundColor:
                            l.status === "PUBLISHED"
                              ? "#ecfdf5"
                              : l.status === "PENDING_APPROVAL"
                                ? "#fffbeb"
                                : l.status === "FAILED"
                                  ? "#fef2f2"
                                  : "#eff6ff",
                          color:
                            l.status === "PUBLISHED"
                              ? "#059669"
                              : l.status === "PENDING_APPROVAL"
                                ? "#d97706"
                                : l.status === "FAILED"
                                  ? "#ef4444"
                                  : "#2563eb",
                        }}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {l.postUrl ? (
                          <a
                            href={l.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 12,
                              color: "#0284c7",
                              fontWeight: 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              backgroundColor: "#f0f9ff",
                              border: "1px solid #bae6fd",
                              padding: "2px 8px",
                              borderRadius: 4,
                              textDecoration: "none",
                            }}
                          >
                            🔗 Xem bài viết ↗
                          </a>
                        ) : l.status === "QUEUED" ? (
                          <span style={{ fontSize: 11, color: "#b45309", backgroundColor: "#fef3c7", padding: "2px 6px", borderRadius: 4 }}>
                            ⏳ Chờ bấm "Chạy đăng bài"
                          </span>
                        ) : l.status === "FAILED" ? (
                          <span
                            title={l.error || "Đăng bài thất bại"}
                            style={{
                              fontSize: 11,
                              color: "#dc2626",
                              backgroundColor: "#fee2e2",
                              border: "1px solid #fecaca",
                              padding: "2px 6px",
                              borderRadius: 4,
                              maxWidth: 240,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "inline-block",
                            }}
                          >
                            ⚠️ {l.error ? (l.error.length > 35 ? `${l.error.slice(0, 35)}...` : l.error) : "Lỗi đăng bài"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>—</span>
                        )}
                        {l.screenshotProofUrl && (
                          <button
                            type="button"
                            onClick={() => setViewProofImage(l.screenshotProofUrl!)}
                            style={{
                              border: "1px solid #cbd5e1",
                              backgroundColor: "#f8fafc",
                              borderRadius: 4,
                              padding: "2px 6px",
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            📸 Ảnh minh chứng
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      {l.status === "QUEUED" || l.status === "RUNNING" ? (
                        <button
                          type="button"
                          className="primary"
                          disabled={runningJobId === l.jobId || isExecutingBatch}
                          style={{ fontSize: 11, padding: "4px 8px" }}
                          onClick={async () => {
                            setRunningJobId(l.jobId);
                            try {
                              await onRunJob?.(l.jobId);
                            } finally {
                              setRunningJobId(null);
                            }
                          }}
                        >
                          {runningJobId === l.jobId ? "⏳ Đang đăng..." : "Chạy đăng bài"}
                        </button>
                      ) : l.status === "FAILED" ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={runningJobId === l.jobId || isExecutingBatch}
                          style={{ fontSize: 11, padding: "4px 8px" }}
                          onClick={async () => {
                            setRunningJobId(l.jobId);
                            try {
                              await onRunJob?.(l.jobId);
                            } finally {
                              setRunningJobId(null);
                            }
                          }}
                        >
                          {runningJobId === l.jobId ? "⏳ Đang thử lại..." : "🔄 Thử lại"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>✅ Hoàn tất</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
