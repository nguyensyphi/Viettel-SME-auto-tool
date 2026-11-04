import {
  combineContactabilityStatuses,
  type ConsentStatus,
  type ContactabilityStatus,
  type ImportSuppressionInstruction,
} from "@am-sme/domain/contactability";
import {
  maskEmailForDisplay,
  maskPhoneForDisplay,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
} from "./normalization.js";

export interface DeduplicationLead {
  /** Absent for an incoming, not-yet-persisted lead. */
  readonly id?: string;
  readonly companyName: string;
  readonly contactName?: string | null;
  readonly district: string | null;
  /** P0.3b normalized keys; normalization is repeated defensively before compare. */
  readonly phoneNormalized: string | null;
  readonly emailNormalized: string | null;
  /** Not part of the current Excel template; ignored unless explicitly authorized. */
  readonly taxIdNormalized?: string | null;
  readonly consentStatus: ConsentStatus;
  readonly contactabilityStatus: ContactabilityStatus;
  readonly consentEvidenceReferences?: readonly string[];
  readonly auditEvidenceReferences?: readonly string[];
  readonly suppressionInstructions?: readonly ImportSuppressionInstruction[];
}

export interface TaxIdMatchAuthorization {
  /** True only when an AM explicitly mapped this field for the import. */
  readonly explicitlyMapped: boolean;
  /** True only after the field mapping/access has been approved. */
  readonly permissionApproved: boolean;
}

export interface FindDuplicateCandidatesOptions {
  /** Opaque import row/reference; do not place raw workbook data here. */
  readonly reviewGroupId: string;
  readonly taxIdMatchAuthorization?: TaxIdMatchAuthorization;
}

export type DuplicateMatchType =
  "EXACT_PHONE" | "EXACT_EMAIL" | "EXACT_TAX_ID" | "COMPANY_DISTRICT";

export interface MaskedLeadSummary {
  readonly leadId: string | null;
  /** Company names are business identifiers; phone, email, and contact name are masked. */
  readonly companyName: string;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly district: string | null;
}

interface ReviewSafetySnapshot {
  readonly consentStatus: ConsentStatus;
  readonly contactabilityStatus: ContactabilityStatus;
  readonly consentEvidenceReferences: readonly string[];
  readonly auditEvidenceReferences: readonly string[];
  readonly suppressionInstructions: readonly ImportSuppressionInstruction[];
}

export interface DuplicateReviewCandidate {
  readonly leadId: string;
  readonly display: MaskedLeadSummary;
  readonly matchTypes: readonly DuplicateMatchType[];
  readonly reasons: readonly string[];
  readonly confidence: "EXACT" | "FUZZY";
  readonly decisionRequired: true;
  /** Detection is advisory only; this is always false in P0.4a. */
  readonly autoMerged: false;
  readonly restrictionConflict: boolean;
  /** Required by the P0.4b merge contract; contains no raw contact fields. */
  readonly safetySnapshot: ReviewSafetySnapshot;
}

export interface DuplicateReviewGroup {
  readonly reviewGroupId: string;
  readonly incoming: MaskedLeadSummary;
  readonly incomingSafetySnapshot: ReviewSafetySnapshot;
  readonly candidates: readonly DuplicateReviewCandidate[];
  readonly reviewRequired: boolean;
}

export type ReviewDecisionRequest =
  | { readonly action: "KEEP" }
  | { readonly action: "SKIP" }
  | { readonly action: "MERGE"; readonly targetLeadId: string };

export interface ReviewDecisionBase {
  readonly reviewGroupId: string;
  readonly persistence: "NOT_PERFORMED";
}

export type DeduplicationReviewDecision =
  | (ReviewDecisionBase & {
      readonly action: "KEEP";
      readonly targetLeadId: null;
    })
  | (ReviewDecisionBase & {
      readonly action: "SKIP";
      readonly targetLeadId: null;
    })
  | (ReviewDecisionBase & {
      readonly action: "MERGE";
      readonly targetLeadId: string;
      readonly safety: MergeSafetySummary;
    });

export interface MergeSafetySummary {
  readonly effectiveConsentStatus: ConsentStatus;
  readonly effectiveContactabilityStatus: ContactabilityStatus;
  readonly suppressionMustRemain: boolean;
  readonly preservedConsentEvidenceReferences: readonly string[];
  readonly preservedAuditEvidenceReferences: readonly string[];
  readonly preservedSuppressionInstructions: readonly ImportSuppressionInstruction[];
}

export type CreateReviewDecisionResult =
  | { readonly valid: true; readonly decision: DeduplicationReviewDecision }
  | {
      readonly valid: false;
      readonly errorCode:
        | "REVIEW_GROUP_ID_REQUIRED"
        | "MERGE_TARGET_REQUIRED"
        | "MERGE_TARGET_NOT_IN_CANDIDATES"
        | "CANDIDATES_REQUIRED";
    };

const MATCH_ORDER: readonly DuplicateMatchType[] = [
  "EXACT_PHONE",
  "EXACT_EMAIL",
  "EXACT_TAX_ID",
  "COMPANY_DISTRICT",
];

const MATCH_REASON: Readonly<Record<DuplicateMatchType, string>> = {
  EXACT_PHONE: "Số điện thoại trùng sau chuẩn hóa",
  EXACT_EMAIL: "Email trùng sau chuẩn hóa",
  EXACT_TAX_ID: "Mã số thuế trùng theo mapping đã được duyệt",
  COMPANY_DISTRICT: "Tên doanh nghiệp và quận/huyện tương tự; cần AM xác nhận",
};

function nonBlankUnique(
  values: readonly string[] | undefined,
): readonly string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
}

function snapshotSafety(lead: DeduplicationLead): ReviewSafetySnapshot {
  return {
    consentStatus: lead.consentStatus,
    contactabilityStatus: lead.contactabilityStatus,
    consentEvidenceReferences: nonBlankUnique(lead.consentEvidenceReferences),
    auditEvidenceReferences: nonBlankUnique(lead.auditEvidenceReferences),
    suppressionInstructions: (lead.suppressionInstructions ?? []).map(
      (item) => ({
        ...item,
      }),
    ),
  };
}

function maskName(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => `${Array.from(part)[0] ?? "*"}***`)
    .join(" ");
}

function summarize(lead: DeduplicationLead): MaskedLeadSummary {
  return {
    leadId: lead.id ?? null,
    companyName: lead.companyName.normalize("NFC").trim(),
    contactName: maskName(lead.contactName),
    phone: maskPhoneForDisplay(lead.phoneNormalized),
    email: maskEmailForDisplay(lead.emailNormalized),
    district: lead.district?.normalize("NFC").trim() || null,
  };
}

function normalizedPhoneKey(value: string | null): string | null {
  if (value === null) return null;
  const result = normalizePhone(value);
  return result.status === "VALID" ? result.normalizedKey : null;
}

function normalizedEmailKey(value: string | null): string | null {
  if (value === null) return null;
  const result = normalizeEmail(value);
  return result.status === "VALID" ? result.normalizedKey : null;
}

function normalizedDistrict(value: string | null): string | null {
  if (value === null) return null;
  const result = value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("vi-VN");
  return result === "" ? null : result;
}

function normalizedTaxId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const result = value
    .normalize("NFKC")
    .trim()
    .replace(/[\s.-]/gu, "")
    .toUpperCase();
  return result === "" ? null : result;
}

function hasRestrictedState(snapshot: ReviewSafetySnapshot): boolean {
  return (
    snapshot.consentStatus === "OPTED_OUT" ||
    snapshot.contactabilityStatus === "OPTED_OUT" ||
    snapshot.contactabilityStatus === "SUPPRESSED" ||
    snapshot.suppressionInstructions.length > 0
  );
}

function hasRestrictionConflict(
  left: ReviewSafetySnapshot,
  right: ReviewSafetySnapshot,
): boolean {
  const leftRestricted = hasRestrictedState(left);
  const rightRestricted = hasRestrictedState(right);
  if (!leftRestricted && !rightRestricted) return false;
  return (
    left.consentStatus !== right.consentStatus ||
    left.contactabilityStatus !== right.contactabilityStatus ||
    leftRestricted !== rightRestricted
  );
}

function compareMatchTypes(
  incoming: DeduplicationLead,
  candidate: DeduplicationLead,
  allowTaxId: boolean,
): DuplicateMatchType[] {
  const exactMatches: DuplicateMatchType[] = [];
  const incomingPhone = normalizedPhoneKey(incoming.phoneNormalized);
  const candidatePhone = normalizedPhoneKey(candidate.phoneNormalized);
  if (incomingPhone !== null && incomingPhone === candidatePhone) {
    exactMatches.push("EXACT_PHONE");
  }

  const incomingEmail = normalizedEmailKey(incoming.emailNormalized);
  const candidateEmail = normalizedEmailKey(candidate.emailNormalized);
  if (incomingEmail !== null && incomingEmail === candidateEmail) {
    exactMatches.push("EXACT_EMAIL");
  }

  if (
    allowTaxId &&
    normalizedTaxId(incoming.taxIdNormalized) !== null &&
    normalizedTaxId(incoming.taxIdNormalized) ===
      normalizedTaxId(candidate.taxIdNormalized)
  ) {
    exactMatches.push("EXACT_TAX_ID");
  }

  if (exactMatches.length > 0) return exactMatches;

  const incomingCompanyKey = normalizeCompanyName(
    incoming.companyName,
  ).matchKey;
  const candidateCompanyKey = normalizeCompanyName(
    candidate.companyName,
  ).matchKey;
  const incomingDistrict = normalizedDistrict(incoming.district);
  const candidateDistrict = normalizedDistrict(candidate.district);
  if (
    incomingCompanyKey !== "" &&
    incomingCompanyKey === candidateCompanyKey &&
    incomingDistrict !== null &&
    incomingDistrict === candidateDistrict
  ) {
    return ["COMPANY_DISTRICT"];
  }
  return [];
}

/**
 * Produce review candidates only. Exact keys use P0.3b normalizers; company and
 * district matches are fuzzy suggestions. This function never merges or writes.
 */
export function findDuplicateCandidates(
  incoming: DeduplicationLead,
  existingLeads: readonly (DeduplicationLead & { readonly id: string })[],
  options: FindDuplicateCandidatesOptions,
): DuplicateReviewGroup {
  const reviewGroupId = options.reviewGroupId.trim();
  const allowTaxId =
    options.taxIdMatchAuthorization?.explicitlyMapped === true &&
    options.taxIdMatchAuthorization.permissionApproved === true;
  const incomingSafetySnapshot = snapshotSafety(incoming);
  const candidates = existingLeads
    .flatMap((lead): DuplicateReviewCandidate[] => {
      const leadId = lead.id.trim();
      if (leadId === "" || leadId === incoming.id) return [];
      const matchTypes = compareMatchTypes(incoming, lead, allowTaxId);
      if (matchTypes.length === 0) return [];
      const orderedTypes = MATCH_ORDER.filter((type) =>
        matchTypes.includes(type),
      );
      const safetySnapshot = snapshotSafety(lead);
      return [
        {
          leadId,
          display: summarize(lead),
          matchTypes: orderedTypes,
          reasons: orderedTypes.map((type) => MATCH_REASON[type]),
          confidence: orderedTypes.includes("COMPANY_DISTRICT")
            ? "FUZZY"
            : "EXACT",
          decisionRequired: true,
          autoMerged: false,
          restrictionConflict: hasRestrictionConflict(
            incomingSafetySnapshot,
            safetySnapshot,
          ),
          safetySnapshot,
        },
      ];
    })
    .sort((left, right) => left.leadId.localeCompare(right.leadId));

  return {
    reviewGroupId,
    incoming: summarize(incoming),
    incomingSafetySnapshot,
    candidates,
    reviewRequired: candidates.length > 0,
  };
}

function combineConsentStatuses(
  statuses: readonly ConsentStatus[],
): ConsentStatus {
  if (statuses.includes("OPTED_OUT")) return "OPTED_OUT";
  if (statuses.includes("REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  if (statuses.includes("UNKNOWN")) return "UNKNOWN";
  return statuses.includes("ALLOWED_FOR_RECORDED_PURPOSE")
    ? "ALLOWED_FOR_RECORDED_PURPOSE"
    : "UNKNOWN";
}

function mergeSafetySummary(
  left: ReviewSafetySnapshot,
  right: ReviewSafetySnapshot,
): MergeSafetySummary {
  const consentStatuses = [left.consentStatus, right.consentStatus];
  const contactabilityStatuses = [
    left.contactabilityStatus,
    right.contactabilityStatus,
  ];
  const optOutPresent = consentStatuses.includes("OPTED_OUT");
  const suppressionInstructions = [
    ...left.suppressionInstructions,
    ...right.suppressionInstructions,
  ];
  if (
    optOutPresent &&
    !suppressionInstructions.some(
      (instruction) =>
        instruction.reason === "OPT_OUT" &&
        instruction.scope === "ALL_CHANNELS",
    )
  ) {
    suppressionInstructions.push({
      required: true,
      reason: "OPT_OUT",
      scope: "ALL_CHANNELS",
    });
  }

  return {
    effectiveConsentStatus: combineConsentStatuses(consentStatuses),
    effectiveContactabilityStatus: combineContactabilityStatuses(
      contactabilityStatuses,
    ),
    suppressionMustRemain:
      optOutPresent ||
      contactabilityStatuses.includes("OPTED_OUT") ||
      contactabilityStatuses.includes("SUPPRESSED") ||
      suppressionInstructions.length > 0,
    preservedConsentEvidenceReferences: nonBlankUnique([
      ...left.consentEvidenceReferences,
      ...right.consentEvidenceReferences,
    ]),
    preservedAuditEvidenceReferences: nonBlankUnique([
      ...left.auditEvidenceReferences,
      ...right.auditEvidenceReferences,
    ]),
    preservedSuppressionInstructions: suppressionInstructions,
  };
}

/**
 * Validate AM's choice and return a non-persistent command contract. A merge
 * decision carries fail-closed statuses and evidence/suppression references for
 * P0.4b; it is not an implementation of persistence or a database transaction.
 */
export function createReviewDecision(
  group: DuplicateReviewGroup,
  request: ReviewDecisionRequest,
): CreateReviewDecisionResult {
  if (group.reviewGroupId.trim() === "") {
    return { valid: false, errorCode: "REVIEW_GROUP_ID_REQUIRED" };
  }
  if (request.action === "KEEP") {
    return {
      valid: true,
      decision: {
        reviewGroupId: group.reviewGroupId,
        action: "KEEP",
        targetLeadId: null,
        persistence: "NOT_PERFORMED",
      },
    };
  }
  if (request.action === "SKIP") {
    return {
      valid: true,
      decision: {
        reviewGroupId: group.reviewGroupId,
        action: "SKIP",
        targetLeadId: null,
        persistence: "NOT_PERFORMED",
      },
    };
  }
  if (group.candidates.length === 0) {
    return { valid: false, errorCode: "CANDIDATES_REQUIRED" };
  }
  if (request.targetLeadId.trim() === "") {
    return { valid: false, errorCode: "MERGE_TARGET_REQUIRED" };
  }
  const target = group.candidates.find(
    (candidate) => candidate.leadId === request.targetLeadId,
  );
  if (!target) {
    return { valid: false, errorCode: "MERGE_TARGET_NOT_IN_CANDIDATES" };
  }
  return {
    valid: true,
    decision: {
      reviewGroupId: group.reviewGroupId,
      action: "MERGE",
      targetLeadId: target.leadId,
      persistence: "NOT_PERFORMED",
      safety: mergeSafetySummary(
        group.incomingSafetySnapshot,
        target.safetySnapshot,
      ),
    },
  };
}
