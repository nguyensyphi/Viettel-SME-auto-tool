import { describe, expect, it } from "vitest";
import {
  combineContactabilityStatuses,
  evaluateContactTaskEligibility,
} from "../src/contactability/policy.js";

const validEvidence = {
  status: "ALLOWED_FOR_RECORDED_PURPOSE" as const,
  hasSourceEvidence: true,
  hasContactBasis: true,
  hasConsentEvidence: true,
  channelAllowed: true,
  hasPurpose: true,
  hasConsentTimestamp: true,
  suppressed: false,
};

describe("evaluateContactTaskEligibility", () => {
  it("allows a contact task only with recorded purpose, source and channel basis", () => {
    expect(evaluateContactTaskEligibility(validEvidence)).toEqual({
      allowed: true,
      reason: "ELIGIBLE",
    });
  });

  it("blocks opt-out immediately, even when other evidence is present", () => {
    expect(
      evaluateContactTaskEligibility({ ...validEvidence, status: "OPTED_OUT" }),
    ).toEqual({ allowed: false, reason: "OPTED_OUT" });
  });

  it("blocks a suppressed contact even if contactability was previously allowed", () => {
    expect(
      evaluateContactTaskEligibility({ ...validEvidence, suppressed: true }),
    ).toEqual({ allowed: false, reason: "SUPPRESSED" });
  });

  it("blocks unknown or review-required contactability by default", () => {
    expect(
      evaluateContactTaskEligibility({ ...validEvidence, status: "UNKNOWN" }),
    ).toEqual({ allowed: false, reason: "CONTACTABILITY_NOT_APPROVED" });

    expect(
      evaluateContactTaskEligibility({
        ...validEvidence,
        status: "REVIEW_REQUIRED",
      }),
    ).toEqual({ allowed: false, reason: "CONTACTABILITY_NOT_APPROVED" });
  });

  it("blocks missing source evidence, contact basis or allowed channel", () => {
    expect(
      evaluateContactTaskEligibility({
        ...validEvidence,
        hasSourceEvidence: false,
      }),
    ).toEqual({ allowed: false, reason: "SOURCE_EVIDENCE_MISSING" });

    expect(
      evaluateContactTaskEligibility({
        ...validEvidence,
        hasContactBasis: false,
      }),
    ).toEqual({ allowed: false, reason: "CONTACT_BASIS_MISSING" });

    expect(
      evaluateContactTaskEligibility({
        ...validEvidence,
        channelAllowed: false,
      }),
    ).toEqual({ allowed: false, reason: "CHANNEL_NOT_ALLOWED" });
  });

  it.each(["UNKNOWN", "OPTED_OUT", "SUPPRESSED"] as const)(
    "blocks every contact task while status is %s",
    (status) => {
      expect(
        evaluateContactTaskEligibility({ ...validEvidence, status }),
      ).toEqual({
        allowed: false,
        reason:
          status === "OPTED_OUT"
            ? "OPTED_OUT"
            : status === "SUPPRESSED"
              ? "SUPPRESSED"
              : "CONTACTABILITY_NOT_APPROVED",
      });
    },
  );

  it("blocks an allowed status when any consent evidence component is missing", () => {
    expect(
      evaluateContactTaskEligibility({
        ...validEvidence,
        hasConsentEvidence: false,
      }),
    ).toEqual({ allowed: false, reason: "CONSENT_EVIDENCE_MISSING" });
    expect(
      evaluateContactTaskEligibility({ ...validEvidence, hasPurpose: false }),
    ).toEqual({ allowed: false, reason: "PURPOSE_MISSING" });
    expect(
      evaluateContactTaskEligibility({
        ...validEvidence,
        hasConsentTimestamp: false,
      }),
    ).toEqual({ allowed: false, reason: "CONSENT_TIMESTAMP_MISSING" });
  });

  it("keeps opt-out dominant over an allowed state when statuses are combined", () => {
    expect(
      combineContactabilityStatuses([
        "ALLOWED_FOR_RECORDED_PURPOSE",
        "OPTED_OUT",
      ]),
    ).toBe("OPTED_OUT");
  });
});
