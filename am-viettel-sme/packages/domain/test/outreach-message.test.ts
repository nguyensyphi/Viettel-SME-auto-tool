import { describe, it, expect } from "vitest";
import {
  generateOutreachMessage,
  type OutreachMessageRequest,
} from "../src/messaging/message-generator.js";

describe("Outreach Message Template Generator (M01-07)", () => {
  const sampleAmProfile = {
    fullName: "Nguyễn Văn AM",
    title: "Chuyên viên Khách hàng Doanh nghiệp Viettel",
    phoneNumber: "0988123456",
  };

  it("blocks message generation fail-closed if contact eligibility is not met or opted-out", () => {
    const request: OutreachMessageRequest = {
      channel: "SMS",
      businessName: "CÔNG TY TNHH BẢO AN",
      contactName: "Anh Bình",
      serviceOffering: "VIETTEL_CA",
      amProfile: sampleAmProfile,
      eligibilityInput: {
        status: "OPTED_OUT",
        hasSourceEvidence: true,
        hasContactBasis: true,
        hasConsentEvidence: true,
        channelAllowed: true,
        hasPurpose: true,
        hasConsentTimestamp: true,
        suppressed: true,
      },
    };

    const result = generateOutreachMessage(request);

    expect(result.allowed).toBe(false);
    expect(result.messageText).toBeUndefined();
    expect(result.blockReason).toBe("OPTED_OUT");
  });

  it("blocks message generation if lead contact status is REVIEW_REQUIRED or missing consent", () => {
    const request: OutreachMessageRequest = {
      channel: "ZALO",
      businessName: "CÔNG TY TNHH CÔNG NGHỆ MỚI",
      contactName: "Chị Hạnh",
      serviceOffering: "HOA_DON_DIEN_TU",
      amProfile: sampleAmProfile,
      eligibilityInput: {
        status: "REVIEW_REQUIRED",
        hasSourceEvidence: false,
        hasContactBasis: false,
        hasConsentEvidence: false,
        channelAllowed: false,
        hasPurpose: false,
        hasConsentTimestamp: false,
        suppressed: false,
      },
    };

    const result = generateOutreachMessage(request);

    expect(result.allowed).toBe(false);
    expect(result.messageText).toBeUndefined();
    expect(result.blockReason).toBe("CONTACTABILITY_NOT_APPROVED");
  });

  it("generates compliant SMS message with mandatory opt-out syntax for eligible lead", () => {
    const request: OutreachMessageRequest = {
      channel: "SMS",
      businessName: "CÔNG TY TNHH MINH PHÁT",
      contactName: "Anh Dũng",
      serviceOffering: "VIETTEL_CA",
      amProfile: sampleAmProfile,
      eligibilityInput: {
        status: "ALLOWED_FOR_RECORDED_PURPOSE",
        hasSourceEvidence: true,
        hasContactBasis: true,
        hasConsentEvidence: true,
        channelAllowed: true,
        hasPurpose: true,
        hasConsentTimestamp: true,
        suppressed: false,
      },
    };

    const result = generateOutreachMessage(request);

    expect(result.allowed).toBe(true);
    expect(result.messageText).toBeDefined();
    // Must contain business name or contact name
    expect(result.messageText).toContain("MINH PHÁT");
    expect(result.messageText).toContain("Viettel CA");
    // Must contain AM signature
    expect(result.messageText).toContain("Nguyễn Văn AM");
    expect(result.messageText).toContain("0988123456");
    // Mandatory opt-out instruction
    expect(result.messageText).toMatch(/Tu choi|TC|ngung nhan tin/i);
  });

  it("generates Zalo message with personalized greeting and product highlights for eligible lead", () => {
    const request: OutreachMessageRequest = {
      channel: "ZALO",
      businessName: "NHÀ HÀNG BIỂN ĐÔNG",
      contactName: "Chị Lan",
      serviceOffering: "HOA_DON_DIEN_TU",
      amProfile: sampleAmProfile,
      eligibilityInput: {
        status: "ALLOWED_FOR_RECORDED_PURPOSE",
        hasSourceEvidence: true,
        hasContactBasis: true,
        hasConsentEvidence: true,
        channelAllowed: true,
        hasPurpose: true,
        hasConsentTimestamp: true,
        suppressed: false,
      },
    };

    const result = generateOutreachMessage(request);

    expect(result.allowed).toBe(true);
    expect(result.messageText).toContain("Kính gửi Chị Lan - NHÀ HÀNG BIỂN ĐÔNG");
    expect(result.messageText).toMatch(/hóa đơn điện tử/i);
    expect(result.messageText).toContain("Nguyễn Văn AM - Chuyên viên Khách hàng Doanh nghiệp Viettel");
    expect(result.messageText).toContain("Nếu không có nhu cầu, Chị Lan vui lòng nhắn 'Dừng'");
  });

  it("never includes CCCD/CMND numbers or raw birth dates in message text", () => {
    const request: OutreachMessageRequest = {
      channel: "ZALO",
      businessName: "CÔNG TY TNHH BẢO VIỆT",
      contactName: "Anh Hoàng",
      serviceOffering: "VIETTEL_CA",
      amProfile: sampleAmProfile,
      eligibilityInput: {
        status: "ALLOWED_FOR_RECORDED_PURPOSE",
        hasSourceEvidence: true,
        hasContactBasis: true,
        hasConsentEvidence: true,
        channelAllowed: true,
        hasPurpose: true,
        hasConsentTimestamp: true,
        suppressed: false,
      },
    };

    const result = generateOutreachMessage(request);

    expect(result.allowed).toBe(true);
    // Verify no 9 or 12 digit personal ID sequences leaked
    expect(result.messageText).not.toMatch(/\b\d{9}\b|\b\d{12}\b/);
  });
});
