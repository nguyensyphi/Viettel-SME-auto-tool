"use client";

export interface CampaignSummaryItem {
  readonly campaignId: string;
  readonly name: string;
  readonly status: "DRAFT" | "APPROVED" | "PAUSED" | "COMPLETED";
  readonly targetCategories: readonly string[];
}

export interface PartnerSummaryItem {
  readonly partnerId: string;
  readonly fullName: string;
  readonly phoneMasked: string;
  readonly profession: string;
  readonly stage: "NEW" | "CONTACTED" | "ACTIVE_PARTNER" | "INACTIVE";
  readonly totalReferrals: number;
  readonly approvedPendingCommissionVnd: number;
}

export interface CampaignViewProps {
  readonly data: unknown;
}

function extractCampaignOverview(data: unknown): {
  readonly campaigns: readonly CampaignSummaryItem[];
  readonly partners: readonly PartnerSummaryItem[];
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { campaigns: [], partners: [] };
  }
  const record = data as {
    campaigns?: unknown;
    partners?: unknown;
  };
  return {
    campaigns: Array.isArray(record.campaigns)
      ? (record.campaigns as readonly CampaignSummaryItem[])
      : [],
    partners: Array.isArray(record.partners)
      ? (record.partners as readonly PartnerSummaryItem[])
      : [],
  };
}

export function CampaignView({ data }: CampaignViewProps) {
  const { campaigns, partners } = extractCampaignOverview(data);

  return (
    <section className="panel-grid">
      <div className="panel">
        <div className="panel-heading">
          <h2>Chiến dịch Nhóm &amp; Tuyển CTV</h2>
          <span className="muted">Kiểm soát quyền đăng &amp; cooldown nhóm</span>
        </div>
        {campaigns.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mã chiến dịch</th>
                  <th>Tên chiến dịch</th>
                  <th>Nhóm mục tiêu</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.campaignId}>
                    <td>{c.campaignId}</td>
                    <td>{c.name}</td>
                    <td>{c.targetCategories.join(", ")}</td>
                    <td>
                      <strong>{c.status}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Chưa có chiến dịch nhóm nào.</p>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>Partner CRM &amp; Đối soát CTV</h2>
          <span className="muted">
            SĐT được che mặc định · Hoa hồng cần AM xác nhận chính sách
          </span>
        </div>
        {partners.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cộng tác viên</th>
                  <th>SĐT (đã che)</th>
                  <th>Nghề nghiệp</th>
                  <th>Giai đoạn</th>
                  <th>Số giới thiệu</th>
                  <th>Hoa hồng chờ chi (VND)</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.partnerId}>
                    <td>{p.fullName}</td>
                    <td>{p.phoneMasked}</td>
                    <td>{p.profession}</td>
                    <td>
                      <strong>{p.stage}</strong>
                    </td>
                    <td>{p.totalReferrals}</td>
                    <td>
                      {p.approvedPendingCommissionVnd.toLocaleString("vi-VN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Chưa có hồ sơ cộng tác viên nào.</p>
        )}
      </div>
    </section>
  );
}

