import { describe, expect, it } from "vitest";
import {
  validateContentForPublishing,
  type ContentValidationCandidate,
} from "../src/content-validator.js";

describe("Content Validation Engine (PB-005 / PB-006, Section 7)", () => {
  const validCandidate: ContentValidationCandidate = {
    postCode: "PB001",
    title: "Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?",
    body: "Chữ ký số Viettel-CA giúp doanh nghiệp ký hóa đơn điện tử và kê khai thuế nhanh chóng.",
    topicCode: "CHU_KY_SO",
    platforms: ["ZALO", "FACEBOOK"],
    status: "APPROVED",
    contentHash: "hash-pb001",
    mediaRequired: true,
    linkedMedia: [
      {
        id: "media-01",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        isSharedMedia: false,
      },
    ],
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: "2026-12-31T23:59:59Z",
  };

  it("passes a valid approved post with matching topic media and active validity window", () => {
    const res = validateContentForPublishing(validCandidate, {
      now: new Date("2026-11-11T08:00:00Z"),
    });
    expect(res.valid).toBe(true);
    expect(res.status).toBe("VALID");
    expect(res.issues).toHaveLength(0);
  });

  it("rejects post with NEEDS_CLASSIFICATION or unknown topicCode", () => {
    const res = validateContentForPublishing({
      ...validCandidate,
      topicCode: "NEEDS_CLASSIFICATION",
    });
    expect(res.valid).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain("INVALID_TOPIC");
  });

  it("rejects post when required media is missing or unapproved (PB-PT-003)", () => {
    const missingMedia = validateContentForPublishing({
      ...validCandidate,
      mediaRequired: true,
      linkedMedia: [],
    });
    expect(missingMedia.valid).toBe(false);
    expect(missingMedia.issues.map((i) => i.code)).toContain("MISSING_REQUIRED_MEDIA");

    const unapprovedMedia = validateContentForPublishing({
      ...validCandidate,
      mediaRequired: true,
      linkedMedia: [
        {
          id: "media-02",
          topicCode: "CHU_KY_SO",
          status: "PENDING",
        },
      ],
    });
    expect(unapprovedMedia.valid).toBe(false);
    expect(unapprovedMedia.issues.map((i) => i.code)).toContain("MEDIA_NOT_APPROVED");
  });

  it("rejects post when linked media belongs to a mismatched topic", () => {
    const res = validateContentForPublishing({
      ...validCandidate,
      topicCode: "CHU_KY_SO",
      linkedMedia: [
        {
          id: "media-wrong",
          topicCode: "HOA_DON_DIEN_TU",
          status: "APPROVED",
          isSharedMedia: false,
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain("MEDIA_TOPIC_MISMATCH");
  });

  it("rejects expired post when current time is past validUntil (PB-PT-005)", () => {
    const res = validateContentForPublishing(validCandidate, {
      now: new Date("2027-01-15T00:00:00Z"),
    });
    expect(res.valid).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain("POST_EXPIRED");
  });

  it("rejects post containing sensitive PII (CCCD / CMND) or duplicate contentHash", () => {
    const withPii = validateContentForPublishing({
      ...validCandidate,
      body: "Liên hệ đại diện CCCD: 079090001234 để làm chữ ký số.",
    });
    expect(withPii.valid).toBe(false);
    expect(withPii.issues.map((i) => i.code)).toContain("PII_DETECTED");

    const duplicate = validateContentForPublishing(validCandidate, {
      now: new Date("2026-11-11T08:00:00Z"),
      existingPublishedHashes: new Set(["hash-pb001"]),
    });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.issues.map((i) => i.code)).toContain("DUPLICATE_CONTENT_HASH");
  });
});

