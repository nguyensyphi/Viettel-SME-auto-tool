import type { PublishPlatform } from "./content-parser.js";
import { STANDARD_TOPIC_CATALOG } from "./topic-classifier.js";

export type ValidationStatus = "VALID" | "INVALID" | "NEEDS_REVIEW";

export interface ValidationIssue {
  readonly code:
    | "EMPTY_TITLE"
    | "EMPTY_CONTENT"
    | "EMPTY_POST_ID"
    | "INVALID_TOPIC"
    | "NO_PLATFORMS_SPECIFIED"
    | "MISSING_REQUIRED_MEDIA"
    | "MEDIA_NOT_APPROVED"
    | "MEDIA_TOPIC_MISMATCH"
    | "POST_EXPIRED"
    | "POST_NOT_YET_ACTIVE"
    | "PII_DETECTED"
    | "DUPLICATE_CONTENT_HASH";
  readonly message: string;
}

export interface LinkedMediaSummary {
  readonly id: string;
  readonly topicCode: string;
  readonly status: string;
  readonly isSharedMedia?: boolean | undefined;
}

export interface ContentValidationCandidate {
  readonly postCode: string;
  readonly title: string;
  readonly body: string;
  readonly topicCode: string;
  readonly platforms: readonly PublishPlatform[];
  readonly status: string;
  readonly contentHash: string;
  readonly mediaRequired?: boolean | undefined;
  readonly linkedMedia?: readonly LinkedMediaSummary[] | undefined;
  readonly validFrom?: Date | string | null | undefined;
  readonly validUntil?: Date | string | null | undefined;
}

export interface ContentValidationOptions {
  readonly now?: Date | undefined;
  readonly existingPublishedHashes?: ReadonlySet<string> | undefined;
}

export interface ContentValidationResult {
  readonly valid: boolean;
  readonly status: ValidationStatus;
  readonly issues: readonly ValidationIssue[];
}

const VALID_TOPIC_CODES = new Set(STANDARD_TOPIC_CATALOG.map((t) => t.code));
const VALID_PLATFORMS = new Set<string>(["ZALO", "FACEBOOK"]);

const PII_ID_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\d]{0,15}\d{9,12}\b|\b0\d{11}\b|\b(?:sn|sinh\s*ngày|ngày\s*sinh|dob|birthdate)\b[^\n\r]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)/iu;

export function validateContentForPublishing(
  candidate: ContentValidationCandidate,
  options?: ContentValidationOptions,
): ContentValidationResult {
  const issues: ValidationIssue[] = [];

  if (!candidate.postCode?.trim()) {
    issues.push({
      code: "EMPTY_POST_ID",
      message: "POST_ID must not be empty.",
    });
  }

  if (!candidate.title?.trim()) {
    issues.push({
      code: "EMPTY_TITLE",
      message: "Post title must not be empty.",
    });
  }

  if (!candidate.body?.trim()) {
    issues.push({
      code: "EMPTY_CONTENT",
      message: "Post content body must not be empty.",
    });
  }

  const normTopic = candidate.topicCode?.trim().toUpperCase() ?? "";
  if (!normTopic || normTopic === "NEEDS_CLASSIFICATION" || !VALID_TOPIC_CODES.has(normTopic)) {
    issues.push({
      code: "INVALID_TOPIC",
      message: `Topic "${candidate.topicCode}" is not a valid classified topic.`,
    });
  }

  const validPlatforms = (candidate.platforms ?? []).filter((p) =>
    VALID_PLATFORMS.has(p),
  );
  if (validPlatforms.length === 0) {
    issues.push({
      code: "NO_PLATFORMS_SPECIFIED",
      message: "At least one target platform (ZALO or FACEBOOK) must be specified.",
    });
  }

  // PII Check
  if (PII_ID_PATTERN.test(`${candidate.title}\n${candidate.body}`)) {
    issues.push({
      code: "PII_DETECTED",
      message: "Sensitive personal identifier (CCCD/CMND/DOB) detected in content.",
    });
  }

  // Duplicate hash check
  if (
    options?.existingPublishedHashes &&
    candidate.contentHash &&
    options.existingPublishedHashes.has(candidate.contentHash)
  ) {
    issues.push({
      code: "DUPLICATE_CONTENT_HASH",
      message: "Identical content has already been published.",
    });
  }

  // Validity window check
  const now = options?.now ?? new Date();
  if (candidate.validFrom) {
    const fromDate = new Date(candidate.validFrom);
    if (Number.isFinite(fromDate.getTime()) && now < fromDate) {
      issues.push({
        code: "POST_NOT_YET_ACTIVE",
        message: `Post is only valid starting from ${fromDate.toISOString()}.`,
      });
    }
  }
  if (candidate.validUntil) {
    const untilDate = new Date(candidate.validUntil);
    if (Number.isFinite(untilDate.getTime()) && now > untilDate) {
      issues.push({
        code: "POST_EXPIRED",
        message: `Post expired at ${untilDate.toISOString()}.`,
      });
    }
  }

  // Media validation
  const linked = candidate.linkedMedia ?? [];
  if (candidate.mediaRequired && linked.length === 0) {
    issues.push({
      code: "MISSING_REQUIRED_MEDIA",
      message: "Post requires media but no media asset is linked.",
    });
  }

  for (const media of linked) {
    if (media.status !== "APPROVED") {
      issues.push({
        code: "MEDIA_NOT_APPROVED",
        message: `Linked media "${media.id}" is not APPROVED (current: ${media.status}).`,
      });
    }
    const mediaTopic = media.topicCode?.trim().toUpperCase() ?? "";
    if (!media.isSharedMedia && normTopic && mediaTopic !== normTopic) {
      issues.push({
        code: "MEDIA_TOPIC_MISMATCH",
        message: `Linked media "${media.id}" topic (${mediaTopic}) does not match post topic (${normTopic}).`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    status: issues.length === 0 ? "VALID" : "INVALID",
    issues,
  };
}

