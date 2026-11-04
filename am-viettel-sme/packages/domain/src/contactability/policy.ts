export type ContactabilityStatus =
  | "UNKNOWN"
  | "REVIEW_REQUIRED"
  | "ALLOWED_FOR_RECORDED_PURPOSE"
  | "OPTED_OUT"
  | "SUPPRESSED";

export type ConsentStatus =
  "UNKNOWN" | "REVIEW_REQUIRED" | "ALLOWED_FOR_RECORDED_PURPOSE" | "OPTED_OUT";

export interface ContactTaskEligibilityInput {
  status: ContactabilityStatus;
  hasSourceEvidence: boolean;
  hasContactBasis: boolean;
  hasConsentEvidence: boolean;
  channelAllowed: boolean;
  hasPurpose: boolean;
  hasConsentTimestamp: boolean;
  suppressed: boolean;
}

export type ContactTaskBlockReason =
  | "OPTED_OUT"
  | "SUPPRESSED"
  | "CONTACTABILITY_NOT_APPROVED"
  | "SOURCE_EVIDENCE_MISSING"
  | "CONTACT_BASIS_MISSING"
  | "CONSENT_EVIDENCE_MISSING"
  | "CHANNEL_NOT_ALLOWED"
  | "PURPOSE_MISSING"
  | "CONSENT_TIMESTAMP_MISSING";

export type ContactTaskEligibility =
  | { allowed: true; reason: "ELIGIBLE" }
  | { allowed: false; reason: ContactTaskBlockReason };

export interface ConsentEvidenceInput {
  evidenceReference?: string | null;
  channel?: string | null;
  purpose?: string | null;
  capturedAt?: string | null;
}

export interface ImportProvenanceInput {
  source: string | null;
  sourceUrl: string | null;
  lawfulContactBasis: string | null;
  consentStatus: ConsentStatus;
  consentEvidence?: ConsentEvidenceInput;
}

export type ImportProvenanceReviewReason =
  | "SOURCE_EVIDENCE_MISSING"
  | "CONTACT_BASIS_MISSING"
  | "CONSENT_EVIDENCE_MISSING"
  | "CHANNEL_MISSING"
  | "CHANNEL_NOT_ALLOWED"
  | "PURPOSE_MISSING"
  | "CONSENT_TIMESTAMP_MISSING";

export interface ImportSuppressionInstruction {
  required: true;
  reason: "OPT_OUT";
  /** The workbook contains no channel field, so opt-out is fail-closed for all channels. */
  scope: "ALL_CHANNELS";
}

export interface ImportProvenanceAssessment {
  reviewRequired: boolean;
  reviewReasons: readonly ImportProvenanceReviewReason[];
  consentStatus: ConsentStatus;
  contactabilityStatus: ContactabilityStatus;
  suppression: ImportSuppressionInstruction | null;
  /** Assessment is pure: import never creates/enqueues a contact task. */
  contactTaskEnqueued: false;
}

const knownChannels = new Set(["PHONE", "EMAIL", "SMS", "ZALO", "TELEGRAM"]);
const actionableContactBases = new Set([
  "CUSTOMER_REQUEST",
  "EXISTING_RELATIONSHIP",
  "CONSENT_RECORDED",
]);

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTimestamp(value: string | null | undefined): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

export function evaluateContactTaskEligibility(
  input: ContactTaskEligibilityInput,
): ContactTaskEligibility {
  if (input.status === "OPTED_OUT") {
    return { allowed: false, reason: "OPTED_OUT" };
  }

  if (input.status === "SUPPRESSED" || input.suppressed) {
    return { allowed: false, reason: "SUPPRESSED" };
  }

  if (input.status !== "ALLOWED_FOR_RECORDED_PURPOSE") {
    return { allowed: false, reason: "CONTACTABILITY_NOT_APPROVED" };
  }

  if (!input.hasSourceEvidence) {
    return { allowed: false, reason: "SOURCE_EVIDENCE_MISSING" };
  }

  if (!input.hasContactBasis) {
    return { allowed: false, reason: "CONTACT_BASIS_MISSING" };
  }

  if (!input.hasConsentEvidence) {
    return { allowed: false, reason: "CONSENT_EVIDENCE_MISSING" };
  }

  if (!input.channelAllowed) {
    return { allowed: false, reason: "CHANNEL_NOT_ALLOWED" };
  }

  if (!input.hasPurpose) {
    return { allowed: false, reason: "PURPOSE_MISSING" };
  }

  if (!input.hasConsentTimestamp) {
    return { allowed: false, reason: "CONSENT_TIMESTAMP_MISSING" };
  }

  return { allowed: true, reason: "ELIGIBLE" };
}

/**
 * Fail-closed import assessment. Workbook values are evidence inputs only; they
 * do not prove consent. ALLOWED is retained only with source, an actionable
 * contact basis, consent evidence reference, channel, purpose, and valid time.
 */
export function evaluateImportedProvenance(
  input: ImportProvenanceInput,
): ImportProvenanceAssessment {
  const reasons: ImportProvenanceReviewReason[] = [];
  const source = input.source?.trim() ?? "";
  const sourceUrl = input.sourceUrl?.trim() ?? "";
  const basis = input.lawfulContactBasis?.trim() ?? "";
  const evidence = input.consentEvidence;

  if (!source || (source === "WEB_SOURCE" && !sourceUrl)) {
    reasons.push("SOURCE_EVIDENCE_MISSING");
  }
  if (!actionableContactBases.has(basis)) {
    reasons.push("CONTACT_BASIS_MISSING");
  }
  if (!hasText(evidence?.evidenceReference)) {
    reasons.push("CONSENT_EVIDENCE_MISSING");
  }
  const consentChannel = evidence?.channel;
  if (!hasText(consentChannel)) {
    reasons.push("CHANNEL_MISSING");
  } else if (
    typeof consentChannel === "string" &&
    !knownChannels.has(consentChannel.trim())
  ) {
    reasons.push("CHANNEL_NOT_ALLOWED");
  }
  if (!hasText(evidence?.purpose)) {
    reasons.push("PURPOSE_MISSING");
  }
  if (!isValidTimestamp(evidence?.capturedAt)) {
    reasons.push("CONSENT_TIMESTAMP_MISSING");
  }

  if (input.consentStatus === "OPTED_OUT") {
    return {
      reviewRequired: reasons.length > 0,
      reviewReasons: reasons,
      consentStatus: "OPTED_OUT",
      contactabilityStatus: "SUPPRESSED",
      suppression: {
        required: true,
        reason: "OPT_OUT",
        scope: "ALL_CHANNELS",
      },
      contactTaskEnqueued: false,
    };
  }

  const hasReviewBlock = reasons.some(
    (reason) =>
      reason === "SOURCE_EVIDENCE_MISSING" ||
      reason === "CONTACT_BASIS_MISSING",
  );
  const consentEvidenceIncomplete = reasons.some(
    (reason) =>
      reason !== "SOURCE_EVIDENCE_MISSING" &&
      reason !== "CONTACT_BASIS_MISSING",
  );
  const allowedEvidenceComplete = reasons.length === 0;
  const consentStatus: ConsentStatus =
    input.consentStatus === "ALLOWED_FOR_RECORDED_PURPOSE" &&
    !allowedEvidenceComplete
      ? "REVIEW_REQUIRED"
      : input.consentStatus;

  let contactabilityStatus: ContactabilityStatus;
  if (
    consentStatus === "ALLOWED_FOR_RECORDED_PURPOSE" &&
    allowedEvidenceComplete
  ) {
    contactabilityStatus = "ALLOWED_FOR_RECORDED_PURPOSE";
  } else if (
    consentStatus === "REVIEW_REQUIRED" ||
    hasReviewBlock ||
    (input.consentStatus === "ALLOWED_FOR_RECORDED_PURPOSE" &&
      consentEvidenceIncomplete)
  ) {
    contactabilityStatus = "REVIEW_REQUIRED";
  } else {
    contactabilityStatus = "UNKNOWN";
  }

  return {
    reviewRequired: reasons.length > 0 || consentStatus === "REVIEW_REQUIRED",
    reviewReasons: reasons,
    consentStatus,
    contactabilityStatus,
    suppression: null,
    contactTaskEnqueued: false,
  };
}

/**
 * A conservative merge helper for later dedupe/merge packages. Any restrictive
 * input dominates ALLOWED so an opt-out cannot be undone by a later allow.
 */
export function combineContactabilityStatuses(
  statuses: readonly ContactabilityStatus[],
): ContactabilityStatus {
  if (statuses.includes("OPTED_OUT")) return "OPTED_OUT";
  if (statuses.includes("SUPPRESSED")) return "SUPPRESSED";
  if (statuses.includes("REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  if (statuses.includes("UNKNOWN")) return "UNKNOWN";
  return statuses.includes("ALLOWED_FOR_RECORDED_PURPOSE")
    ? "ALLOWED_FOR_RECORDED_PURPOSE"
    : "UNKNOWN";
}
