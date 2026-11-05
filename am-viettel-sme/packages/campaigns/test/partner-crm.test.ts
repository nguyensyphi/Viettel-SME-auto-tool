import { describe, expect, it } from "vitest";
import { PartnerCrmService } from "../src/partner-crm.js";

describe("PartnerCrmService — CTV Lifecycle, Referral Attribution & Commission Reconciliation (Task 12)", () => {
  it("enforces NEW -> CONTACTED -> ACTIVE_PARTNER lifecycle, masks phone, and blocks CCCD/DOB PII", () => {
    const crm = new PartnerCrmService();

    expect(() =>
      crm.registerPartner({
        partnerId: "ctv_bad_pii",
        fullName: "Nguyễn Văn A",
        phone: "0987654321",
        profession: "ACCOUNTANT",
        notes: "Số CCCD 079090001234 nhận hoa hồng",
      }),
    ).toThrow(/PII_FORBIDDEN_IN_PARTNER_CRM/);

    const p = crm.registerPartner({
      partnerId: "ctv_kt_01",
      fullName: "Trần Thị Minh (Kế toán dịch vụ)",
      phone: "0912345678",
      profession: "ACCOUNTANT",
      sourceGroupId: "fb_grp_ketoan_01",
    });

    expect(p.stage).toBe("NEW");
    expect(p.phoneMasked).not.toBe("0912345678");
    expect(p.phoneMasked).toContain("*");

    expect(() =>
      crm.transitionPartnerStage("ctv_kt_01", "ACTIVE_PARTNER", "am_01"),
    ).toThrow(/INVALID_PARTNER_STAGE_TRANSITION/);

    const contacted = crm.transitionPartnerStage("ctv_kt_01", "CONTACTED", "am_01");
    expect(contacted.stage).toBe("CONTACTED");

    const active = crm.transitionPartnerStage("ctv_kt_01", "ACTIVE_PARTNER", "am_01");
    expect(active.stage).toBe("ACTIVE_PARTNER");
  });

  it("tracks SME referrals with normalized tax code and reconciles revenue/commission only with AM policy confirmation", () => {
    const crm = new PartnerCrmService();

    crm.registerPartner({
      partnerId: "ctv_bank_01",
      fullName: "Lê Hoàng Nam (RM Ngân hàng)",
      phone: "0909111222",
      profession: "BANK_RM",
    });

    expect(() =>
      crm.recordReferral({
        referralId: "ref_01",
        partnerId: "ctv_bank_01",
        companyName: "Công ty TNHH Sao Khuê Dĩ An",
        taxCode: "3702998877",
        productCodes: ["CA", "SINVOICE"],
      }),
    ).toThrow(/PARTNER_NOT_ACTIVE/);

    crm.transitionPartnerStage("ctv_bank_01", "CONTACTED", "am_01");
    crm.transitionPartnerStage("ctv_bank_01", "ACTIVE_PARTNER", "am_01");

    expect(() =>
      crm.recordReferral({
        referralId: "ref_bad_mst",
        partnerId: "ctv_bank_01",
        companyName: "Công ty Sai MST",
        taxCode: "12345",
        productCodes: ["CA"],
      }),
    ).toThrow(/INVALID_TAX_CODE/);

    const referral = crm.recordReferral({
      referralId: "ref_01",
      partnerId: "ctv_bank_01",
      companyName: "Công ty TNHH Sao Khuê Dĩ An",
      taxCode: "3702998877 - 001",
      productCodes: ["CA", "SINVOICE"],
    });
    expect(referral.normalizedTaxCode).toBe("3702998877-001");
    expect(referral.status).toBe("REFERRED");

    expect(() =>
      crm.recordConversion({
        conversionId: "conv_unconfirmed",
        referralId: "ref_01",
        contractRevenueVnd: 3_500_000,
        commissionRatePercent: 10,
      }),
    ).toThrow(/COMMISSION_POLICY_CONFIRMATION_REQUIRED/);

    const conversion = crm.recordConversion({
      conversionId: "conv_01",
      referralId: "ref_01",
      contractRevenueVnd: 3_500_000,
      commissionRatePercent: 10,
      commissionPolicyConfirmedByAmId: "am_01",
      policyReferenceNote: "Theo tờ trình CTV SME Q4 đã duyệt",
    });

    expect(conversion.commissionAmountVnd).toBe(350_000);
    expect(conversion.payoutStatus).toBe("APPROVED_PENDING_PAYOUT");

    const summaryBeforePayout = crm.getPartnerReconciliationSummary("ctv_bank_01");
    expect(summaryBeforePayout).toEqual({
      partnerId: "ctv_bank_01",
      totalReferrals: 1,
      convertedCount: 1,
      totalRevenueVnd: 3_500_000,
      approvedPendingCommissionVnd: 350_000,
      paidCommissionVnd: 0,
    });

    crm.markCommissionPaid("conv_01", "UNC-20261105-009", "finance_op_01");

    const summaryAfterPayout = crm.getPartnerReconciliationSummary("ctv_bank_01");
    expect(summaryAfterPayout.approvedPendingCommissionVnd).toBe(0);
    expect(summaryAfterPayout.paidCommissionVnd).toBe(350_000);
  });
});

