import type {
  ParsedPost,
  PostLifecycleStatus,
  PublishPlatform,
} from "./content-parser.js";
import type { MediaAsset } from "./google-drive-connector.js";
import { matchMediaToPost } from "./media-matcher.js";

export interface ManagedPostRecord extends ParsedPost {
  matchedMedia: MediaAsset[];
  approvedBy?: string | undefined;
  approvedAt?: string | undefined;
  scheduledAt?: string | undefined;
}

export interface ScheduledPublishJobSpec {
  idempotencyKey: string;
  lockKey: string;
  accountId: string;
  platform: PublishPlatform;
  contentId: string;
  content: string;
  mediaPaths: string[];
  publishAtIso: string;
}

export class PublishingScheduler {
  private readonly posts = new Map<string, ManagedPostRecord>();

  registerDraft(
    post: ParsedPost,
    availableAssets: readonly MediaAsset[] = [],
  ): ManagedPostRecord {
    const matchedMedia = matchMediaToPost(post, availableAssets);
    const record: ManagedPostRecord = {
      ...post,
      lifecycleStatus: "DRAFT",
      matchedMedia,
    };
    this.posts.set(post.contentId, record);
    return { ...record };
  }

  approvePost(contentId: string, approvedByAmId: string): ManagedPostRecord {
    const record = this.posts.get(contentId);
    if (!record) {
      throw new Error(`Unknown contentId: ${contentId}`);
    }
    const actor = approvedByAmId?.trim() ?? "";
    if (!actor) {
      throw new Error("approvedByAmId is required to approve a post");
    }
    if (record.lifecycleStatus !== "DRAFT" && record.lifecycleStatus !== "APPROVED") {
      throw new Error(
        `Cannot approve post "${contentId}" from status ${record.lifecycleStatus}`,
      );
    }

    record.lifecycleStatus = "APPROVED";
    record.approvedBy = actor;
    record.approvedAt = new Date().toISOString();
    return { ...record };
  }

  schedulePost(
    contentId: string,
    accountId: string,
    platform: PublishPlatform,
    publishTime: Date,
  ): { post: ManagedPostRecord; jobSpec: ScheduledPublishJobSpec } {
    const record = this.posts.get(contentId);
    if (!record) {
      throw new Error(`Unknown contentId: ${contentId}`);
    }
    if (record.lifecycleStatus !== "APPROVED") {
      throw new Error(
        `POST_NOT_APPROVED: post "${contentId}" is ${record.lifecycleStatus}; AM must approve before scheduling`,
      );
    }
    if (!record.platforms.includes(platform)) {
      throw new Error(
        `PLATFORM_NOT_ALLOWED: post "${contentId}" does not allow platform ${platform}`,
      );
    }

    const cleanAccount = accountId?.trim() ?? "";
    if (!cleanAccount) {
      throw new Error("accountId is required to schedule post");
    }
    if (Number.isNaN(publishTime.getTime())) {
      throw new Error("publishTime must be a valid Date");
    }

    const publishAtIso = publishTime.toISOString();
    record.lifecycleStatus = "SCHEDULED";
    record.scheduledAt = publishAtIso;

    const jobSpec: ScheduledPublishJobSpec = {
      idempotencyKey: `publish:${cleanAccount}:${platform}:${contentId}:${publishAtIso}`,
      lockKey: `account:${cleanAccount}`,
      accountId: cleanAccount,
      platform,
      contentId,
      content: record.content,
      mediaPaths: record.matchedMedia.map((m) => m.localPath),
      publishAtIso,
    };

    return {
      post: { ...record },
      jobSpec,
    };
  }

  markOutcome(contentId: string, status: Extract<PostLifecycleStatus, "PUBLISHED" | "FAILED">): ManagedPostRecord {
    const record = this.posts.get(contentId);
    if (!record) {
      throw new Error(`Unknown contentId: ${contentId}`);
    }
    record.lifecycleStatus = status;
    return { ...record };
  }
}

