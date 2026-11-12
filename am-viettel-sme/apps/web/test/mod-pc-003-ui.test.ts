// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignView } from "../src/ui/campaign-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MOD-PC-003 Dashboard UI (CampaignView — Groups, Dispatch, Referrals & Commission Payout)", () => {
  it("renders community groups, dispatches approved campaigns, registers groups, records referrals, and processes commission payouts", async () => {
    const onDispatchCampaign = vi.fn(async () => {});
    const onRegisterGroup = vi.fn(async () => {});
    const onRecordReferral = vi.fn(async () => {});
    const onRecordConversion = vi.fn(async () => {});
    const onMarkConversionPaid = vi.fn(async () => {});

    const overviewData = {
      groups: [
        {
          groupId: "grp_kt_bd",
          platform: "ZALO",
          name: "Hội Kế toán Thuế Bình Dương",
          url: "https://zalo.me/g/ketoanbd",
          category: "ACCOUNTING_TAX",
          postingPermission: "ALLOWED",
          minHoursBetweenPosts: 24,
          active: true,
        },
      ],
      campaigns: [
        {
          campaignId: "CAMP-APPROVED-01",
          name: "Chiến dịch Tuyển CTV Kế toán Q4",
          status: "APPROVED",
          targetCategories: ["ACCOUNTING_TAX"],
        },
      ],
      partners: [
        {
          partnerId: "ctv_active_01",
          fullName: "Nguyễn Thị Hồng",
          phoneMasked: "0912***678",
          profession: "ACCOUNTANT",
          stage: "ACTIVE_PARTNER",
          totalReferrals: 1,
          approvedPendingCommissionVnd: 500000,
          paidCommissionVnd: 0,
        },
      ],
      referrals: [
        {
          referralId: "ref_ui_01",
          partnerId: "ctv_active_01",
          companyName: "Công ty TNHH Đại Phát",
          normalizedTaxCode: "3701122334",
          productCodes: ["CA", "SINVOICE"],
          status: "REFERRED",
        },
      ],
      conversions: [
        {
          conversionId: "conv_ui_01",
          referralId: "ref_ui_01",
          partnerId: "ctv_active_01",
          contractRevenueVnd: 5000000,
          commissionRatePercent: 10,
          commissionAmountVnd: 500000,
          payoutStatus: "APPROVED_PENDING_PAYOUT",
        },
      ],
      leads: [],
    };

    render(
      createElement(CampaignView, {
        data: overviewData,
        onDispatchCampaign,
        onRegisterGroup,
        onRecordReferral,
        onRecordConversion,
        onMarkConversionPaid,
      }),
    );

    // 1. Displays community group
    expect(screen.getByText("Hội Kế toán Thuế Bình Dương")).toBeTruthy();
    expect(screen.getAllByText("ALLOWED").length).toBeGreaterThanOrEqual(1);

    // 2. Dispatches approved campaign
    const dispatchBtn = screen.getByRole("button", {
      name: /Điều phối đăng nhóm/i,
    });
    fireEvent.click(dispatchBtn);
    const confirmDispatchBtn = screen.getByRole("button", {
      name: /Xác nhận điều phối/i,
    });
    fireEvent.click(confirmDispatchBtn);
    await vi.waitFor(() => {
      expect(onDispatchCampaign).toHaveBeenCalledWith(
        "CAMP-APPROVED-01",
        expect.objectContaining({
          accountId: expect.any(String),
          groupIds: expect.any(Array),
        }),
      );
    });

    // 3. Registers a new community group
    fireEvent.change(screen.getByPlaceholderText(/ví dụ: grp_ketoan_dian/i), {
      target: { value: "grp_sme_02" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/ví dụ: Hội Doanh nhân Trẻ Dĩ An/i),
      {
        target: { value: "Hội Doanh nhân Trẻ Dĩ An" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/zalo\.me\/g\//i), {
      target: { value: "https://zalo.me/g/doanhnhandian" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Thêm hội nhóm/i }));
    await vi.waitFor(() => {
      expect(onRegisterGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "grp_sme_02",
          name: "Hội Doanh nhân Trẻ Dĩ An",
          url: "https://zalo.me/g/doanhnhandian",
        }),
      );
    });

    // 4. Records an SME referral for an ACTIVE_PARTNER
    fireEvent.change(screen.getByPlaceholderText(/ví dụ: REF-2026-01/i), {
      target: { value: "REF-UI-02" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/ví dụ: Công ty TNHH Sản xuất Tân Bình/i),
      {
        target: { value: "Công ty TNHH Sản xuất Tân Bình" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText(/ví dụ: 3701234567/i), {
      target: { value: "3709988776" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Ghi nhận giới thiệu SME/i }),
    );
    await vi.waitFor(() => {
      expect(onRecordReferral).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: "ctv_active_01",
          referralId: "REF-UI-02",
          companyName: "Công ty TNHH Sản xuất Tân Bình",
          taxCode: "3709988776",
        }),
      );
    });

    // 5. Marks pending conversion as PAID
    fireEvent.click(
      screen.getByRole("button", { name: /Xác nhận đã chi trả/i }),
    );
    await vi.waitFor(() => {
      expect(onMarkConversionPaid).toHaveBeenCalledWith(
        "conv_ui_01",
        expect.any(String),
      );
    });
  });

  it("prevents creating Zalo outreach batch with 0 leads and caps at max 30 leads (Anti-Ban Guard)", async () => {
    const onCreateOutreachBatch = vi.fn(async () => {});

    // Render with 0 leads
    const { rerender } = render(
      createElement(CampaignView, {
        data: {
          groups: [],
          campaigns: [],
          partners: [],
          referrals: [],
          conversions: [],
          leads: [],
        },
        onCreateOutreachBatch,
      }),
    );

    // Enter batch name
    const batchNameInput = screen.getByPlaceholderText(/ví dụ: Tiếp cận DN mới thành lập/i);
    fireEvent.change(batchNameInput, { target: { value: "Đợt tiếp cận rỗng" } });

    // Submit form
    const submitBtn = screen.getByRole("button", { name: /Khởi tạo đợt tiếp cận Zalo/i });
    fireEvent.click(submitBtn);

    // Must NOT call onCreateOutreachBatch
    expect(onCreateOutreachBatch).not.toHaveBeenCalled();
    expect(screen.getByText(/Vui lòng chọn ít nhất 1 khách hàng tiềm năng/i)).toBeTruthy();

    // Now re-render with 35 leads
    const thirtyFiveLeads = Array.from({ length: 35 }, (_, i) => ({
      id: `lead-${i + 1}`,
      companyName: `Doanh nghiệp ${i + 1}`,
      phone: `09000000${i.toString().padStart(2, "0")}`,
    }));

    rerender(
      createElement(CampaignView, {
        data: {
          groups: [],
          campaigns: [],
          partners: [],
          referrals: [],
          conversions: [],
          leads: thirtyFiveLeads,
        },
        onCreateOutreachBatch,
      }),
    );

    fireEvent.change(screen.getByPlaceholderText(/ví dụ: Tiếp cận DN mới thành lập/i), {
      target: { value: "Đợt 35 lead" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Khởi tạo đợt tiếp cận Zalo/i }));

    // Must be called with capped 30 leads
    expect(onCreateOutreachBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchName: "Đợt 35 lead",
        leadIds: expect.arrayContaining(["lead-1", "lead-30"]),
      }),
    );
    const firstCall = onCreateOutreachBatch.mock.calls[0] as unknown as [
      { leadIds: string[] },
    ];
    expect(firstCall[0].leadIds.length).toBe(30);
  });

  it("renders sub-tab filter navigation and filters sections accordingly", () => {
    const overviewData = {
      groups: [
        {
          groupId: "grp_kt_bd",
          platform: "ZALO",
          name: "Hội Kế toán Thuế Bình Dương",
          url: "https://zalo.me/g/ketoanbd",
          category: "ACCOUNTING_TAX",
          postingPermission: "ALLOWED",
          minHoursBetweenPosts: 24,
          active: true,
        },
      ],
      campaigns: [
        {
          campaignId: "CAMP-APPROVED-01",
          name: "Chiến dịch Tuyển CTV Kế toán Q4",
          status: "APPROVED",
          targetCategories: ["ACCOUNTING_TAX"],
        },
      ],
      partners: [
        {
          partnerId: "ctv_active_01",
          fullName: "Nguyễn Thị Hồng",
          phoneMasked: "0912***678",
          profession: "ACCOUNTANT",
          stage: "ACTIVE_PARTNER",
          totalReferrals: 1,
          approvedPendingCommissionVnd: 500000,
          paidCommissionVnd: 0,
        },
      ],
      referrals: [],
      conversions: [],
      leads: [],
    };

    render(
      createElement(CampaignView, {
        data: overviewData,
      }),
    );

    // Verify sub-tab buttons exist
    const allTabBtn = screen.getByRole("button", { name: /Tất cả/i });
    const groupsTabBtn = screen.getByRole("button", { name: /Chiến dịch & Hội nhóm/i });
    const partnersTabBtn = screen.getByRole("button", { name: /Mạng lưới CTV & Đối soát/i });
    const zaloTabBtn = screen.getByRole("button", { name: /Tiếp cận Zalo Cá nhân/i });

    expect(allTabBtn).toBeTruthy();
    expect(groupsTabBtn).toBeTruthy();
    expect(partnersTabBtn).toBeTruthy();
    expect(zaloTabBtn).toBeTruthy();

    // In ALL tab: both campaigns and partner CRM are visible
    expect(screen.getByText("Chiến dịch Nhóm & Tuyển CTV")).toBeTruthy();
    expect(screen.getByText("Partner CRM & Đối soát CTV")).toBeTruthy();

    // Click Zalo Tab: only Zalo section is visible, campaigns & partners are hidden
    fireEvent.click(zaloTabBtn);
    expect(screen.queryByText("Chiến dịch Nhóm & Tuyển CTV")).toBeNull();
    expect(screen.queryByText("Partner CRM & Đối soát CTV")).toBeNull();
    expect(screen.getByText("Chiến dịch Tiếp cận Zalo Cá nhân")).toBeTruthy();

    // Click Partners Tab: partner CRM visible, campaigns & zalo hidden
    fireEvent.click(partnersTabBtn);
    expect(screen.queryByText("Chiến dịch Nhóm & Tuyển CTV")).toBeNull();
    expect(screen.getByText("Partner CRM & Đối soát CTV")).toBeTruthy();

    // Click All Tab: both back in DOM
    fireEvent.click(allTabBtn);
    expect(screen.getByText("Chiến dịch Nhóm & Tuyển CTV")).toBeTruthy();
    expect(screen.getByText("Partner CRM & Đối soát CTV")).toBeTruthy();
  });
});
