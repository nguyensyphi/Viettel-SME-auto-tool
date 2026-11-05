import { describe, expect, it } from "vitest";
import type { ParsedPost } from "../src/content-parser.js";
import type { MediaAsset } from "../src/google-drive-connector.js";
import { matchMediaToPost } from "../src/media-matcher.js";
import { PublishingScheduler } from "../src/publishing-scheduler.js";

const sampleAssets: MediaAsset[] = [
  {
    assetId: "a1",
    fileName: "POST-CA-001_main.png",
    mimeType: "image/png",
    localPath: "/tmp/a1.png",
    contentIdHint: "POST-CA-001",
  },
  {
    assetId: "a2",
    fileName: "CHU_KY_SO_generic.jpg",
    mimeType: "image/jpeg",
    localPath: "/tmp/a2.jpg",
    topicHint: "CHU_KY_SO",
  },
];

describe("Media Matcher & Publishing Scheduler (Task 9)", () => {
  describe("matchMediaToPost", () => {
    it("prioritizes exact contentId match over generic topic fallback", () => {
      const post: ParsedPost = {
        contentId: "POST-CA-001",
        topic: "CHU_KY_SO",
        mediaRequired: true,
        platforms: ["ZALO"],
        content: "Bài viết chữ ký số",
        lifecycleStatus: "DRAFT",
      };

      const matched = matchMediaToPost(post, sampleAssets);
      expect(matched).toHaveLength(1);
      expect(matched[0]?.assetId).toBe("a1");
    });

    it("falls back to topicHint when no contentId-specific asset exists", () => {
      const post: ParsedPost = {
        contentId: "POST-CA-099",
        topic: "CHU_KY_SO",
        mediaRequired: true,
        platforms: ["ZALO"],
        content: "Bài viết chữ ký số dùng ảnh theo chủ đề",
        lifecycleStatus: "DRAFT",
      };

      const matched = matchMediaToPost(post, sampleAssets);
      expect(matched).toHaveLength(1);
      expect(matched[0]?.assetId).toBe("a2");
    });

    it("blocks fail-closed with REQUIRED_MEDIA_MISSING when mediaRequired is true and no image matches", () => {
      const post: ParsedPost = {
        contentId: "POST-NONE-01",
        topic: "VTRACKING",
        mediaRequired: true,
        platforms: ["FACEBOOK"],
        content: "Bài bắt buộc ảnh nhưng kho ảnh chưa có",
        lifecycleStatus: "DRAFT",
      };

      expect(() => matchMediaToPost(post, sampleAssets)).toThrow(/REQUIRED_MEDIA_MISSING/i);
    });
  });

  describe("PublishingScheduler lifecycle (DRAFT -> APPROVED -> SCHEDULED)", () => {
    it("blocks scheduling a DRAFT post before AM approval and transitions cleanly after approval", () => {
      const scheduler = new PublishingScheduler();
      const post: ParsedPost = {
        contentId: "POST-CA-001",
        topic: "CHU_KY_SO",
        mediaRequired: true,
        platforms: ["ZALO"],
        content: "Nội dung đã kiểm duyệt",
        lifecycleStatus: "DRAFT",
      };

      scheduler.registerDraft(post, sampleAssets);

      // Cannot jump directly from DRAFT -> SCHEDULED without AM approval
      expect(() =>
        scheduler.schedulePost(
          "POST-CA-001",
          "am_01",
          "ZALO",
          new Date("2026-11-06T09:00:00.000Z"),
        ),
      ).toThrow(/POST_NOT_APPROVED/i);

      // Approve post
      const approved = scheduler.approvePost("POST-CA-001", "am_user_01");
      expect(approved.lifecycleStatus).toBe("APPROVED");
      expect(approved.approvedBy).toBe("am_user_01");

      // Disallowed platform rejected
      expect(() =>
        scheduler.schedulePost(
          "POST-CA-001",
          "am_01",
          "FACEBOOK",
          new Date("2026-11-06T09:00:00.000Z"),
        ),
      ).toThrow(/PLATFORM_NOT_ALLOWED/i);

      // Valid schedule produces deterministic idempotencyKey and per-account lockKey
      const scheduled = scheduler.schedulePost(
        "POST-CA-001",
        "am_01",
        "ZALO",
        new Date("2026-11-06T09:00:00.000Z"),
      );

      expect(scheduled.post.lifecycleStatus).toBe("SCHEDULED");
      expect(scheduled.jobSpec.lockKey).toBe("account:am_01");
      expect(scheduled.jobSpec.idempotencyKey).toBe(
        "publish:am_01:ZALO:POST-CA-001:2026-11-06T09:00:00.000Z",
      );
      expect(scheduled.jobSpec.mediaPaths).toEqual(["/tmp/a1.png"]);
    });

    it("allows scheduling an approved multi-platform post across both ZALO and FACEBOOK while rejecting duplicate (accountId, platform) schedules", () => {
      const scheduler = new PublishingScheduler();
      const post: ParsedPost = {
        contentId: "POST-MULTI-01",
        topic: "CHU_KY_SO",
        mediaRequired: false,
        platforms: ["ZALO", "FACEBOOK"],
        content: "Bài đăng đa nền tảng Zalo & Facebook",
        lifecycleStatus: "DRAFT",
      };

      scheduler.registerDraft(post, sampleAssets);
      scheduler.approvePost("POST-MULTI-01", "am_user_01");

      const sZalo = scheduler.schedulePost(
        "POST-MULTI-01",
        "am_01",
        "ZALO",
        new Date("2026-11-06T09:00:00.000Z"),
      );
      expect(sZalo.post.lifecycleStatus).toBe("SCHEDULED");

      const sFb = scheduler.schedulePost(
        "POST-MULTI-01",
        "am_01",
        "FACEBOOK",
        new Date("2026-11-06T09:30:00.000Z"),
      );
      expect(sFb.post.lifecycleStatus).toBe("SCHEDULED");
      expect(sFb.jobSpec.platform).toBe("FACEBOOK");

      expect(() =>
        scheduler.schedulePost(
          "POST-MULTI-01",
          "am_01",
          "ZALO",
          new Date("2026-11-06T09:00:00.000Z"),
        ),
      ).toThrow(/DUPLICATE_SCHEDULE/i);
    });
  });
});

