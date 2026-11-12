import { describe, expect, it } from "vitest";
import {
  preparePlatformContent,
  evaluatePublishingSchedule,
  type PublishingAccountPolicy,
  type ExistingPublishHistoryEntry,
} from "../src/publishing-policy.js";

describe("Platform Content Preparation & Publishing Policy Engine (PB-P06, PB-P07)", () => {
  const activeZaloAccount: PublishingAccountPolicy = {
    accountId: "acc-zalo-01",
    platform: "ZALO",
    status: "ACTIVE",
    maxPostsPerDay: 2,
    minIntervalMinutes: 180,
    minReuseDays: 30,
  };

  const activeFbAccount: PublishingAccountPolicy = {
    accountId: "acc-fb-01",
    platform: "FACEBOOK",
    status: "ACTIVE",
    maxPostsPerDay: 2,
    minIntervalMinutes: 180,
    minReuseDays: 30,
  };

  it("prepares platform-specific content for ZALO (compact, max 3 hashtags) and FACEBOOK (structured, max 5 hashtags)", () => {
    const rawPost = {
      title: "Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?",
      body: "Chữ ký số Viettel-CA giúp ký tờ khai thuế, hóa đơn điện tử và hợp đồng trực tuyến mọi lúc mọi nơi.",
      hashtags: ["#Viettel", "#ChuKySo", "#DoanhNghiep", "#SInvoice", "#vContract", "#SME"],
      ctaText: "Liên hệ AM Viettel để được tư vấn gói ưu đãi.",
    };

    const zaloPrepared = preparePlatformContent(rawPost, "ZALO");
    expect(zaloPrepared.platform).toBe("ZALO");
    expect(zaloPrepared.hashtags).toHaveLength(3);
    expect(zaloPrepared.formattedText).toContain("Vì sao doanh nghiệp mới thành lập");
    expect(zaloPrepared.formattedText).toContain("Liên hệ AM Viettel");
    expect(zaloPrepared.formattedText).toContain("#Viettel #ChuKySo #DoanhNghiep");
    expect(zaloPrepared.formattedText).not.toContain("#SME");

    const fbPrepared = preparePlatformContent(rawPost, "FACEBOOK");
    expect(fbPrepared.platform).toBe("FACEBOOK");
    expect(fbPrepared.hashtags).toHaveLength(5);
    expect(fbPrepared.formattedText).toContain("#vContract");
  });

  it("PB-SC-001 & PB-SC-002 & PB-SC-008: blocks duplicate content on the same account within minReuseDays, but allows different account or after cooldown", () => {
    const history: ExistingPublishHistoryEntry[] = [
      {
        jobId: "job-prev-1",
        accountId: "acc-zalo-01",
        platform: "ZALO",
        contentId: "post-1",
        contentHash: "hash-pb001",
        topicCode: "CHU_KY_SO",
        scheduledAt: "2026-11-01T09:00:00.000Z",
        status: "PUBLISHED",
      },
    ];

    // 1. Same account 10 days later -> blocked (PB-SC-001)
    const dupSameAcc = evaluatePublishingSchedule({
      post: {
        contentId: "post-1",
        postCode: "PB001",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        platforms: ["ZALO", "FACEBOOK"],
        contentHash: "hash-pb001",
      },
      account: activeZaloAccount,
      scheduledAt: new Date("2026-11-11T09:00:00.000Z"),
      existingHistory: history,
    });
    expect(dupSameAcc.allowed).toBe(false);
    expect(dupSameAcc.errorCode).toBe("DUPLICATE_CONTENT_ON_ACCOUNT");

    // 2. Different account (Facebook) on same day -> allowed (PB-SC-002)
    const diffAcc = evaluatePublishingSchedule({
      post: {
        contentId: "post-1",
        postCode: "PB001",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        platforms: ["ZALO", "FACEBOOK"],
        contentHash: "hash-pb001",
      },
      account: activeFbAccount,
      scheduledAt: new Date("2026-11-11T09:00:00.000Z"),
      existingHistory: history,
    });
    expect(diffAcc.allowed).toBe(true);

    // 3. Same account 35 days later (> 30 days minReuseDays) -> allowed (PB-SC-008)
    const afterCooldown = evaluatePublishingSchedule({
      post: {
        contentId: "post-1",
        postCode: "PB001",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        platforms: ["ZALO", "FACEBOOK"],
        contentHash: "hash-pb001",
      },
      account: activeZaloAccount,
      scheduledAt: new Date("2026-12-10T09:00:00.000Z"),
      existingHistory: history,
    });
    expect(afterCooldown.allowed).toBe(true);
  });

  it("PB-SC-003 & PB-SC-010: blocks DRAFT posts and expired posts from scheduling", () => {
    const draftRes = evaluatePublishingSchedule({
      post: {
        contentId: "post-draft",
        postCode: "PB002",
        topicCode: "HOA_DON_DIEN_TU",
        status: "DRAFT",
        platforms: ["ZALO"],
        contentHash: "hash-pb002",
      },
      account: activeZaloAccount,
      scheduledAt: new Date("2026-11-12T09:00:00.000Z"),
      existingHistory: [],
    });
    expect(draftRes.allowed).toBe(false);
    expect(draftRes.errorCode).toBe("POST_NOT_APPROVED");

    const expiredRes = evaluatePublishingSchedule({
      post: {
        contentId: "post-exp",
        postCode: "PB003",
        topicCode: "HOA_DON_DIEN_TU",
        status: "APPROVED",
        platforms: ["ZALO"],
        contentHash: "hash-pb003",
        validUntil: "2026-11-10T23:59:59.000Z",
      },
      account: activeZaloAccount,
      scheduledAt: new Date("2026-11-12T09:00:00.000Z"),
      existingHistory: [],
    });
    expect(expiredRes.allowed).toBe(false);
    expect(expiredRes.errorCode).toBe("POST_EXPIRED");
  });

  it("PB-SC-004 & PB-SC-005: enforces maxPostsPerDay and minIntervalMinutes per account", () => {
    const history: ExistingPublishHistoryEntry[] = [
      {
        jobId: "job-morning",
        accountId: "acc-zalo-01",
        platform: "ZALO",
        contentId: "post-a",
        contentHash: "hash-a",
        topicCode: "CHU_KY_SO",
        scheduledAt: "2026-11-12T08:00:00.000Z",
        status: "SCHEDULED",
      },
    ];

    // 1. Scheduling at 09:30 (only 90 mins after 08:00, < 180 mins required) -> MIN_INTERVAL_VIOLATION (PB-SC-005)
    const tooClose = evaluatePublishingSchedule({
      post: {
        contentId: "post-b",
        postCode: "PB_B",
        topicCode: "HOA_DON_DIEN_TU",
        status: "APPROVED",
        platforms: ["ZALO"],
        contentHash: "hash-b",
      },
      account: activeZaloAccount,
      scheduledAt: new Date("2026-11-12T09:30:00.000Z"),
      existingHistory: history,
    });
    expect(tooClose.allowed).toBe(false);
    expect(tooClose.errorCode).toBe("MIN_INTERVAL_VIOLATION");

    // 2. Add a second valid post at 14:00, then try a third post at 19:00 on the same day -> DAILY_QUOTA_EXCEEDED (PB-SC-004)
    const historyWithTwo: ExistingPublishHistoryEntry[] = [
      ...history,
      {
        jobId: "job-afternoon",
        accountId: "acc-zalo-01",
        platform: "ZALO",
        contentId: "post-b",
        contentHash: "hash-b",
        topicCode: "HOA_DON_DIEN_TU",
        scheduledAt: "2026-11-12T14:00:00.000Z",
        status: "SCHEDULED",
      },
    ];

    const thirdPost = evaluatePublishingSchedule({
      post: {
        contentId: "post-c",
        postCode: "PB_C",
        topicCode: "VCONTRACT",
        status: "APPROVED",
        platforms: ["ZALO"],
        contentHash: "hash-c",
      },
      account: activeZaloAccount,
      scheduledAt: new Date("2026-11-12T19:00:00.000Z"),
      existingHistory: historyWithTwo,
    });
    expect(thirdPost.allowed).toBe(false);
    expect(thirdPost.errorCode).toBe("DAILY_QUOTA_EXCEEDED");
  });

  it("PB-SC-006 & PB-SC-007: blocks scheduling when account is SESSION_EXPIRED or PAUSED or platform is disallowed", () => {
    const expiredAccRes = evaluatePublishingSchedule({
      post: {
        contentId: "post-1",
        postCode: "PB001",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        platforms: ["ZALO"],
        contentHash: "hash-1",
      },
      account: { ...activeZaloAccount, status: "SESSION_EXPIRED" },
      scheduledAt: new Date("2026-11-12T09:00:00.000Z"),
      existingHistory: [],
    });
    expect(expiredAccRes.allowed).toBe(false);
    expect(expiredAccRes.errorCode).toBe("ACCOUNT_SESSION_EXPIRED");

    const pausedAccRes = evaluatePublishingSchedule({
      post: {
        contentId: "post-1",
        postCode: "PB001",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        platforms: ["ZALO"],
        contentHash: "hash-1",
      },
      account: { ...activeZaloAccount, status: "PAUSED" },
      scheduledAt: new Date("2026-11-12T09:00:00.000Z"),
      existingHistory: [],
    });
    expect(pausedAccRes.allowed).toBe(false);
    expect(pausedAccRes.errorCode).toBe("ACCOUNT_NOT_ACTIVE");

    const wrongPlatformRes = evaluatePublishingSchedule({
      post: {
        contentId: "post-1",
        postCode: "PB001",
        topicCode: "CHU_KY_SO",
        status: "APPROVED",
        platforms: ["ZALO"], // Does not allow FACEBOOK
        contentHash: "hash-1",
      },
      account: activeFbAccount,
      scheduledAt: new Date("2026-11-12T09:00:00.000Z"),
      existingHistory: [],
    });
    expect(wrongPlatformRes.allowed).toBe(false);
    expect(wrongPlatformRes.errorCode).toBe("PLATFORM_NOT_ALLOWED");
  });
});

