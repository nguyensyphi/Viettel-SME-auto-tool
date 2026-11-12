"use client";

import { useState, type FormEvent } from "react";

export interface PublishingCalendarItem {
  readonly contentId: string;
  readonly topic: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status:
    | "DRAFT"
    | "APPROVED"
    | "SCHEDULED"
    | "PUBLISHED"
    | "FAILED"
    | "AWAITING_AM_CONFIRMATION"
    | "NEEDS_LOGIN";
  readonly mode: "FULL_AUTO" | "SEMI_AUTO";
  readonly publishTime: string;
  readonly mediaCount: number;
}

export interface ContentLibraryPostItem {
  readonly id: string;
  readonly postCode: string;
  readonly title: string;
  readonly topicCode: string;
  readonly platforms: readonly string[];
  readonly status: string;
  readonly version: number;
}

export interface PublishingJobSummaryItem {
  readonly id: string;
  readonly contentId: string;
  readonly platform: string;
  readonly publishMode: string;
  readonly status: string;
  readonly scheduledAt: string;
}

export interface PublishingAnalyticsSummary {
  readonly posts: {
    readonly total: number;
    readonly approved: number;
    readonly draft: number;
    readonly rejected: number;
  };
  readonly media: {
    readonly total: number;
    readonly approved: number;
    readonly pending: number;
  };
  readonly accounts: {
    readonly total: number;
    readonly active: number;
    readonly needsAuth: number;
  };
  readonly jobs: {
    readonly total: number;
    readonly queued: number;
    readonly waitingConfirmation: number;
    readonly published: number;
    readonly failed: number;
  };
}

export interface CalendarViewProps {
  readonly data: unknown;
  readonly onApprovePost?: ((contentId: string) => void) | undefined;
  readonly onSchedulePost?:
    | ((input: {
        contentId: string;
        topic: string;
        platform: "ZALO" | "FACEBOOK";
        mode: "FULL_AUTO" | "SEMI_AUTO";
        publishTime: string;
        content: string;
      }) => Promise<void>)
    | undefined;
  readonly onImportGoogleDocsText?:
    | ((rawText: string) => Promise<void>)
    | undefined;
  readonly onMatchMedia?: ((postId: string) => Promise<void>) | undefined;
  readonly onValidateContent?: ((postId: string) => Promise<void>) | undefined;
  readonly onConfirmAssistedJob?:
    | ((jobId: string) => Promise<void>)
    | undefined;
}

function extractCalendarPayload(data: unknown): {
  readonly items: readonly PublishingCalendarItem[];
  readonly contents: readonly ContentLibraryPostItem[];
  readonly jobs: readonly PublishingJobSummaryItem[];
  readonly analytics?: PublishingAnalyticsSummary | undefined;
} {
  if (!data || typeof data !== "object") {
    return { items: [], contents: [], jobs: [] };
  }
  const record = data as {
    items?: unknown;
    contents?: unknown;
    jobs?: unknown;
    analytics?: unknown;
  };
  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray(record.items)
      ? record.items
      : [];
  const items = rawItems.filter(
    (item): item is PublishingCalendarItem =>
      Boolean(
        item &&
          typeof item === "object" &&
          "contentId" in item &&
          typeof (item as any).contentId === "string" &&
          (item as any).contentId.length > 0,
      ),
  );
  return {
    items,
    contents: Array.isArray(record.contents)
      ? (record.contents as readonly ContentLibraryPostItem[])
      : [],
    jobs: Array.isArray(record.jobs)
      ? (record.jobs as readonly PublishingJobSummaryItem[])
      : [],
    analytics: record.analytics as PublishingAnalyticsSummary | undefined,
  };
}

export function CalendarView({
  data,
  onApprovePost,
  onSchedulePost,
  onImportGoogleDocsText,
  onMatchMedia,
  onValidateContent,
  onConfirmAssistedJob,
}: CalendarViewProps) {
  const { items, contents, jobs, analytics } = extractCalendarPayload(data);

  const [contentId, setContentId] = useState("");
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<"ZALO" | "FACEBOOK">("ZALO");
  const [mode, setMode] = useState<"FULL_AUTO" | "SEMI_AUTO">("SEMI_AUTO");
  const [publishTime, setPublishTime] = useState("");
  const [content, setContent] = useState("");
  const [rawDocsBlock, setRawDocsBlock] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!contentId.trim() || !topic.trim() || !content.trim() || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSchedulePost?.({
        contentId: contentId.trim(),
        topic: topic.trim(),
        platform,
        mode,
        publishTime: publishTime
          ? new Date(publishTime).toISOString()
          : new Date().toISOString(),
        content: content.trim(),
      });
      setContentId("");
      setTopic("");
      setContent("");
      setPublishTime("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleImportDocs(e: FormEvent) {
    e.preventDefault();
    if (!rawDocsBlock.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onImportGoogleDocsText?.(rawDocsBlock.trim());
      setRawDocsBlock("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0, maxWidth: "100%" }}>
      {analytics && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <div className="panel" style={{ padding: "14px" }}>
            <span className="muted" style={{ fontSize: "12px" }}>
              Tổng bài viết thư viện
            </span>
            <strong style={{ display: "block", fontSize: "22px", marginTop: "4px" }}>
              {analytics.posts.total} ({analytics.posts.approved} đã duyệt)
            </strong>
          </div>
          <div className="panel" style={{ padding: "14px" }}>
            <span className="muted" style={{ fontSize: "12px" }}>
              Ảnh Drive đã duyệt
            </span>
            <strong style={{ display: "block", fontSize: "22px", marginTop: "4px" }}>
              {analytics.media.approved} / {analytics.media.total}
            </strong>
          </div>
          <div className="panel" style={{ padding: "14px" }}>
            <span className="muted" style={{ fontSize: "12px" }}>
              Chờ AM xác nhận đăng
            </span>
            <strong style={{ display: "block", fontSize: "22px", marginTop: "4px" }}>
              {analytics.jobs.waitingConfirmation}
            </strong>
          </div>
          <div className="panel" style={{ padding: "14px" }}>
            <span className="muted" style={{ fontSize: "12px" }}>
              Bài đã xuất bản
            </span>
            <strong style={{ display: "block", fontSize: "22px", marginTop: "4px" }}>
              {analytics.jobs.published}
            </strong>
          </div>
        </section>
      )}

      <section className="panel-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Lịch xuất bản nội dung (Personal Branding)</h2>
            <span className="muted">
              Vòng đời bắt buộc: DRAFT → APPROVED → SCHEDULED
            </span>
          </div>
          <p className="fine-print">
            Hỗ trợ chế độ FULL_AUTO và SEMI_AUTO (dừng trước bước nhấn đăng để AM
            xác nhận). Bài viết bắt buộc đính kèm ảnh sẽ bị chặn nếu thiếu media hợp
            lệ.
          </p>
          {items.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mã bài viết</th>
                    <th>Chủ đề</th>
                    <th>Kênh</th>
                    <th>Chế độ</th>
                    <th>Trạng thái</th>
                    <th>Ảnh đính kèm</th>
                    <th>Giờ dự kiến</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${item.platform ?? 'calendar'}:${item.contentId ?? index}`}>
                      <td>{item.contentId}</td>
                      <td>{item.topic}</td>
                      <td>{item.platform}</td>
                      <td>{item.mode}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            backgroundColor:
                              item.status === "APPROVED" ||
                              item.status === "SCHEDULED" ||
                              item.status === "PUBLISHED"
                                ? "#ecfdf5"
                                : "#fffbeb",
                            color:
                              item.status === "APPROVED" ||
                              item.status === "SCHEDULED" ||
                              item.status === "PUBLISHED"
                                ? "#059669"
                                : "#d97706",
                          }}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td>{item.mediaCount}</td>
                      <td>
                        {new Date(item.publishTime).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </td>
                      <td>
                        {item.status === "DRAFT" ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onApprovePost?.(item.contentId)}
                          >
                            Duyệt bài
                          </button>
                        ) : (
                          <span className="muted">Đã duyệt</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Chưa có lịch đăng bài nào được lên kế hoạch.</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Lên lịch bài viết mới</h2>
            <span className="muted">Tạo bài đăng &amp; phê duyệt trước khi xuất bản</span>
          </div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <label>
              Mã định danh bài viết
              <input
                type="text"
                placeholder="ví dụ: POST-CA-03"
                value={contentId}
                onChange={(e) => setContentId(e.target.value)}
                required
              />
            </label>
            <label>
              Chủ đề bài viết
              <input
                type="text"
                placeholder="ví dụ: Chữ ký số từ xa Viettel Mysign 2026"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", minWidth: 0, maxWidth: "100%" }}>
              <label style={{ minWidth: 0, maxWidth: "100%" }}>
                Kênh xuất bản
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as "ZALO" | "FACEBOOK")}
                  style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
                >
                  <option value="ZALO">Zalo</option>
                  <option value="FACEBOOK">Facebook</option>
                </select>
              </label>
              <label style={{ minWidth: 0, maxWidth: "100%" }}>
                Chế độ xuất bản
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "FULL_AUTO" | "SEMI_AUTO")}
                  style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
                >
                  <option value="SEMI_AUTO">SEMI_AUTO (Duyệt trước khi đăng)</option>
                  <option value="FULL_AUTO">FULL_AUTO (Tự động đăng)</option>
                </select>
              </label>
            </div>
            <label>
              Thời gian xuất bản dự kiến
              <input
                type="datetime-local"
                value={publishTime}
                onChange={(e) => setPublishTime(e.target.value)}
              />
            </label>
            <label>
              Nội dung bài viết
              <textarea
                rows={4}
                placeholder="Nhập nội dung chia sẻ giải pháp Viettel SME..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={isSubmitting || !contentId.trim() || !topic.trim() || !content.trim()}>
              {isSubmitting ? "Đang lên lịch…" : "Lên lịch bài viết"}
            </button>
          </form>
        </div>
      </section>

      {/* THƯ VIỆN NỘI DUNG GOOGLE DOCS & GHÉP ẢNH DRIVE (MOD-PB-002) */}
      <section className="panel-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Thư viện Nội dung Google Docs (MOD-PB-002)</h2>
            <span className="muted">Phân loại 10 chủ đề · Ghép ảnh tự động 0.4P+0.3T</span>
          </div>
          {contents.length > 0 ? (
            <div className="table-wrap" style={{ marginBottom: "14px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Mã bài</th>
                    <th>Tiêu đề</th>
                    <th>Chủ đề</th>
                    <th>Phiên bản</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {contents.map((post) => (
                    <tr key={post.id}>
                      <td>{post.postCode}</td>
                      <td>{post.title}</td>
                      <td>{post.topicCode}</td>
                      <td>v{post.version}</td>
                      <td>{post.status}</td>
                      <td style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => onMatchMedia?.(post.id)}
                        >
                          Ghép ảnh tự động
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => onValidateContent?.(post.id)}
                        >
                          Kiểm tra hợp lệ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Chưa có bài viết nào trong Thư viện Google Docs.</p>
          )}

          {jobs.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kênh</th>
                    <th>Chế độ</th>
                    <th>Trạng thái Job</th>
                    <th>Xác nhận Assisted</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.platform}</td>
                      <td>{job.publishMode}</td>
                      <td>{job.status}</td>
                      <td>
                        {job.status === "WAITING_CONFIRMATION" ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => onConfirmAssistedJob?.(job.id)}
                          >
                            Xác nhận đã đăng
                          </button>
                        ) : (
                          <span className="muted">Hoàn tất</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Nhập bài viết chuẩn Google Docs</h2>
            <span className="muted">Hỗ trợ cú pháp [POST_START] ... [POST_END]</span>
          </div>
          <form onSubmit={handleImportDocs} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <label>
              Nội dung tài liệu Google Docs
              <textarea
                rows={7}
                placeholder={`[POST_START]\nPOST_ID: PB001\nTITLE: Giải pháp Chữ ký số Viettel-CA\nTOPIC: CHU_KY_SO\nPLATFORMS: ZALO, FACEBOOK\nSTATUS: APPROVED\nCONTENT:\nNội dung bài viết...\n[POST_END]`}
                value={rawDocsBlock}
                onChange={(e) => setRawDocsBlock(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={isSubmitting || !rawDocsBlock.trim()}>
              {isSubmitting ? "Đang phân tích…" : "Nhập từ Google Docs"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
