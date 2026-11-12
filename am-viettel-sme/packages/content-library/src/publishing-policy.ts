import type { PublishPlatform } from "./content-parser.js";

export interface PlatformContentInput {
  readonly title: string;
  readonly body: string;
  readonly hashtags?: readonly string[] | undefined;
  readonly ctaText?: string | null | undefined;
}

export interface PreparedPlatformContent {
  readonly platform: PublishPlatform;
  readonly title: string;
  readonly body: string;
  readonly hashtags: readonly string[];
  readonly formattedText: string;
}

export function preparePlatformContent(
  input: PlatformContentInput,
  platform: PublishPlatform,
): PreparedPlatformContent {
  const maxHashtags = platform === "ZALO" ? 3 : 5;
  const cleanTags = (input.hashtags ?? [])
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, maxHashtags);

  const lines: string[] = [];
  if (input.title.trim()) {
    lines.push(input.title.trim());
  }
  if (input.body.trim()) {
    lines.push(input.body.trim());
  }
  if (input.ctaText?.trim()) {
    lines.push(input.ctaText.trim());
  }
  if (cleanTags.length > 0) {
    lines.push(cleanTags.join(" "));
  }

  return {
    platform,
    title: input.title.trim(),
    body: input.body.trim(),
    hashtags: cleanTags,
    formattedText: lines.join("\n\n"),
  };
}

export type SocialAccountStatus =
  | "ACTIVE"
  | "CONNECTED"
  | "NEEDS_AUTH"
  | "NEEDS_LOGIN"
  | "SESSION_EXPIRED"
  | "PAUSED"
  | "SUSPENDED"
  | "ERROR";

export interface PublishingAccountPolicy {
  readonly accountId: string;
  readonly platform: PublishPlatform;
  readonly status: SocialAccountStatus;
  readonly maxPostsPerDay?: number | undefined;
  readonly minIntervalMinutes?: number | undefined;
  readonly minReuseDays?: number | undefined;
}

export interface SchedulablePostSummary {
  readonly contentId: string;
  readonly postCode: string;
  readonly topicCode: string;
  readonly status: string;
  readonly platforms: readonly PublishPlatform[];
  readonly contentHash: string;
  readonly validFrom?: Date | string | null | undefined;
  readonly validUntil?: Date | string | null | undefined;
}

export interface ExistingPublishHistoryEntry {
  readonly jobId: string;
  readonly accountId: string;
  readonly platform: PublishPlatform;
  readonly contentId: string;
  readonly contentHash: string;
  readonly topicCode: string;
  readonly scheduledAt: Date | string;
  readonly status: string;
}

export interface EvaluatePublishingScheduleInput {
  readonly post: SchedulablePostSummary;
  readonly account: PublishingAccountPolicy;
  readonly scheduledAt: Date;
  readonly existingHistory: readonly ExistingPublishHistoryEntry[];
}

export type ScheduleEvaluationErrorCode =
  | "ACCOUNT_SESSION_EXPIRED"
  | "ACCOUNT_NOT_ACTIVE"
  | "POST_NOT_APPROVED"
  | "POST_EXPIRED"
  | "POST_NOT_YET_ACTIVE"
  | "PLATFORM_NOT_ALLOWED"
  | "DUPLICATE_CONTENT_ON_ACCOUNT"
  | "DAILY_QUOTA_EXCEEDED"
  | "MIN_INTERVAL_VIOLATION";

export interface EvaluatePublishingScheduleResult {
  readonly allowed: boolean;
  readonly errorCode?: ScheduleEvaluationErrorCode | undefined;
  readonly message?: string | undefined;
}

const ACTIVE_ACCOUNT_STATUSES = new Set<string>(["ACTIVE", "CONNECTED"]);
const APPROVED_POST_STATUSES = new Set<string>(["APPROVED", "SCHEDULED", "PUBLISHED"]);
const COUNTED_JOB_STATUSES = new Set<string>([
  "QUEUED",
  "SCHEDULED",
  "VALIDATING",
  "WAITING_SESSION",
  "PREPARING",
  "WAITING_CONFIRMATION",
  "PUBLISHING",
  "PUBLISHED",
]);

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function evaluatePublishingSchedule(
  input: EvaluatePublishingScheduleInput,
): EvaluatePublishingScheduleResult {
  const { post, account, scheduledAt, existingHistory } = input;

  // 1. Account readiness check (PB-SC-006, PB-SC-007)
  if (account.status === "SESSION_EXPIRED" || account.status === "NEEDS_AUTH" || account.status === "NEEDS_LOGIN") {
    return {
      allowed: false,
      errorCode: "ACCOUNT_SESSION_EXPIRED",
      message: `Account "${account.accountId}" session is expired or requires authentication.`,
    };
  }
  if (!ACTIVE_ACCOUNT_STATUSES.has(account.status)) {
    return {
      allowed: false,
      errorCode: "ACCOUNT_NOT_ACTIVE",
      message: `Account "${account.accountId}" is not active (status: ${account.status}).`,
    };
  }

  // 2. Post approval check (PB-SC-003)
  if (!APPROVED_POST_STATUSES.has(post.status)) {
    return {
      allowed: false,
      errorCode: "POST_NOT_APPROVED",
      message: `Post "${post.postCode}" has status "${post.status}" and must be APPROVED before scheduling.`,
    };
  }

  // 3. Post validity window check (PB-SC-010)
  if (post.validFrom) {
    const fromDate = new Date(post.validFrom);
    if (Number.isFinite(fromDate.getTime()) && scheduledAt < fromDate) {
      return {
        allowed: false,
        errorCode: "POST_NOT_YET_ACTIVE",
        message: `Post "${post.postCode}" is not valid before ${fromDate.toISOString()}.`,
      };
    }
  }
  if (post.validUntil) {
    const untilDate = new Date(post.validUntil);
    if (Number.isFinite(untilDate.getTime()) && scheduledAt > untilDate) {
      return {
        allowed: false,
        errorCode: "POST_EXPIRED",
        message: `Post "${post.postCode}" expired at ${untilDate.toISOString()}.`,
      };
    }
  }

  // 4. Platform compatibility check
  if (!post.platforms.includes(account.platform)) {
    return {
      allowed: false,
      errorCode: "PLATFORM_NOT_ALLOWED",
      message: `Post "${post.postCode}" does not allow publishing on ${account.platform}.`,
    };
  }

  const maxPostsPerDay = account.maxPostsPerDay ?? 2;
  const minIntervalMinutes = account.minIntervalMinutes ?? 180;
  const minReuseDays = account.minReuseDays ?? 30;
  const reuseWindowMs = minReuseDays * 24 * 60 * 60 * 1000;
  const minIntervalMs = minIntervalMinutes * 60 * 1000;

  const accountHistory = existingHistory.filter(
    (entry) =>
      entry.accountId === account.accountId && COUNTED_JOB_STATUSES.has(entry.status),
  );

  // 5. Duplicate / Reuse check on same account within cooldown (PB-SC-001, PB-SC-008)
  for (const entry of accountHistory) {
    const isSameContent =
      entry.contentId === post.contentId ||
      (Boolean(entry.contentHash) && entry.contentHash === post.contentHash);
    if (!isSameContent) continue;

    const entryTime = new Date(entry.scheduledAt).getTime();
    if (Number.isFinite(entryTime)) {
      const diffMs = Math.abs(scheduledAt.getTime() - entryTime);
      if (diffMs < reuseWindowMs) {
        return {
          allowed: false,
          errorCode: "DUPLICATE_CONTENT_ON_ACCOUNT",
          message: `Post "${post.postCode}" was already scheduled/published on account "${account.accountId}" within ${minReuseDays} days.`,
        };
      }
    }
  }

  // 6. Daily quota & minimum interval check (PB-SC-004, PB-SC-005)
  let sameDayCount = 0;
  for (const entry of accountHistory) {
    const entryDate = new Date(entry.scheduledAt);
    if (!Number.isFinite(entryDate.getTime())) continue;

    const diffMs = Math.abs(scheduledAt.getTime() - entryDate.getTime());
    if (diffMs < minIntervalMs) {
      return {
        allowed: false,
        errorCode: "MIN_INTERVAL_VIOLATION",
        message: `Scheduled time is within ${minIntervalMinutes} minutes of another post on account "${account.accountId}".`,
      };
    }

    if (sameUtcDay(scheduledAt, entryDate)) {
      sameDayCount += 1;
    }
  }

  if (sameDayCount >= maxPostsPerDay) {
    return {
      allowed: false,
      errorCode: "DAILY_QUOTA_EXCEEDED",
      message: `Account "${account.accountId}" has reached maxPostsPerDay (${maxPostsPerDay}).`,
    };
  }

  return { allowed: true };
}

