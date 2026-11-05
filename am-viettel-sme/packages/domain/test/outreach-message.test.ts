import { describe, it, expect } from "vitest";
import {
  generateOutreachMessage,
  type OutreachMessageRequest,
} from "../src/messaging/message-generator.js";
import type { AmConfirmedProfile } from "../src/review/am-confirmation.js";
import { CustomerSegment } from "../src/classification/customer-classifier.js";
import type { ContactTaskEligibilityInput } from "../src/contactability/policy.js";

const amProfile = {
  fullName: "Nguyễn Văn AM",
  title: "Chuyên viên Khách hàng Doanh nghiệp Viettel",
  phoneNumber: "0988123456",
};

const eligible: ContactTaskEligibilityInput = {
  status: "ALLOWED_FOR_RECORDED_PURPOSE",
  hasSourceEvidence: true,
  hasContactBasis: true,
  hasConsentEvidence: true,
  channelAllowed: true,
  hasPurpose: true,
  hasConsentTimestamp: true,
  suppressed: false,
};

function confirmation(services: string[]): AmConfirmedProfile {
  return {
    source: "AM_CONFIRMED",
    segment: CustomerSegment.RETAIL_FNB,
    services,
    confirmedBy: "am-001",
    confirmedAt: "2026-11-05T08:00:00.000Z",
    overridden: false,
  };
}

function req(overrides: Partial<OutreachMessageRequest>): OutreachMessageRequest {
  return {
    channel: "ZALO",
    businessName: "NHÀ HÀNG BIỂN ĐÔNG",
    contactName: "Chị Lan",
    serviceOffering: "HOA_DON_DIEN_TU",
    amProfile,
    eligibilityInput: eligible,
    amConfirmation: confirmation(["HOA_DON_DIEN_TU"]),
    ...overrides,
  };
}

describe("Outreach Message Generator (M01-07)", () => {
  it("blocks fail-closed when lead opted out", () => {
    const result = generateOutreachMessage(
      req({ eligibilityInput: { ...eligible, status: "OPTED_OUT", suppressed: true } }),
    );
    expect(result).toEqual({ allowed: false, blockReason: "OPTED_OUT" });
  });

  it("blocks when contactability is REVIEW_REQUIRED", () => {
    const result = generateOutreachMessage(
      req({ eligibilityInput: { ...eligible, status: "REVIEW_REQUIRED" } }),
    );
    expect(result).toEqual({ allowed: false, blockReason: "CONTACTABILITY_NOT_APPROVED" });
  });

  it("blocks when AM has not confirmed the suggestion", () => {
    const result = generateOutreachMessage(req({ amConfirmation: undefined }));
    expect(result).toEqual({ allowed: false, blockReason: "AM_CONFIRMATION_MISSING" });
  });

  it("blocks when the offered service was not among AM-confirmed services", () => {
    const result = generateOutreachMessage(req({ serviceOffering: "VTRACKING" }));
    expect(result).toEqual({ allowed: false, blockReason: "SERVICE_NOT_CONFIRMED" });
  });

  it("checks contactability before AM confirmation (opt-out always wins)", () => {
    const result = generateOutreachMessage(
      req({ amConfirmation: undefined, eligibilityInput: { ...eligible, status: "OPTED_OUT" } }),
    );
    expect(result).toEqual({ allowed: false, blockReason: "OPTED_OUT" });
  });

  it("renders a draft Zalo message with greeting, AM signature and opt-out", () => {
    const result = generateOutreachMessage(req({}));
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.templateId).toBe("ZALO_INTRO_V1");
    expect(result.approvalStatus).toBe("DRAFT_PENDING_COMPLIANCE");
    expect(result.messageText).toContain("Chị Lan");
    expect(result.messageText).toContain("NHÀ HÀNG BIỂN ĐÔNG");
    expect(result.messageText).toMatch(/hóa đơn điện tử/i);
    expect(result.messageText).toContain("Nguyễn Văn AM");
    expect(result.messageText).toMatch(/TU CHOI|TỪ CHỐI/);
  });

  it("renders SMS with AM phone and opt-out, no hard-coded shortcode", () => {
    const result = generateOutreachMessage(
      req({ channel: "SMS", serviceOffering: "VIETTEL_CA", amConfirmation: confirmation(["VIETTEL_CA"]) }),
    );
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.messageText).toContain("0988123456");
    expect(result.messageText).toMatch(/TU CHOI/);
    expect(result.messageText).not.toMatch(/gui\s+\d{3,5}/i);
  });

  it("allows choosing an explicit template id matching the channel", () => {
    const result = generateOutreachMessage(req({ templateId: "ZALO_FOLLOWUP_V1" }));
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.templateId).toBe("ZALO_FOLLOWUP_V1");
  });

  it("rejects a template id whose channel does not match", () => {
    expect(() => generateOutreachMessage(req({ templateId: "SMS_INTRO_V1" }))).toThrow(/channel/i);
  });
});
