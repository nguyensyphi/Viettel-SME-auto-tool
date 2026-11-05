import { describe, expect, it } from "vitest";
import {
  AccountCircuitBreaker,
  InMemoryCircuitBreakerStore,
  InMemoryKillSwitchStore,
  KillSwitchController,
} from "@am-sme/config";
import { GroupManager } from "../src/group-manager.js";
import { CampaignManager } from "../src/campaign-manager.js";

describe("GroupManager & CampaignManager — Partner & Group Campaign Automation (Task 11)", () => {
  it("categorizes groups (Accounting, Banking, Business) and enforces posting permissions + cooldowns", () => {
    const groupManager = new GroupManager();

    const gAccounting = groupManager.registerGroup({
      groupId: "fb_grp_ketoan_01",
      platform: "FACEBOOK",
      name: "Hội Kế Toán Thuế TP.HCM & Bình Dương",
      url: "https://www.facebook.com/groups/ketoanthuehcm",
      postingPermission: "ALLOWED",
      minHoursBetweenPosts: 24,
    });

    const gBanking = groupManager.registerGroup({
      groupId: "zalo_grp_bank_01",
      platform: "ZALO",
      name: "Cộng đồng Chuyên viên Tín dụng Ngân hàng SME",
      url: "https://zalo.me/g/banksme01",
      postingPermission: "ALLOWED",
      minHoursBetweenPosts: 48,
    });

    const gBusinessReadOnly = groupManager.registerGroup({
      groupId: "fb_grp_dn_readonly",
      platform: "FACEBOOK",
      name: "Hiệp hội Doanh nghiệp Dĩ An",
      url: "https://www.facebook.com/groups/dndian",
      postingPermission: "READ_ONLY",
    });

    expect(gAccounting.category).toBe("ACCOUNTING_TAX");
    expect(gBanking.category).toBe("BANKING_FINANCE");
    expect(gBusinessReadOnly.category).toBe("BUSINESS_ASSOCIATION");

    const t0 = new Date("2026-11-05T09:00:00.000Z");
    expect(groupManager.canPostToGroup("fb_grp_ketoan_01", t0)).toEqual({
      eligible: true,
    });
    expect(groupManager.canPostToGroup("fb_grp_dn_readonly", t0)).toEqual({
      eligible: false,
      reason: "POSTING_NOT_PERMITTED:READ_ONLY",
    });

    groupManager.recordGroupPost("fb_grp_ketoan_01", t0);

    const tPlus12h = new Date("2026-11-05T21:00:00.000Z");
    expect(groupManager.canPostToGroup("fb_grp_ketoan_01", tPlus12h)).toEqual({
      eligible: false,
      reason: "GROUP_COOLDOWN_ACTIVE",
    });

    const tPlus25h = new Date("2026-11-06T10:00:00.000Z");
    expect(groupManager.canPostToGroup("fb_grp_ketoan_01", tPlus25h)).toEqual({
      eligible: true,
    });
  });

  it("creates partner recruitment campaign, requires AM approval, filters eligible groups, and generates idempotent locked jobs", async () => {
    const groupManager = new GroupManager();
    groupManager.registerGroup({
      groupId: "grp_kt_1",
      platform: "FACEBOOK",
      name: "Cộng đồng Kế toán Trưởng SME",
      url: "https://www.facebook.com/groups/kt1",
      postingPermission: "ALLOWED",
    });
    groupManager.registerGroup({
      groupId: "grp_bank_1",
      platform: "FACEBOOK",
      name: "Nhóm Quan hệ Khách hàng Doanh nghiệp Ngân hàng",
      url: "https://www.facebook.com/groups/bank1",
      postingPermission: "PENDING_JOIN",
    });
    groupManager.registerGroup({
      groupId: "grp_dn_1",
      platform: "ZALO",
      name: "CLB Doanh nghiệp Trẻ",
      url: "https://zalo.me/g/dn1",
      postingPermission: "ALLOWED",
    });

    const campaignManager = new CampaignManager({ groupManager });
    const campaign = campaignManager.createCampaign({
      campaignId: "CMP-CTV-2026-11",
      name: "Tuyển Cộng Tác Viên Giới Thiệu Giải Pháp Số SME",
      campaignType: "PARTNER_RECRUITMENT",
      targetCategories: ["ACCOUNTING_TAX", "BANKING_FINANCE"],
      contentTemplate:
        "Hợp tác giới thiệu giải pháp Chữ ký số & Hóa đơn điện tử cho doanh nghiệp mới thành lập. Chính sách hoa hồng trao đổi trực tiếp theo quy định hiện hành.",
    });

    expect(campaign.status).toBe("DRAFT");

    await expect(
      campaignManager.buildDispatchJobs({
        campaignId: "CMP-CTV-2026-11",
        accountId: "am_01",
        dispatchDate: new Date("2026-11-05T09:00:00.000Z"),
      }),
    ).rejects.toThrow(/CAMPAIGN_NOT_APPROVED/);

    campaignManager.approveCampaign("CMP-CTV-2026-11", "am_reviewer_01");

    const dispatch = await campaignManager.buildDispatchJobs({
      campaignId: "CMP-CTV-2026-11",
      accountId: "am_01",
      dispatchDate: new Date("2026-11-05T09:00:00.000Z"),
    });

    expect(dispatch.jobs).toHaveLength(1);
    expect(dispatch.jobs[0]?.groupId).toBe("grp_kt_1");
    expect(dispatch.jobs[0]?.idempotencyKey).toBe(
      "campaign:CMP-CTV-2026-11:group:grp_kt_1:date:2026-11-05",
    );
    expect(dispatch.jobs[0]?.lockKey).toBe("account:am_01");
    expect(dispatch.skippedGroups).toEqual([
      {
        groupId: "grp_bank_1",
        reason: "POSTING_NOT_PERMITTED:PENDING_JOIN",
      },
    ]);
  });

  it("blocks PII in campaign content and halts dispatch when Kill Switch or Account Circuit Breaker is tripped", async () => {
    const groupManager = new GroupManager();
    groupManager.registerGroup({
      groupId: "grp_kt_safe",
      platform: "FACEBOOK",
      name: "Hội Kế toán Việt Nam",
      url: "https://www.facebook.com/groups/ktsafe",
      postingPermission: "ALLOWED",
    });

    const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());
    const circuitBreaker = new AccountCircuitBreaker(
      new InMemoryCircuitBreakerStore(),
      { failureThreshold: 1 },
    );

    const campaignManager = new CampaignManager({
      groupManager,
      killSwitch,
      circuitBreaker,
    });

    expect(() =>
      campaignManager.createCampaign({
        campaignId: "CMP-PII",
        name: "Chiến dịch lỗi PII",
        campaignType: "PARTNER_RECRUITMENT",
        targetCategories: ["ACCOUNTING_TAX"],
        contentTemplate: "Liên hệ AM với số CCCD 079099123456 để mở mã CTV",
      }),
    ).toThrow(/PII_DETECTED/);

    campaignManager.createCampaign({
      campaignId: "CMP-SAFE",
      name: "Chiến dịch hợp lệ",
      campaignType: "PARTNER_RECRUITMENT",
      targetCategories: ["ACCOUNTING_TAX"],
      contentTemplate: "Mời hợp tác giới thiệu giải pháp số doanh nghiệp SME.",
    });
    campaignManager.approveCampaign("CMP-SAFE", "am_01");

    await circuitBreaker.recordFailure("am_tripped", "timeout");
    await expect(
      campaignManager.buildDispatchJobs({
        campaignId: "CMP-SAFE",
        accountId: "am_tripped",
        dispatchDate: new Date("2026-11-05T09:00:00.000Z"),
      }),
    ).rejects.toThrow(/CIRCUIT_BREAKER_OPEN/);

    await killSwitch.activateKillSwitch("Pause all campaigns", "admin_01");
    await expect(
      campaignManager.buildDispatchJobs({
        campaignId: "CMP-SAFE",
        accountId: "am_healthy",
        dispatchDate: new Date("2026-11-05T09:00:00.000Z"),
      }),
    ).rejects.toThrow(/KILL_SWITCH_ACTIVE/);
  });
});
