"use client";

import { useState, type FormEvent } from "react";

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

export interface OutreachTaskItem {
  readonly id: string;
  readonly leadId: string;
  readonly companyName: string;
  readonly phone: string;
  readonly status: "QUEUED" | "PROCESSING" | "SENT" | "FRIEND_REQUESTED" | "NOT_FOUND" | "FAILED" | "SKIPPED";
  readonly error?: string;
  readonly sentAt?: string;
}

export interface OutreachBatchSummary {
  readonly total: number;
  readonly queued: number;
  readonly sent: number;
  readonly friendRequested: number;
  readonly notFound: number;
  readonly skipped: number;
}

export interface ActiveOutreachBatch {
  readonly batchId: string;
  readonly batchName: string;
  readonly summary: OutreachBatchSummary;
  readonly tasks: readonly OutreachTaskItem[];
}

export interface LeadItem {
  readonly id: string;
  readonly companyName: string;
  readonly phone: string;
  readonly contactName?: string;
  readonly industry?: string;
}

export interface GroupSummaryItem {
  readonly groupId: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly name: string;
  readonly url: string;
  readonly category: string;
  readonly postingPermission: string;
  readonly minHoursBetweenPosts: number;
  readonly active: boolean;
}

export interface ReferralSummaryItem {
  readonly referralId: string;
  readonly partnerId: string;
  readonly companyName: string;
  readonly normalizedTaxCode: string;
  readonly productCodes: readonly string[];
  readonly status: "REFERRED" | "CONVERTED";
}

export interface ConversionSummaryItem {
  readonly conversionId: string;
  readonly referralId: string;
  readonly partnerId: string;
  readonly contractRevenueVnd: number;
  readonly commissionRatePercent: number;
  readonly commissionAmountVnd: number;
  readonly payoutStatus: "APPROVED_PENDING_PAYOUT" | "PAID";
  readonly payoutReference?: string | undefined;
}

export interface GroupPostingJobItem {
  readonly jobId: string;
  readonly campaignId: string;
  readonly groupId?: string | undefined;
  readonly groupName: string;
  readonly groupUrl: string;
  readonly accountId: string;
  readonly platform?: "FACEBOOK" | "ZALO" | undefined;
  readonly status: "QUEUED" | "RUNNING" | "PUBLISHED" | "PENDING_APPROVAL" | "FAILED";
  readonly postUrl?: string | undefined;
  readonly error?: string | undefined;
  readonly dispatchedAt: string;
  readonly executedAt?: string | undefined;
}

export interface SocialAccountItem {
  readonly accountId: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status: string;
}

export interface CampaignViewProps {
  readonly data: unknown;
  readonly onApproveCampaign?: ((campaignId: string) => Promise<void>) | undefined;
  readonly onDispatchCampaign?:
    | ((
        campaignId: string,
        options?: { accountId?: string; groupIds?: string[] },
      ) => Promise<void>)
    | undefined;
  readonly onRunGroupJob?: ((jobId: string) => Promise<void>) | undefined;
  readonly onBulkImportGroups?: ((urls: string[]) => Promise<void>) | undefined;
  readonly onRegisterGroup?:
    | ((input: {
        groupId: string;
        platform: "ZALO" | "FACEBOOK";
        name: string;
        url: string;
        postingPermission: string;
      }) => Promise<void>)
    | undefined;
  readonly onCreateCampaign?:
    | ((input: {
        campaignId: string;
        name: string;
        campaignType: "PARTNER_RECRUITMENT" | "SME_SOLUTION_SHARING";
        targetCategories: string[];
        contentTemplate: string;
      }) => Promise<void>)
    | undefined;
  readonly onRegisterPartner?:
    | ((input: {
        partnerId: string;
        fullName: string;
        phone: string;
        profession: string;
        notes?: string;
      }) => Promise<void>)
    | undefined;
  readonly onTransitionPartnerStage?:
    | ((partnerId: string, newStage: string) => Promise<void>)
    | undefined;
  readonly onRecordReferral?:
    | ((input: {
        partnerId: string;
        referralId: string;
        companyName: string;
        taxCode: string;
        productCodes: string[];
      }) => Promise<void>)
    | undefined;
  readonly onRecordConversion?:
    | ((input: {
        conversionId: string;
        referralId: string;
        contractRevenueVnd: number;
        commissionRatePercent: number;
        policyReferenceNote?: string;
      }) => Promise<void>)
    | undefined;
  readonly onMarkConversionPaid?:
    | ((conversionId: string, payoutReference: string) => Promise<void>)
    | undefined;
  readonly onCreateOutreachBatch?:
    | ((input: {
        batchName: string;
        templateCode: string;
        leadIds: string[];
      }) => Promise<void>)
    | undefined;
  readonly onRunNextOutreachTask?:
    | ((batchId: string) => Promise<void>)
    | undefined;
}

function extractCampaignOverview(data: unknown): {
  readonly groups: readonly GroupSummaryItem[];
  readonly campaigns: readonly CampaignSummaryItem[];
  readonly partners: readonly PartnerSummaryItem[];
  readonly referrals: readonly ReferralSummaryItem[];
  readonly conversions: readonly ConversionSummaryItem[];
  readonly leads: readonly LeadItem[];
  readonly groupJobs: readonly GroupPostingJobItem[];
  readonly accounts: readonly SocialAccountItem[];
  readonly activeOutreachBatch?: ActiveOutreachBatch | undefined;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      groups: [],
      campaigns: [],
      partners: [],
      referrals: [],
      conversions: [],
      leads: [],
      groupJobs: [],
      accounts: [],
    };
  }
  const record = data as {
    groups?: unknown;
    campaigns?: unknown;
    partners?: unknown;
    referrals?: unknown;
    conversions?: unknown;
    leads?: unknown;
    groupJobs?: unknown;
    accounts?: unknown;
    activeOutreachBatch?: unknown;
  };
  return {
    groups: Array.isArray(record.groups)
      ? (record.groups as readonly GroupSummaryItem[])
      : [],
    campaigns: Array.isArray(record.campaigns)
      ? (record.campaigns as readonly CampaignSummaryItem[])
      : [],
    partners: Array.isArray(record.partners)
      ? (record.partners as readonly PartnerSummaryItem[])
      : [],
    referrals: Array.isArray(record.referrals)
      ? (record.referrals as readonly ReferralSummaryItem[])
      : [],
    conversions: Array.isArray(record.conversions)
      ? (record.conversions as readonly ConversionSummaryItem[])
      : [],
    leads: Array.isArray(record.leads)
      ? (record.leads as readonly LeadItem[])
      : [],
    groupJobs: Array.isArray(record.groupJobs)
      ? (record.groupJobs as readonly GroupPostingJobItem[])
      : [],
    accounts: Array.isArray(record.accounts)
      ? (record.accounts as readonly SocialAccountItem[])
      : [],
    activeOutreachBatch: record.activeOutreachBatch as ActiveOutreachBatch | undefined,
  };
}

export function CampaignView({
  data,
  onApproveCampaign,
  onDispatchCampaign,
  onRunGroupJob,
  onBulkImportGroups,
  onRegisterGroup,
  onCreateCampaign,
  onRegisterPartner,
  onTransitionPartnerStage,
  onRecordReferral,
  onRecordConversion,
  onMarkConversionPaid,
  onCreateOutreachBatch,
  onRunNextOutreachTask,
}: CampaignViewProps) {
  const {
    groups,
    campaigns,
    partners,
    referrals,
    conversions,
    leads,
    groupJobs,
    accounts,
    activeOutreachBatch,
  } = extractCampaignOverview(data);

  // Sub-tab navigation state
  const [activeSubTab, setActiveSubTab] = useState<"ALL" | "CAMPAIGNS_GROUPS" | "PARTNERS" | "ZALO">("ALL");

  // Form states for Dispatch Modal & Group Jobs
  const [dispatchModalCampaignId, setDispatchModalCampaignId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [bulkGroupText, setBulkGroupText] = useState<string>("");
  const [isBulkImporting, setIsBulkImporting] = useState<boolean>(false);

  // Form states for Zalo Outreach
  const [outreachBatchName, setOutreachBatchName] = useState("");
  const [outreachTemplate, setOutreachTemplate] = useState("ZALO_DNMTL_INTRO_V1");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [outreachFormError, setOutreachFormError] = useState<string | null>(null);

  // Form states for Campaign
  const [campId, setCampId] = useState("");
  const [campName, setCampName] = useState("");
  const [campType, setCampType] = useState<"PARTNER_RECRUITMENT" | "SME_SOLUTION_SHARING">("PARTNER_RECRUITMENT");
  const [campCategory, setCampCategory] = useState("ACCOUNTING_TAX");
  const [campTemplate, setCampTemplate] = useState("");

  // Form states for Partner
  const [partId, setPartId] = useState("");
  const [partName, setPartName] = useState("");
  const [partPhone, setPartPhone] = useState("");
  const [partProfession, setPartProfession] = useState("ACCOUNTANT");
  const [partNotes, setPartNotes] = useState("");

  // Form states for Community Group (PC-P01)
  const [grpId, setGrpId] = useState("");
  const [grpPlatform, setGrpPlatform] = useState<"ZALO" | "FACEBOOK">("ZALO");
  const [grpName, setGrpName] = useState("");
  const [grpUrl, setGrpUrl] = useState("");
  const [grpPermission, setGrpPermission] = useState("ALLOWED");

  // Form states for SME Referral (PC-P02)
  const activePartners = partners.filter((p) => p.stage === "ACTIVE_PARTNER");
  const [refPartnerId, setRefPartnerId] = useState("");
  const [refId, setRefId] = useState("");
  const [refCompany, setRefCompany] = useState("");
  const [refTaxCode, setRefTaxCode] = useState("");
  const [refProducts, setRefProducts] = useState("CA,SINVOICE");
  const [activeConvertModal, setActiveConvertModal] = useState<{
    referral: ReferralSummaryItem;
    revenue: number;
    commissionRate: number;
    policyNote: string;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegisterGrp(e: FormEvent) {
    e.preventDefault();
    if (!grpId.trim() || !grpName.trim() || !grpUrl.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onRegisterGroup?.({
        groupId: grpId.trim(),
        platform: grpPlatform,
        name: grpName.trim(),
        url: grpUrl.trim(),
        postingPermission: grpPermission,
      });
      setGrpId("");
      setGrpName("");
      setGrpUrl("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecordRef(e: FormEvent) {
    e.preventDefault();
    const targetPartnerId =
      refPartnerId || activePartners[0]?.partnerId || partners[0]?.partnerId || "";
    if (
      !targetPartnerId ||
      !refId.trim() ||
      !refCompany.trim() ||
      !refTaxCode.trim() ||
      isSubmitting
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onRecordReferral?.({
        partnerId: targetPartnerId,
        referralId: refId.trim(),
        companyName: refCompany.trim(),
        taxCode: refTaxCode.trim(),
        productCodes: refProducts
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setRefId("");
      setRefCompany("");
      setRefTaxCode("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateOutreach(e: FormEvent) {
    e.preventDefault();
    setOutreachFormError(null);
    if (!outreachBatchName.trim() || isSubmitting) return;

    const availableIds =
      selectedLeadIds.length > 0 ? selectedLeadIds : leads.map((l) => l.id);

    if (availableIds.length === 0) {
      setOutreachFormError("Vui lòng chọn ít nhất 1 khách hàng tiềm năng để khởi tạo đợt tiếp cận Zalo.");
      return;
    }

    // Zalo Anti-Ban Quota Ceiling: Max 30 leads per batch
    const MAX_ZALO_BATCH_LEADS = 30;
    const targetIds = availableIds.slice(0, MAX_ZALO_BATCH_LEADS);

    setIsSubmitting(true);
    try {
      await onCreateOutreachBatch?.({
        batchName: outreachBatchName.trim(),
        templateCode: outreachTemplate,
        leadIds: targetIds,
      });
      setOutreachBatchName("");
      setSelectedLeadIds([]);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateCamp(e: FormEvent) {
    e.preventDefault();
    if (!campId.trim() || !campName.trim() || !campTemplate.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onCreateCampaign?.({
        campaignId: campId.trim(),
        name: campName.trim(),
        campaignType: campType,
        targetCategories: [campCategory],
        contentTemplate: campTemplate.trim(),
      });
      setCampId("");
      setCampName("");
      setCampTemplate("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegisterPart(e: FormEvent) {
    e.preventDefault();
    if (!partId.trim() || !partName.trim() || !partPhone.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onRegisterPartner?.({
        partnerId: partId.trim(),
        fullName: partName.trim(),
        phone: partPhone.trim(),
        profession: partProfession,
        ...(partNotes.trim() ? { notes: partNotes.trim() } : {}),
      });
      setPartId("");
      setPartName("");
      setPartPhone("");
      setPartNotes("");
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleOpenDispatchModal = (campaignId: string) => {
    setDispatchModalCampaignId(campaignId);
    const fbAcc = accounts.find((a) => a.platform === "FACEBOOK");
    setSelectedAccountId(fbAcc ? fbAcc.accountId : accounts[0]?.accountId || "fb-viettel-sme");
    setSelectedGroupIds(groups.map((g) => g.groupId));
  };

  const handleConfirmDispatch = async () => {
    if (!dispatchModalCampaignId) return;
    setIsSubmitting(true);
    try {
      await onDispatchCampaign?.(dispatchModalCampaignId, {
        accountId: selectedAccountId,
        groupIds: selectedGroupIds,
      });
      setDispatchModalCampaignId(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0, maxWidth: "100%" }}>
      {dispatchModalCampaignId && (
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
              maxWidth: 520,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
                  Điều phối đăng bài lên nhóm
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
                  Chiến dịch:{" "}
                  <strong>
                    {campaigns.find((c) => c.campaignId === dispatchModalCampaignId)?.name || dispatchModalCampaignId}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDispatchModalCampaignId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}
              >
                ✕
              </button>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
              Tài khoản đăng bài
              <select
                aria-label="Tài khoản đăng bài"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1" }}
              >
                {accounts.length > 0 ? (
                  accounts.map((acc) => (
                    <option key={acc.accountId} value={acc.accountId}>
                      [{acc.platform}] {acc.accountId} ({acc.status})
                    </option>
                  ))
                ) : (
                  <>
                    <option value="fb-viettel-sme">[FACEBOOK] fb-viettel-sme (CONNECTED)</option>
                    <option value="zalo-dian-am01">[ZALO] zalo-dian-am01 (CONNECTED)</option>
                  </>
                )}
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Chọn nhóm đăng bài ({selectedGroupIds.length}/{groups.length} đã chọn):
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedGroupIds.length === groups.length) {
                      setSelectedGroupIds([]);
                    } else {
                      setSelectedGroupIds(groups.map((g) => g.groupId));
                    }
                  }}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12 }}
                >
                  {selectedGroupIds.length === groups.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
              </div>
              <div
                style={{
                  maxHeight: 180,
                  overflowY: "auto",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {groups.length > 0 ? (
                  groups.map((g) => (
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
                        <strong>[{g.platform}] {g.name}</strong> ({g.category})
                      </span>
                    </label>
                  ))
                ) : (
                  <span style={{ color: "#94a3b8", fontSize: 13 }}>Chưa có nhóm nào trong hệ thống.</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setDispatchModalCampaignId(null)}
                style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc" }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmDispatch}
                disabled={!selectedAccountId || selectedGroupIds.length === 0}
              >
                Xác nhận điều phối
              </button>
            </div>
          </div>
        </div>
      )}
      {/* SUB-TAB FILTER NAVIGATION */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSubTab("ALL")}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            border: activeSubTab === "ALL" ? "1px solid #0d9488" : "1px solid #cbd5e1",
            backgroundColor: activeSubTab === "ALL" ? "#0d9488" : "#ffffff",
            color: activeSubTab === "ALL" ? "#ffffff" : "#475569",
          }}
        >
          📋 Tất cả
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("CAMPAIGNS_GROUPS")}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            border: activeSubTab === "CAMPAIGNS_GROUPS" ? "1px solid #0d9488" : "1px solid #cbd5e1",
            backgroundColor: activeSubTab === "CAMPAIGNS_GROUPS" ? "#0d9488" : "#ffffff",
            color: activeSubTab === "CAMPAIGNS_GROUPS" ? "#ffffff" : "#475569",
          }}
        >
          📢 Chiến dịch & Hội nhóm
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("PARTNERS")}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            border: activeSubTab === "PARTNERS" ? "1px solid #0d9488" : "1px solid #cbd5e1",
            backgroundColor: activeSubTab === "PARTNERS" ? "#0d9488" : "#ffffff",
            color: activeSubTab === "PARTNERS" ? "#ffffff" : "#475569",
          }}
        >
          🤝 Mạng lưới CTV & Đối soát
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("ZALO")}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            border: activeSubTab === "ZALO" ? "1px solid #0d9488" : "1px solid #cbd5e1",
            backgroundColor: activeSubTab === "ZALO" ? "#0d9488" : "#ffffff",
            color: activeSubTab === "ZALO" ? "#ffffff" : "#475569",
          }}
        >
          💬 Tiếp cận Zalo Cá nhân
        </button>
      </div>

      {(activeSubTab === "ALL" || activeSubTab === "CAMPAIGNS_GROUPS") && (
        <>
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "#f0fdfa",
              border: "1px solid #99f6e4",
              borderRadius: 8,
              fontSize: 13,
              color: "#0f766e",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>
              💡 <strong>Đăng bài tự động đa luồng Facebook:</strong> Quản lý kho bài viết, nhóm mục tiêu và đăng tự động kèm chống Checkpoint (Spin-tax, delay) tại tab <strong>Auto Poster Facebook</strong>.
            </span>
          </div>
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
                    <th>Mã</th>
                    <th>Tên chiến dịch</th>
                    <th>Nhóm mục tiêu</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.campaignId}>
                      <td>{c.campaignId}</td>
                      <td>{c.name}</td>
                      <td>{c.targetCategories.join(", ")}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            backgroundColor: c.status === "APPROVED" ? "#ecfdf5" : "#fffbeb",
                            color: c.status === "APPROVED" ? "#059669" : "#d97706",
                          }}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td>
                        {c.status === "DRAFT" ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onApproveCampaign?.(c.campaignId)}
                          >
                            Phê duyệt
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => handleOpenDispatchModal(c.campaignId)}
                          >
                            Điều phối đăng nhóm
                          </button>
                        )}
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
            <h2>Tạo chiến dịch mới</h2>
            <span className="muted">Thiết lập thông điệp tiếp cận nhóm</span>
          </div>
          <form onSubmit={handleCreateCamp} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <label>
              Mã chiến dịch
              <input
                type="text"
                placeholder="ví dụ: CAMP-DIAN-03"
                value={campId}
                onChange={(e) => setCampId(e.target.value)}
                required
              />
            </label>
            <label>
              Tên chiến dịch
              <input
                type="text"
                placeholder="ví dụ: Tuyển CTV Kế toán Thuế KCN Sóng Thần"
                value={campName}
                onChange={(e) => setCampName(e.target.value)}
                required
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label>
                Loại chiến dịch
                <select
                  value={campType}
                  onChange={(e) => setCampType(e.target.value as "PARTNER_RECRUITMENT" | "SME_SOLUTION_SHARING")}
                >
                  <option value="PARTNER_RECRUITMENT">Tuyển dụng CTV</option>
                  <option value="SME_SOLUTION_SHARING">Chia sẻ giải pháp SME</option>
                </select>
              </label>
              <label>
                Nhóm đối tượng
                <select
                  value={campCategory}
                  onChange={(e) => setCampCategory(e.target.value)}
                >
                  <option value="ACCOUNTING_TAX">Hội Kế toán - Thuế</option>
                  <option value="BANKING_FINANCE">Ngân hàng - Tín dụng</option>
                  <option value="BUSINESS_ASSOCIATION">Hiệp hội Doanh nghiệp</option>
                  <option value="STARTUP_SME">Cộng đồng Startup &amp; SME</option>
                </select>
              </label>
            </div>
            <label>
              Mẫu nội dung tiếp cận
              <textarea
                rows={3}
                placeholder="Chào quý anh/chị kế toán, Viettel Dĩ An kính mời hợp tác tuyển CTV chiết khấu hấp dẫn..."
                value={campTemplate}
                onChange={(e) => setCampTemplate(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={isSubmitting || !campId.trim() || !campName.trim()}>
              {isSubmitting ? "Đang tạo…" : "Tạo chiến dịch"}
            </button>
          </form>
        </div>
      </section>

      {/* THEO DÕI & LỊCH SỬ ĐĂNG BÀI NHÓM */}
      <section className="panel">
        <div className="panel-heading">
          <h2>Theo Dõi &amp; Lịch Sử Đăng Bài Nhóm</h2>
          <span className="muted">
            Theo dõi tiến trình đăng bài Playwright, phê duyệt admin và link bài viết thực tế
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên Nhóm / URL</th>
                <th>Tài khoản</th>
                <th>Thời gian</th>
                <th>Trạng thái</th>
                <th>Link bài viết</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {groupJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8", padding: "24px 0" }}>
                    Chưa có bài đăng nhóm nào được điều phối. Hãy bấm &quot;Điều phối đăng nhóm&quot; ở bảng chiến dịch bên trên.
                  </td>
                </tr>
              ) : (
                groupJobs.map((j) => (
                  <tr key={j.jobId}>
                    <td>
                      <div><strong>{j.groupName}</strong></div>
                      <a href={j.groupUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>
                        {j.groupUrl}
                      </a>
                    </td>
                    <td>{j.accountId}</td>
                    <td style={{ fontSize: 12 }}>
                      {j.executedAt ? new Date(j.executedAt).toLocaleTimeString() : new Date(j.dispatchedAt).toLocaleTimeString()}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          backgroundColor:
                            j.status === "PUBLISHED"
                              ? "#ecfdf5"
                              : j.status === "PENDING_APPROVAL"
                                ? "#fffbeb"
                                : j.status === "RUNNING"
                                  ? "#fef3c7"
                                  : j.status === "FAILED"
                                    ? "#fef2f2"
                                    : "#eff6ff",
                          color:
                            j.status === "PUBLISHED"
                              ? "#059669"
                              : j.status === "PENDING_APPROVAL"
                                ? "#d97706"
                                : j.status === "RUNNING"
                                  ? "#b45309"
                                  : j.status === "FAILED"
                                    ? "#dc2626"
                                    : "#2563eb",
                        }}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td>
                      {j.postUrl ? (
                        <a
                          href={j.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#059669", fontWeight: 600, fontSize: 13 }}
                        >
                          Xem bài viết ↗
                        </a>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      {j.status === "QUEUED" || j.status === "FAILED" ? (
                        <button
                          type="button"
                          className="primary"
                          style={{ fontSize: 12, padding: "4px 8px" }}
                          onClick={() => onRunGroupJob?.(j.jobId)}
                        >
                          Chạy đăng bài
                        </button>
                      ) : (
                        <span style={{ color: "#059669", fontSize: 12 }}>Hoàn tất</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>
      )}

      {(activeSubTab === "ALL" || activeSubTab === "PARTNERS") && (
      <section className="panel-grid">
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
                    <th>Giới thiệu</th>
                    <th>Hoa hồng dự kiến</th>
                    <th>Chuyển giai đoạn</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => (
                    <tr key={p.partnerId}>
                      <td>
                        <strong>{p.fullName}</strong>
                        <br />
                        <span className="fine-print">{p.partnerId}</span>
                      </td>
                      <td>{p.phoneMasked}</td>
                      <td>{p.profession}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            backgroundColor:
                              p.stage === "ACTIVE_PARTNER"
                                ? "#ecfdf5"
                                : p.stage === "CONTACTED"
                                  ? "#eff6ff"
                                  : "#fffbeb",
                            color:
                              p.stage === "ACTIVE_PARTNER"
                                ? "#059669"
                                : p.stage === "CONTACTED"
                                  ? "#2563eb"
                                  : "#d97706",
                          }}
                        >
                          {p.stage}
                        </span>
                      </td>
                      <td>{p.totalReferrals} lead</td>
                      <td>{p.approvedPendingCommissionVnd.toLocaleString("vi-VN")} đ</td>
                      <td>
                        {p.stage === "NEW" && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => onTransitionPartnerStage?.(p.partnerId, "CONTACTED")}
                          >
                            Đã liên hệ
                          </button>
                        )}
                        {p.stage === "CONTACTED" && (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => onTransitionPartnerStage?.(p.partnerId, "ACTIVE_PARTNER")}
                          >
                            Kích hoạt CTV
                          </button>
                        )}
                        {p.stage === "ACTIVE_PARTNER" && (
                          <span className="muted">CTV Hoạt động</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Chưa có cộng tác viên nào được ghi nhận.</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Đăng ký đối tác CTV mới</h2>
            <span className="muted">Ghi nhận thông tin &amp; bảo vệ PII</span>
          </div>
          <form onSubmit={handleRegisterPart} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <label>
              Mã CTV
              <input
                type="text"
                placeholder="ví dụ: CTV-DIAN-02"
                value={partId}
                onChange={(e) => setPartId(e.target.value)}
                required
              />
            </label>
            <label>
              Họ và tên
              <input
                type="text"
                placeholder="ví dụ: Trần Thị Mai"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                required
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label>
                Số điện thoại
                <input
                  type="tel"
                  placeholder="09..."
                  value={partPhone}
                  onChange={(e) => setPartPhone(e.target.value)}
                  required
                />
              </label>
              <label>
                Nghề nghiệp / Lĩnh vực
                <select
                  value={partProfession}
                  onChange={(e) => setPartProfession(e.target.value)}
                >
                  <option value="ACCOUNTANT">Kế toán / Thuế</option>
                  <option value="BANK_RM">Chuyên viên Ngân hàng</option>
                  <option value="BUSINESS_CONSULTANT">Tư vấn Doanh nghiệp</option>
                  <option value="IT_AGENCY">Đại lý CNTT</option>
                  <option value="OTHER">Khác</option>
                </select>
              </label>
            </div>
            <label>
              Ghi chú nghiệp vụ
              <input
                type="text"
                placeholder="ví dụ: Kế toán trưởng công ty may mặc Dĩ An"
                value={partNotes}
                onChange={(e) => setPartNotes(e.target.value)}
              />
            </label>
            <button className="primary" disabled={isSubmitting || !partId.trim() || !partName.trim() || !partPhone.trim()}>
              {isSubmitting ? "Đang đăng ký…" : "Đăng ký Cộng tác viên"}
            </button>
          </form>
        </div>
      </section>
      )}

      {/* DANH MỤC HỘI NHÓM CỘNG ĐỒNG (MOD-PC-003) */}
      {(activeSubTab === "ALL" || activeSubTab === "CAMPAIGNS_GROUPS") && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Danh mục Hội nhóm Cộng đồng</h2>
            <span className="muted">Tự động phân loại &amp; kiểm tra quyền đăng</span>
          </div>
          {groups.length > 0 ? (
            <div className="table-wrap" style={{ marginBottom: "12px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Tên nhóm</th>
                    <th>Nền tảng</th>
                    <th>Danh mục</th>
                    <th>Quyền đăng</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.groupId}>
                      <td>{g.name}</td>
                      <td>{g.platform}</td>
                      <td>{g.category}</td>
                      <td>{g.postingPermission}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Chưa có hội nhóm cộng đồng nào.</p>
          )}
          <form onSubmit={handleRegisterGrp} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <input
                type="text"
                placeholder="ví dụ: grp_ketoan_dian"
                value={grpId}
                onChange={(e) => setGrpId(e.target.value)}
                required
              />
              <select
                value={grpPlatform}
                onChange={(e) => setGrpPlatform(e.target.value as "ZALO" | "FACEBOOK")}
              >
                <option value="ZALO">Zalo Group</option>
                <option value="FACEBOOK">Facebook Group</option>
              </select>
            </div>
            <input
              type="text"
              placeholder="ví dụ: Hội Doanh nhân Trẻ Dĩ An"
              value={grpName}
              onChange={(e) => setGrpName(e.target.value)}
              required
            />
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
              <input
                type="url"
                placeholder="https://zalo.me/g/..."
                value={grpUrl}
                onChange={(e) => setGrpUrl(e.target.value)}
                required
              />
              <select
                value={grpPermission}
                onChange={(e) => setGrpPermission(e.target.value)}
              >
                <option value="ALLOWED">ALLOWED</option>
                <option value="MODERATED_ALLOWED">MODERATED_ALLOWED</option>
                <option value="READ_ONLY">READ_ONLY</option>
              </select>
            </div>
            <button className="secondary" disabled={isSubmitting || !grpId.trim() || !grpName.trim() || !grpUrl.trim()}>
              Thêm hội nhóm
            </button>
          </form>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px dashed #cbd5e1" }}>
            <h4 style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#334155" }}>
              Nhập nhanh danh sách nhóm Facebook
            </h4>
            <span className="muted" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
              Dán danh sách nhiều URL nhóm để thêm hàng loạt (tự động phân tích tên &amp; phân loại)
            </span>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const urls = bulkGroupText
                  .split("\n")
                  .map((u) => u.trim())
                  .filter(Boolean);
                if (urls.length > 0) {
                  setIsBulkImporting(true);
                  try {
                    await onBulkImportGroups?.(urls);
                    setBulkGroupText("");
                  } finally {
                    setIsBulkImporting(false);
                  }
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <textarea
                rows={3}
                placeholder="Dán danh sách link nhóm Facebook (mỗi dòng một link, ví dụ: https://www.facebook.com/groups/...)"
                value={bulkGroupText}
                onChange={(e) => setBulkGroupText(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
              <button
                type="submit"
                className="secondary"
                disabled={isBulkImporting || !bulkGroupText.trim()}
              >
                {isBulkImporting ? "Đang nạp nhóm..." : "Thêm danh sách nhóm"}
              </button>
            </form>
          </div>
        </section>
      )}

      {/* GIỚI THIỆU SME & CHI TRẢ HOA HỒNG CTV */}
      {(activeSubTab === "ALL" || activeSubTab === "PARTNERS") && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Giới thiệu SME &amp; Chi trả Hoa hồng CTV</h2>
            <span className="muted">Chống trùng MST · Xác nhận chi trả UNC</span>
          </div>
          <form onSubmit={handleRecordRef} style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <select
                value={refPartnerId || activePartners[0]?.partnerId || partners[0]?.partnerId || ""}
                onChange={(e) => setRefPartnerId(e.target.value)}
              >
                {partners.map((p) => (
                  <option key={p.partnerId} value={p.partnerId}>
                    {p.fullName} ({p.partnerId})
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="ví dụ: REF-2026-01"
                value={refId}
                onChange={(e) => setRefId(e.target.value)}
                required
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
              <input
                type="text"
                placeholder="ví dụ: Công ty TNHH Sản xuất Tân Bình"
                value={refCompany}
                onChange={(e) => setRefCompany(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="ví dụ: 3701234567"
                value={refTaxCode}
                onChange={(e) => setRefTaxCode(e.target.value)}
                required
              />
            </div>
            <input
              type="text"
              placeholder="Mã dịch vụ (CA,SINVOICE)"
              value={refProducts}
              onChange={(e) => setRefProducts(e.target.value)}
            />
            <button className="primary" disabled={isSubmitting || !refId.trim() || !refCompany.trim() || !refTaxCode.trim()}>
              Ghi nhận giới thiệu SME
            </button>
          </form>

          {referrals.length > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 8px 0" }}>
                Danh sách SME được giới thiệu ({referrals.length})
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mã Referral</th>
                      <th>Doanh nghiệp</th>
                      <th>Mã số thuế</th>
                      <th>Dịch vụ</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((ref) => (
                      <tr key={ref.referralId}>
                        <td><code>{ref.referralId}</code></td>
                        <td><strong>{ref.companyName}</strong></td>
                        <td>{ref.normalizedTaxCode}</td>
                        <td>{ref.productCodes.join(", ") || "—"}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: ref.status === "CONVERTED" ? "#ecfdf5" : "#eff6ff",
                              color: ref.status === "CONVERTED" ? "#059669" : "#2563eb",
                            }}
                          >
                            {ref.status}
                          </span>
                        </td>
                        <td>
                          {ref.status === "REFERRED" ? (
                            <button
                              type="button"
                              className="primary"
                              style={{ fontSize: "12px", padding: "4px 8px" }}
                              onClick={() =>
                                setActiveConvertModal({
                                  referral: ref,
                                  revenue: 5000000,
                                  commissionRate: 10,
                                  policyNote: "Chính sách hoa hồng CTV Q4/2026",
                                })
                              }
                            >
                              Chốt hợp đồng &amp; Hoa hồng
                            </button>
                          ) : (
                            <span className="muted">Đã tạo Hợp đồng</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {conversions.length > 0 && (
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 8px 0" }}>
                Danh sách Hoa hồng CTV chờ chi trả ({conversions.length})
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mã HĐ</th>
                      <th>Doanh thu</th>
                      <th>Hoa hồng</th>
                      <th>Trạng thái</th>
                      <th>Chi trả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversions.map((conv) => (
                      <tr key={conv.conversionId}>
                        <td><code>{conv.conversionId}</code></td>
                        <td>{conv.contractRevenueVnd.toLocaleString("vi-VN")} đ</td>
                        <td><strong>{conv.commissionAmountVnd.toLocaleString("vi-VN")} đ</strong></td>
                        <td>{conv.payoutStatus}</td>
                        <td>
                          {conv.payoutStatus === "APPROVED_PENDING_PAYOUT" ? (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                onMarkConversionPaid?.(
                                  conv.conversionId,
                                  `UNC-${conv.conversionId}`,
                                )
                              }
                            >
                              Xác nhận đã chi trả
                            </button>
                          ) : (
                            <span className="muted">{conv.payoutReference ?? "Đã chi"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeConvertModal && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: "12px",
                  padding: "24px",
                  maxWidth: "480px",
                  width: "90%",
                  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0" }}>
                  Chốt Hợp đồng &amp; Ghi nhận Hoa hồng CTV
                </h3>
                <p className="muted" style={{ fontSize: "13px", marginBottom: "16px" }}>
                  Doanh nghiệp: <strong>{activeConvertModal.referral.companyName}</strong> (MST: {activeConvertModal.referral.normalizedTaxCode})
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (isSubmitting) return;
                    setIsSubmitting(true);
                    try {
                      await onRecordConversion?.({
                        conversionId: `conv_${Date.now()}`,
                        referralId: activeConvertModal.referral.referralId,
                        contractRevenueVnd: activeConvertModal.revenue,
                        commissionRatePercent: activeConvertModal.commissionRate,
                        policyReferenceNote: activeConvertModal.policyNote,
                      });
                      setActiveConvertModal(null);
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                >
                  <label>
                    Doanh thu Hợp đồng (VNĐ)
                    <input
                      type="number"
                      min={100000}
                      step={100000}
                      value={activeConvertModal.revenue}
                      onChange={(e) =>
                        setActiveConvertModal({
                          ...activeConvertModal,
                          revenue: Number(e.target.value),
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    Tỷ lệ Hoa hồng CTV (%)
                    <input
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      value={activeConvertModal.commissionRate}
                      onChange={(e) =>
                        setActiveConvertModal({
                          ...activeConvertModal,
                          commissionRate: Number(e.target.value),
                        })
                      }
                      required
                    />
                  </label>
                  <p style={{ fontSize: "13px", color: "#059669", fontWeight: 600, margin: 0 }}>
                    💰 Hoa hồng ước tính: {((activeConvertModal.revenue * activeConvertModal.commissionRate) / 100).toLocaleString("vi-VN")} đ
                  </p>
                  <label>
                    Căn cứ chính sách
                    <input
                      type="text"
                      value={activeConvertModal.policyNote}
                      onChange={(e) =>
                        setActiveConvertModal({
                          ...activeConvertModal,
                          policyNote: e.target.value,
                        })
                      }
                    />
                  </label>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setActiveConvertModal(null)}
                      disabled={isSubmitting}
                    >
                      Hủy
                    </button>
                    <button type="submit" className="primary" disabled={isSubmitting}>
                      {isSubmitting ? "Đang xử lý..." : "Xác nhận tạo Conversion"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>
      )}

      {/* CHIẾN DỊCH TIẾP CẬN ZALO CÁ NHÂN (DNMTL AUTOMATION) */}
      {(activeSubTab === "ALL" || activeSubTab === "ZALO") && (
      <section className="panel-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>Chiến dịch Tiếp cận Zalo Cá nhân</h2>
            <span className="muted">Tự động kết bạn &amp; gửi tin nhắn chào giải pháp Viettel-CA / S-Invoice</span>
          </div>

          {activeOutreachBatch ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <h3 style={{ margin: 0 }}>{activeOutreachBatch.batchName}</h3>
                  <span className="badge" style={{ background: "#0284c7", color: "#fff", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold" }}>
                    {activeOutreachBatch.summary.sent} / {activeOutreachBatch.summary.total} đã gửi
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <span>Chờ xử lý: <strong>{activeOutreachBatch.summary.queued}</strong></span>
                  <span>Đã kết bạn: <strong>{activeOutreachBatch.summary.friendRequested}</strong></span>
                  <span>Không có Zalo: <strong>{activeOutreachBatch.summary.notFound}</strong></span>
                  <span>Bỏ qua (Opt-out): <strong>{activeOutreachBatch.summary.skipped}</strong></span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="primary"
                  disabled={isSubmitting || activeOutreachBatch.summary.queued === 0}
                  onClick={async () => {
                    setIsSubmitting(true);
                    try {
                      await onRunNextOutreachTask?.(activeOutreachBatch.batchId);
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                >
                  {isSubmitting ? "Đang gửi qua Zalo..." : "Tiếp cận 1 khách tiếp theo"}
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Doanh nghiệp</th>
                      <th>Số điện thoại</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOutreachBatch.tasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.companyName}</td>
                        <td>{task.phone}</td>
                        <td>
                          <span className={`status-pill ${task.status.toLowerCase()}`}>
                            {task.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="empty">Chưa có đợt tiếp cận Zalo nào đang kích hoạt. Hãy tạo một đợt tiếp cận mới từ danh sách khách hàng tiềm năng.</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Tạo đợt tiếp cận Zalo DNMTL mới</h2>
            <span className="muted">Gán danh sách Lead và kịch bản tin nhắn tự động</span>
          </div>
          <form onSubmit={handleCreateOutreach} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {outreachFormError && (
              <div style={{ color: "#ef4444", fontSize: "13px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", padding: "6px 10px", borderRadius: "4px" }}>
                {outreachFormError}
              </div>
            )}
            <label>
              Tên đợt tiếp cận
              <input
                type="text"
                placeholder="ví dụ: Tiếp cận DN mới thành lập Dĩ An Tháng 11"
                value={outreachBatchName}
                onChange={(e) => {
                  setOutreachBatchName(e.target.value);
                  if (outreachFormError) setOutreachFormError(null);
                }}
                required
              />
            </label>
            <label style={{ minWidth: 0, maxWidth: "100%" }}>
              Kịch bản tin nhắn (Template)
              <select
                value={outreachTemplate}
                onChange={(e) => setOutreachTemplate(e.target.value)}
                style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
              >
                <option value="ZALO_DNMTL_INTRO_V1">Chào DNMTL: Viettel-CA &amp; S-Invoice</option>
                <option value="ZALO_ACCOUNTING_PARTNER_V1">Mời đối tác Kế toán / CTV</option>
              </select>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>
                Chọn khách hàng ({selectedLeadIds.length > 0 ? selectedLeadIds.length : leads.length}/{leads.length} đã chọn):
              </span>
              <div style={{ maxHeight: "150px", overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "8px" }}>
                {leads.length > 0 ? (
                  leads.map((lead) => (
                    <label key={lead.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", margin: "4px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.length === 0 || selectedLeadIds.includes(lead.id)}
                        onChange={(e) => {
                          const currentSelected = selectedLeadIds.length === 0 ? leads.map((l) => l.id) : selectedLeadIds;
                          if (e.target.checked) {
                            setSelectedLeadIds([...currentSelected, lead.id]);
                          } else {
                            setSelectedLeadIds(currentSelected.filter((id) => id !== lead.id));
                          }
                        }}
                      />
                      <span><strong>{lead.companyName}</strong> ({lead.phone})</span>
                    </label>
                  ))
                ) : (
                  <span className="muted">Chưa có lead nào trong hệ thống. Hãy nạp file Excel ở tab Nhập Excel.</span>
                )}
              </div>
            </div>

            <button
              className="primary"
              disabled={isSubmitting || !outreachBatchName.trim()}
            >
              {isSubmitting ? "Đang tạo..." : "Khởi tạo đợt tiếp cận Zalo"}
            </button>
          </form>
        </div>
      </section>
      )}
    </div>
  );
}
