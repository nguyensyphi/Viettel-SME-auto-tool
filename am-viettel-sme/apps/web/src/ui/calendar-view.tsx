"use client";

export interface PublishingCalendarItem {
  readonly contentId: string;
  readonly topic: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status:
    | "DRAFT"
    | "APPROVED"
    | "SCHEDULED"
    | "PUBLISHED"
    | "AWAITING_AM_CONFIRMATION"
    | "NEEDS_LOGIN";
  readonly mode: "FULL_AUTO" | "SEMI_AUTO";
  readonly publishTime: string;
  readonly mediaCount: number;
}

export interface CalendarViewProps {
  readonly data: unknown;
  readonly onApprovePost?: ((contentId: string) => void) | undefined;
}

function extractCalendarItems(data: unknown): readonly PublishingCalendarItem[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data as readonly PublishingCalendarItem[];
  const record = data as { items?: unknown };
  return Array.isArray(record.items)
    ? (record.items as readonly PublishingCalendarItem[])
    : [];
}

export function CalendarView({ data, onApprovePost }: CalendarViewProps) {
  const items = extractCalendarItems(data);

  return (
    <section className="panel">
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
              {items.map((item) => (
                <tr key={`${item.platform}:${item.contentId}`}>
                  <td>{item.contentId}</td>
                  <td>{item.topic}</td>
                  <td>{item.platform}</td>
                  <td>{item.mode}</td>
                  <td>
                    <strong>{item.status}</strong>
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
    </section>
  );
}

