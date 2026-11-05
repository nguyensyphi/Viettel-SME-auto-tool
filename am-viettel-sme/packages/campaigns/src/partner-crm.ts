import crypto from "node:crypto";
import {
  maskPhoneForDisplay,
  normalizeCompanyName,
  normalizePhone,
} from "@am-sme/excel-import";

export type PartnerStage =
  | "NEW"
  | "CONTACTED"
  | "ACTIVE_PARTNER"
  | "INACTIVE";

export type PartnerProfession =
  | "ACCOUNTANT"
  | "BANK_RM"
  | "BUSINESS_CONSULTANT"
  | "IT_AGENCY"
  | "OTHER";

export interface RegisterPartnerInput {
  partnerId: string;
  fullName: string;
  phone: string;
  profession: PartnerProfession;
  sourceGroupId?: string | undefined;
  notes?: string | undefined;
}

export interface PartnerRecord {
  partnerId: string;
  fullName: string;
  phoneMasked: string;
  phoneHash: string;
  profession: PartnerProfession;
  stage: PartnerStage;
  sourceGroupId?: string | undefined;
  notes?: string | undefined;
  updatedByAmId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface RecordReferralInput {
  referralId: string;
  partnerId: string;
  companyName: string;
  taxCode: string;
  productCodes: readonly string[];
}

export interface ReferralRecord {
  referralId: string;
  partnerId: string;
  companyName: string;
  normalizedTaxCode: string;
  productCodes: readonly string[];
  status: "REFERRED" | "CONVERTED";
  createdAt: string;
}

export interface RecordConversionInput {
  conversionId: string;
  referralId: string;
  contractRevenueVnd: number;
  commissionRatePercent: number;
  commissionPolicyConfirmedByAmId?: string | undefined;
  policyReferenceNote?: string | undefined;
}

export interface ConversionRecord {
  conversionId: string;
  referralId: string;
  partnerId: string;
  contractRevenueVnd: number;
  commissionRatePercent: number;
  commissionAmountVnd: number;
  commissionPolicyConfirmedByAmId: string;
  policyReferenceNote?: string | undefined;
  payoutStatus: "APPROVED_PENDING_PAYOUT" | "PAID";
  payoutReference?: string | undefined;
  paidByOperatorId?: string | undefined;
  paidAt?: string | undefined;
  createdAt: string;
}

export interface PartnerReconciliationSummary {
  partnerId: string;
  totalReferrals: number;
  convertedCount: number;
  totalRevenueVnd: number;
  approvedPendingCommissionVnd: number;
  paidCommissionVnd: number;
}

const PARTNER_PII_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b|\b0\d{11}\b|\b(?:sn|sinh\s*ngày|ngày\s*sinh|birthdate|dob)\b[^\n\r]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:ngày\s*sinh|birthdate|dob)\b)/iu;

const ALLOWED_STAGE_TRANSITIONS: Record<PartnerStage, ReadonlySet<PartnerStage>> = {
  NEW: new Set<PartnerStage>(["CONTACTED", "INACTIVE"]),
  CONTACTED: new Set<PartnerStage>(["ACTIVE_PARTNER", "INACTIVE"]),
  ACTIVE_PARTNER: new Set<PartnerStage>(["INACTIVE"]),
  INACTIVE: new Set<PartnerStage>(["CONTACTED"]),
};

export function normalizeTaxCode(rawTaxCode: string): string {
  const cleaned = rawTaxCode.trim().replace(/\s*-\s*/gu, "-").replace(/\s+/gu, "");
  if (!/^\d{10}(?:-\d{3})?$/u.test(cleaned)) {
    throw new Error(`INVALID_TAX_CODE:${rawTaxCode}`);
  }
  return cleaned;
}

function assertNoForbiddenPartnerPii(text: string | undefined): void {
  if (!text) return;
  if (PARTNER_PII_PATTERN.test(text)) {
    throw new Error(
      "PII_FORBIDDEN_IN_PARTNER_CRM: Never store CCCD/CMND or birth dates in Partner CRM",
    );
  }
}

export class PartnerCrmService {
  private readonly partners = new Map<string, PartnerRecord>();
  private readonly referrals = new Map<string, ReferralRecord>();
  private readonly conversions = new Map<string, ConversionRecord>();

  registerPartner(input: RegisterPartnerInput): PartnerRecord {
    const partnerId = input.partnerId.trim();
    const fullName = input.fullName.trim();
    if (!partnerId || !fullName) {
      throw new Error("INVALID_PARTNER_INPUT: partnerId and fullName are required");
    }
    if (this.partners.has(partnerId)) {
      throw new Error(`DUPLICATE_PARTNER:${partnerId}`);
    }

    assertNoForbiddenPartnerPii(fullName);
    assertNoForbiddenPartnerPii(input.notes);

    const phoneRes = normalizePhone(input.phone);
    if (phoneRes.status !== "VALID") {
      throw new Error("INVALID_PARTNER_PHONE: Valid Vietnamese phone is required");
    }

    const phoneMasked = maskPhoneForDisplay(phoneRes.value) ?? "********";
    const phoneHash = crypto
      .createHash("sha256")
      .update(phoneRes.normalizedKey)
      .digest("hex");

    for (const existing of this.partners.values()) {
      if (existing.phoneHash === phoneHash) {
        throw new Error("DUPLICATE_PARTNER_PHONE");
      }
    }

    const now = new Date().toISOString();
    const record: PartnerRecord = {
      partnerId,
      fullName,
      phoneMasked,
      phoneHash,
      profession: input.profession,
      stage: "NEW",
      ...(input.sourceGroupId !== undefined
        ? { sourceGroupId: input.sourceGroupId }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.partners.set(partnerId, record);
    return { ...record };
  }

  transitionPartnerStage(
    partnerId: string,
    targetStage: PartnerStage,
    amId: string,
  ): PartnerRecord {
    const existing = this.partners.get(partnerId);
    if (!existing) {
      throw new Error(`PARTNER_NOT_FOUND:${partnerId}`);
    }
    if (!amId.trim()) {
      throw new Error("AM_ID_REQUIRED");
    }

    const allowedTargets = ALLOWED_STAGE_TRANSITIONS[existing.stage];
    if (!allowedTargets.has(targetStage)) {
      throw new Error(
        `INVALID_PARTNER_STAGE_TRANSITION:${existing.stage}->${targetStage}`,
      );
    }

    const updated: PartnerRecord = {
      ...existing,
      stage: targetStage,
      updatedByAmId: amId.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.partners.set(partnerId, updated);
    return { ...updated };
  }

  listPartners(): PartnerRecord[] {
    return Array.from(this.partners.values(), (p) => ({ ...p }));
  }

  recordReferral(input: RecordReferralInput): ReferralRecord {
    const referralId = input.referralId.trim();
    if (!referralId) {
      throw new Error("INVALID_REFERRAL_INPUT: referralId is required");
    }
    if (this.referrals.has(referralId)) {
      throw new Error(`DUPLICATE_REFERRAL:${referralId}`);
    }

    const partner = this.partners.get(input.partnerId);
    if (!partner) {
      throw new Error(`PARTNER_NOT_FOUND:${input.partnerId}`);
    }
    if (partner.stage !== "ACTIVE_PARTNER") {
      throw new Error(
        `PARTNER_NOT_ACTIVE: Partner ${input.partnerId} is in stage ${partner.stage}`,
      );
    }

    const normalizedTaxCode = normalizeTaxCode(input.taxCode);
    const company = normalizeCompanyName(input.companyName);
    if (!company.display || input.productCodes.length === 0) {
      throw new Error("INVALID_REFERRAL_INPUT");
    }

    const record: ReferralRecord = {
      referralId,
      partnerId: partner.partnerId,
      companyName: company.display,
      normalizedTaxCode,
      productCodes: [...input.productCodes],
      status: "REFERRED",
      createdAt: new Date().toISOString(),
    };

    this.referrals.set(record.referralId, record);
    return { ...record };
  }

  recordConversion(input: RecordConversionInput): ConversionRecord {
    const conversionId = input.conversionId.trim();
    if (!conversionId) {
      throw new Error("INVALID_CONVERSION_INPUT: conversionId is required");
    }
    if (this.conversions.has(conversionId)) {
      throw new Error(`DUPLICATE_CONVERSION:${conversionId}`);
    }

    const referral = this.referrals.get(input.referralId);
    if (!referral) {
      throw new Error(`REFERRAL_NOT_FOUND:${input.referralId}`);
    }
    if (referral.status === "CONVERTED") {
      throw new Error(`REFERRAL_ALREADY_CONVERTED:${referral.referralId}`);
    }

    assertNoForbiddenPartnerPii(input.policyReferenceNote);

    const confirmedAm = input.commissionPolicyConfirmedByAmId?.trim() ?? "";
    if (!confirmedAm) {
      throw new Error(
        "COMMISSION_POLICY_CONFIRMATION_REQUIRED: AM must explicitly confirm current commission policy (CAN_XAC_NHAN_LAI guard)",
      );
    }

    if (input.contractRevenueVnd <= 0) {
      throw new Error("INVALID_CONTRACT_REVENUE");
    }
    if (input.commissionRatePercent < 0 || input.commissionRatePercent > 50) {
      throw new Error("INVALID_COMMISSION_RATE");
    }

    const commissionAmountVnd = Math.round(
      (input.contractRevenueVnd * input.commissionRatePercent) / 100,
    );

    this.referrals.set(referral.referralId, {
      ...referral,
      status: "CONVERTED",
    });

    const conversion: ConversionRecord = {
      conversionId,
      referralId: referral.referralId,
      partnerId: referral.partnerId,
      contractRevenueVnd: input.contractRevenueVnd,
      commissionRatePercent: input.commissionRatePercent,
      commissionAmountVnd,
      commissionPolicyConfirmedByAmId: confirmedAm,
      ...(input.policyReferenceNote !== undefined
        ? { policyReferenceNote: input.policyReferenceNote }
        : {}),
      payoutStatus: "APPROVED_PENDING_PAYOUT",
      createdAt: new Date().toISOString(),
    };

    this.conversions.set(conversion.conversionId, conversion);
    return { ...conversion };
  }

  markCommissionPaid(
    conversionId: string,
    payoutReference: string,
    operatorId: string,
  ): ConversionRecord {
    const existing = this.conversions.get(conversionId);
    if (!existing) {
      throw new Error(`CONVERSION_NOT_FOUND:${conversionId}`);
    }
    if (existing.payoutStatus === "PAID") {
      throw new Error(`CONVERSION_ALREADY_PAID:${conversionId}`);
    }
    if (!payoutReference.trim() || !operatorId.trim()) {
      throw new Error("PAYOUT_REFERENCE_AND_OPERATOR_REQUIRED");
    }

    const updated: ConversionRecord = {
      ...existing,
      payoutStatus: "PAID",
      payoutReference: payoutReference.trim(),
      paidByOperatorId: operatorId.trim(),
      paidAt: new Date().toISOString(),
    };
    this.conversions.set(conversionId, updated);
    return { ...updated };
  }

  getPartnerReconciliationSummary(
    partnerId: string,
  ): PartnerReconciliationSummary {
    if (!this.partners.has(partnerId)) {
      throw new Error(`PARTNER_NOT_FOUND:${partnerId}`);
    }

    let totalReferrals = 0;
    let convertedCount = 0;
    for (const ref of this.referrals.values()) {
      if (ref.partnerId === partnerId) {
        totalReferrals += 1;
        if (ref.status === "CONVERTED") {
          convertedCount += 1;
        }
      }
    }

    let totalRevenueVnd = 0;
    let approvedPendingCommissionVnd = 0;
    let paidCommissionVnd = 0;

    for (const conv of this.conversions.values()) {
      if (conv.partnerId === partnerId) {
        totalRevenueVnd += conv.contractRevenueVnd;
        if (conv.payoutStatus === "PAID") {
          paidCommissionVnd += conv.commissionAmountVnd;
        } else {
          approvedPendingCommissionVnd += conv.commissionAmountVnd;
        }
      }
    }

    return {
      partnerId,
      totalReferrals,
      convertedCount,
      totalRevenueVnd,
      approvedPendingCommissionVnd,
      paidCommissionVnd,
    };
  }
}

