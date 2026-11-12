import { describe, expect, it } from "vitest";
import { GroupManager } from "../src/group-manager.js";
import { PartnerCrmService } from "../src/partner-crm.js";

describe("MOD-PC-003 Domain Enhancements — Cross-Partner Tax Code Deduplication & Partner/Group Analytics", () => {
  it("blocks duplicate taxCode referrals across different partners (DUPLICATE_REFERRAL_TAX_CODE) and supports listing referrals/conversions", () => {
    const crm = new PartnerCrmService();

    crm.registerPartner({
      partnerId: "ctv_01",
      fullName: "Nguyễn Thị An (Kế toán)",
      phone: "0912345678",
      profession: "ACCOUNTANT",
    });
    crm.transitionPartnerStage("ctv_01", "CONTACTED", "am_01");
    crm.transitionPartnerStage("ctv_01", "ACTIVE_PARTNER", "am_01");

    crm.registerPartner({
      partnerId: "ctv_02",
      fullName: "Trần Quốc Bảo (Bank RM)",
      phone: "0987654321",
      profession: "BANK_RM",
    });
    crm.transitionPartnerStage("ctv_02", "CONTACTED", "am_01");
    crm.transitionPartnerStage("ctv_02", "ACTIVE_PARTNER", "am_01");

    const ref1 = crm.recordReferral({
      referralId: "ref_101",
      partnerId: "ctv_01",
      companyName: "Công ty TNHH Đầu tư Đại Phát",
      taxCode: "3701122334 - 001",
      productCodes: ["CA", "SINVOICE"],
    });
    expect(ref1.normalizedTaxCode).toBe("3701122334-001");

    // Partner 2 tries to refer the same tax code with different formatting
    expect(() =>
      crm.recordReferral({
        referralId: "ref_102",
        partnerId: "ctv_02",
        companyName: "Công ty TNHH Đầu tư Đại Phát",
        taxCode: "3701122334-001",
        productCodes: ["CA"],
      }),
    ).toThrow(/DUPLICATE_REFERRAL_TAX_CODE:3701122334-001/);

    // Partner 2 refers a distinct tax code
    crm.recordReferral({
      referralId: "ref_103",
      partnerId: "ctv_02",
      companyName: "Công ty Cổ phần Hưng Thịnh Bình Dương",
      taxCode: "3709988776",
      productCodes: ["FTTH", "VCONTRACT"],
    });

    expect(crm.listReferrals()).toHaveLength(2);
    expect(crm.listReferrals("ctv_01")).toHaveLength(1);
    expect(crm.listReferrals("ctv_02")).toHaveLength(1);

    crm.recordConversion({
      conversionId: "conv_101",
      referralId: "ref_101",
      contractRevenueVnd: 5_000_000,
      commissionRatePercent: 10,
      commissionPolicyConfirmedByAmId: "am_01",
    });

    expect(crm.listConversions()).toHaveLength(1);
    expect(crm.listConversions("ctv_01")).toHaveLength(1);
    expect(crm.listConversions("ctv_02")).toHaveLength(0);
  });

  it("computes Partner & Group Channel Analytics with top partners and group category breakdown", () => {
    const groupManager = new GroupManager();
    groupManager.registerGroup({
      groupId: "grp_kt_01",
      platform: "ZALO",
      name: "Hội Kế toán Thuế Bình Dương",
      url: "https://zalo.me/g/ketoanbd",
      postingPermission: "ALLOWED",
    });
    groupManager.registerGroup({
      groupId: "grp_sme_01",
      platform: "FACEBOOK",
      name: "Cộng đồng Khởi nghiệp Startup Dĩ An",
      url: "https://facebook.com/groups/startupdian",
      postingPermission: "MODERATED_ALLOWED",
    });
    groupManager.registerGroup({
      groupId: "grp_ro_01",
      platform: "ZALO",
      name: "Nhóm Ngân hàng Tài chính SME",
      url: "https://zalo.me/g/banksme",
      postingPermission: "READ_ONLY",
    });

    const crm = new PartnerCrmService();
    crm.registerPartner({
      partnerId: "ctv_a",
      fullName: "Lê Minh Châu",
      phone: "0901112223",
      profession: "ACCOUNTANT",
      sourceGroupId: "grp_kt_01",
    });
    crm.transitionPartnerStage("ctv_a", "CONTACTED", "am_01");
    crm.transitionPartnerStage("ctv_a", "ACTIVE_PARTNER", "am_01");

    crm.registerPartner({
      partnerId: "ctv_b",
      fullName: "Phạm Hoàng Duy",
      phone: "0903334445",
      profession: "BUSINESS_CONSULTANT",
      sourceGroupId: "grp_sme_01",
    });

    crm.recordReferral({
      referralId: "ref_a1",
      partnerId: "ctv_a",
      companyName: "Công ty TNHH Alpha",
      taxCode: "0311111111",
      productCodes: ["CA"],
    });
    crm.recordReferral({
      referralId: "ref_a2",
      partnerId: "ctv_a",
      companyName: "Công ty TNHH Beta",
      taxCode: "0322222222",
      productCodes: ["SINVOICE"],
    });

    crm.recordConversion({
      conversionId: "conv_a1",
      referralId: "ref_a1",
      contractRevenueVnd: 4_000_000,
      commissionRatePercent: 12,
      commissionPolicyConfirmedByAmId: "am_01",
    });
    crm.markCommissionPaid("conv_a1", "UNC-2026-999", "fin_01");

    const analytics = crm.getPartnerChannelAnalytics(groupManager.listGroups());

    expect(analytics.totalPartners).toBe(2);
    expect(analytics.activePartners).toBe(1);
    expect(analytics.totalReferrals).toBe(2);
    expect(analytics.convertedReferrals).toBe(1);
    expect(analytics.conversionRatePercent).toBe(50);
    expect(analytics.totalRevenueVnd).toBe(4_000_000);
    expect(analytics.approvedPendingCommissionVnd).toBe(0);
    expect(analytics.paidCommissionVnd).toBe(480_000);
    expect(analytics.topPartners[0]).toMatchObject({
      partnerId: "ctv_a",
      fullName: "Lê Minh Châu",
      totalReferrals: 2,
      convertedCount: 1,
      totalRevenueVnd: 4_000_000,
    });
    expect(analytics.groupSummary).toEqual({
      totalGroups: 3,
      postableGroups: 2,
      byCategory: {
        ACCOUNTING_TAX: 1,
        STARTUP_SME: 1,
        BANKING_FINANCE: 1,
      },
    });
  });
});

