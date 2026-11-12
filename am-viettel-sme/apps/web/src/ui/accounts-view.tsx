"use client";

import { useState, type FormEvent } from "react";

export interface SocialAccountItem {
  readonly accountId: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status: "CONNECTED" | "NEEDS_LOGIN" | "SUSPENDED";
  readonly profileDir: string;
  readonly circuitState?: "CLOSED" | "OPEN" | "HALF_OPEN" | undefined;
}

export interface KillSwitchState {
  readonly active: boolean;
  readonly reason?: string | undefined;
  readonly updatedBy?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface AccountsViewProps {
  readonly data: unknown;
  readonly onTriggerQrLogin?:
    | ((accountId: string, platform: "ZALO" | "FACEBOOK") => void)
    | undefined;
  readonly onConnectAccount?:
    | ((accountId: string, platform: "ZALO" | "FACEBOOK") => void)
    | undefined;
  readonly onDeclareAccount?:
    | ((accountId: string, platform: "ZALO" | "FACEBOOK") => Promise<void>)
    | undefined;
  readonly onToggleKillSwitch?:
    | ((active: boolean, reason?: string) => Promise<void> | void)
    | undefined;
  readonly onResetCircuit?:
    | ((accountId: string, platform: "ZALO" | "FACEBOOK") => Promise<void> | void)
    | undefined;
}

function extractAccountItems(data: unknown): readonly SocialAccountItem[] {
  if (!data || typeof data !== "object") return [];
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];
  return list.filter(
    (item): item is SocialAccountItem =>
      Boolean(
        item &&
          typeof item === "object" &&
          "accountId" in item &&
          typeof (item as any).accountId === "string" &&
          (item as any).accountId.length > 0,
      ),
  );
}

function extractKillSwitch(data: unknown): KillSwitchState {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { active: false };
  }
  const record = data as { killSwitch?: unknown };
  if (record.killSwitch && typeof record.killSwitch === "object") {
    const ks = record.killSwitch as {
      active?: boolean;
      reason?: string;
      updatedBy?: string;
      updatedAt?: string;
    };
    return {
      active: Boolean(ks.active),
      ...(ks.reason ? { reason: ks.reason } : {}),
      ...(ks.updatedBy ? { updatedBy: ks.updatedBy } : {}),
      ...(ks.updatedAt ? { updatedAt: ks.updatedAt } : {}),
    };
  }
  return { active: false };
}

export function AccountsView({
  data,
  onTriggerQrLogin,
  onConnectAccount,
  onDeclareAccount,
  onToggleKillSwitch,
  onResetCircuit,
}: AccountsViewProps) {
  const items = extractAccountItems(data);
  const killSwitch = extractKillSwitch(data);
  const [killReason, setKillReason] = useState("");
  const [activeQrModal, setActiveQrModal] = useState<{
    accountId: string;
    platform: "ZALO" | "FACEBOOK";
  } | null>(null);

  const [newAccountId, setNewAccountId] = useState("");
  const [newPlatform, setNewPlatform] = useState<"ZALO" | "FACEBOOK">("ZALO");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    if (!newAccountId.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onDeclareAccount?.(newAccountId.trim(), newPlatform);
      setNewAccountId("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleStartQr(accountId: string, platform: "ZALO" | "FACEBOOK") {
    onTriggerQrLogin?.(accountId, platform);
    setActiveQrModal({ accountId, platform });
  }

  function handleConfirmConnected() {
    if (!activeQrModal) return;
    onConnectAccount?.(activeQrModal.accountId, activeQrModal.platform);
    setActiveQrModal(null);
  }

  return (
    <section className="panel-grid">
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panel-heading">
          <h2>Công tắc Dừng Khẩn cấp Toàn hệ thống (System Kill Switch)</h2>
          <span className="muted">
            Trạng thái hiện tại:{" "}
            <strong
              style={{ color: killSwitch.active ? "#dc2626" : "#059669" }}
            >
              {killSwitch.active ? "ĐANG DỪNG KHẨN CẤP (HALTED)" : "HOẠT ĐỘNG BÌNH THƯỜNG"}
            </strong>
          </span>
        </div>
        <p className="fine-print">
          Khi kích hoạt Kill Switch, toàn bộ Desktop Agent Runner và hàng đợi xuất bản / tiếp cận tự động sẽ tạm dừng ngay lập tức để bảo vệ an toàn tài khoản AM.
        </p>
        {killSwitch.active ? (
          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "8px" }}>
            <span className="muted">
              Lý do dừng: <strong>{killSwitch.reason ?? "Dừng khẩn cấp bởi quản trị viên"}</strong>
            </span>
            <button
              type="button"
              className="primary"
              onClick={() => void onToggleKillSwitch?.(false)}
            >
              Khôi phục hoạt động
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "8px" }}>
            <input
              type="text"
              placeholder="Lý do dừng khẩn cấp (tùy chọn)..."
              value={killReason}
              onChange={(e) => setKillReason(e.target.value)}
              style={{ flex: 1, maxWidth: "420px" }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void onToggleKillSwitch?.(
                  true,
                  killReason.trim() || "Dừng khẩn cấp bởi AM/Admin",
                )
              }
            >
              Kích hoạt Dừng khẩn cấp
            </button>
          </div>
        )}
      </div>

      <div className="panel">
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
                {items.map((item, index) => (
                  <tr key={`${item.platform ?? 'account'}:${item.accountId ?? index}`}>
                    <td>{item.accountId}</td>
                    <td>{item.platform}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor:
                            item.status === "CONNECTED"
                              ? "#ecfdf5"
                              : item.status === "NEEDS_LOGIN"
                                ? "#fffbeb"
                                : "#fef2f2",
                          color:
                            item.status === "CONNECTED"
                              ? "#059669"
                              : item.status === "NEEDS_LOGIN"
                                ? "#d97706"
                                : "#dc2626",
                        }}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>{item.circuitState ?? "CLOSED"}</td>
                    <td>
                      <code>{item.profileDir}</code>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => handleStartQr(item.accountId, item.platform)}
                        >
                          {item.status === "CONNECTED" ? "Quét lại QR" : "Quét QR đăng nhập"}
                        </button>
                        {item.circuitState === "OPEN" && (
                          <button
                            type="button"
                            className="primary"
                            onClick={() =>
                              void onResetCircuit?.(item.accountId, item.platform)
                            }
                          >
                            Khôi phục Circuit
                          </button>
                        )}
                      </div>
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
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Khai báo tài khoản mới</h2>
          <span className="muted">Tạo profile browser riêng biệt</span>
        </div>
        <form onSubmit={handleCreateAccount} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label>
            Mã định danh tài khoản
            <input
              type="text"
              placeholder="ví dụ: zalo-dian-am02"
              value={newAccountId}
              onChange={(e) => setNewAccountId(e.target.value)}
              required
            />
          </label>
          <label>
            Nền tảng mạng xã hội
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value as "ZALO" | "FACEBOOK")}
            >
              <option value="ZALO">Zalo cá nhân (Zalo Web)</option>
              <option value="FACEBOOK">Facebook cá nhân / Fanpage Viettel SME</option>
            </select>
          </label>
          <button className="primary" disabled={isSubmitting || !newAccountId.trim()}>
            {isSubmitting ? "Đang khai báo…" : "Khai báo tài khoản"}
          </button>
        </form>
      </div>

      {activeQrModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "460px",
              width: "90%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              textAlign: "center",
            }}
          >
            <h3 style={{ margin: "0 0 8px 0" }}>
              Quét mã QR đăng nhập {activeQrModal.platform}
            </h3>
            <p className="muted" style={{ fontSize: "13px", margin: "0 0 16px 0" }}>
              Trình duyệt Playwright đã mở phiên cô lập tại:
              <br />
              <code>storage/browser_profiles/{activeQrModal.accountId}</code>
            </p>
            <div
              style={{
                width: "200px",
                height: "200px",
                margin: "0 auto 16px auto",
                border: "2px dashed #0284c7",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "#f0f9ff",
              }}
            >
              <span style={{ fontSize: "48px" }}>📱</span>
              <span style={{ fontSize: "12px", color: "#0369a1", fontWeight: 600, marginTop: "8px" }}>
                [ MÃ QR ĐĂNG NHẬP ]
              </span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                Mở ứng dụng Zalo / FB quét mã
              </span>
            </div>
            <p className="fine-print" style={{ marginBottom: "20px" }}>
              Sau khi quét mã QR trên điện thoại và trình duyệt hoàn tất xác thực, hãy nhấn nút bên dưới để hoàn tất lưu phiên an toàn.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setActiveQrModal(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmConnected}
              >
                ✓ Xác nhận đã quét QR thành công
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
