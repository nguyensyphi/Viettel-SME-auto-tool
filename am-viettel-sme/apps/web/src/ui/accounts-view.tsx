"use client";

export interface SocialAccountItem {
  readonly accountId: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status: "CONNECTED" | "NEEDS_LOGIN" | "SUSPENDED";
  readonly profileDir: string;
  readonly circuitState?: "CLOSED" | "OPEN" | "HALF_OPEN" | undefined;
}

export interface AccountsViewProps {
  readonly data: unknown;
  readonly onTriggerQrLogin?:
    | ((accountId: string, platform: "ZALO" | "FACEBOOK") => void)
    | undefined;
}

function extractAccountItems(data: unknown): readonly SocialAccountItem[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data as readonly SocialAccountItem[];
  const record = data as { items?: unknown };
  return Array.isArray(record.items)
    ? (record.items as readonly SocialAccountItem[])
    : [];
}

export function AccountsView({ data, onTriggerQrLogin }: AccountsViewProps) {
  const items = extractAccountItems(data);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Quản lý tài khoản MXH &amp; Phiên Playwright</h2>
        <span className="muted">
          Cô lập profile riêng tại storage/browser_profiles/&lt;account_id&gt;
        </span>
      </div>
      <p className="fine-print">
        AM đăng nhập trực tiếp bằng cửa sổ trình duyệt thật (quét QR Zalo /
        Facebook). Hệ thống nghiêm cấm dùng chung cookie hoặc proxy vượt kiểm
        soát.
      </p>
      {items.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mã tài khoản</th>
                <th>Nền tảng</th>
                <th>Trạng thái phiên</th>
                <th>Circuit Breaker</th>
                <th>Thư mục Profile cô lập</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.platform}:${item.accountId}`}>
                  <td>{item.accountId}</td>
                  <td>{item.platform}</td>
                  <td>
                    <strong>{item.status}</strong>
                  </td>
                  <td>{item.circuitState ?? "CLOSED"}</td>
                  <td>
                    <code>{item.profileDir}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        onTriggerQrLogin?.(item.accountId, item.platform)
                      }
                    >
                      Quét QR đăng nhập
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          Chưa có tài khoản MXH nào được khai báo trong workspace này.
        </p>
      )}
    </section>
  );
}

