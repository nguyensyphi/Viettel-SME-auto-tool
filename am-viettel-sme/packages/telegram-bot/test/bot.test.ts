import { describe, expect, it, vi } from "vitest";
import {
  InMemoryKillSwitchStore,
  KillSwitchController,
} from "@am-sme/config";
import { TelegramAdminBot } from "../src/bot.js";
import { TelegramAlertDispatcher } from "../src/alerts.js";

describe("TelegramAdminBot & TelegramAlertDispatcher — Shared Core Operations (Task 13)", () => {
  it("enforces fail-closed operator whitelist and handles /dashboard, /jobs, /pause, /resume", async () => {
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    const transport = {
      sendMessage: vi.fn(async (chatId: string, text: string) => {
        sentMessages.push({ chatId, text });
      }),
    };

    const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());

    const bot = new TelegramAdminBot({
      allowedOperatorIds: ["tg_admin_01"],
      killSwitch,
      transport,
      getDashboardSnapshot: async () => ({
        connectedAccounts: 3,
        needsLoginAccounts: 1,
        pendingReviewLeads: 14,
        activeCampaigns: 2,
      }),
      getQueueJobsSnapshot: async () => ({
        waiting: 5,
        active: 1,
        completed: 120,
        failed: 2,
        dlqCount: 1,
      }),
    });

    const unauthorized = await bot.handleUpdate({
      operatorId: "tg_stranger_99",
      chatId: "chat_stranger",
      text: "/pause Hack attempt",
    });
    expect(unauthorized.authorized).toBe(false);
    expect(await killSwitch.isKillSwitchActive()).toBe(false);

    const dashRes = await bot.handleUpdate({
      operatorId: "tg_admin_01",
      chatId: "chat_admin",
      text: "/dashboard",
    });
    expect(dashRes.authorized).toBe(true);
    expect(dashRes.replyText).toContain("3");
    expect(dashRes.replyText).toContain("NEEDS_LOGIN: 1");

    const jobsRes = await bot.handleUpdate({
      operatorId: "tg_admin_01",
      chatId: "chat_admin",
      text: "/jobs",
    });
    expect(jobsRes.replyText).toContain("DLQ: 1");

    await bot.handleUpdate({
      operatorId: "tg_admin_01",
      chatId: "chat_admin",
      text: "/pause Zalo checkpoint spike",
    });
    expect(await killSwitch.isKillSwitchActive()).toBe(true);

    await bot.handleUpdate({
      operatorId: "tg_admin_01",
      chatId: "chat_admin",
      text: "/resume",
    });
    expect(await killSwitch.isKillSwitchActive()).toBe(false);
    expect(sentMessages.length).toBeGreaterThanOrEqual(4);
  });

  it("dispatches system alerts (NEEDS_LOGIN, CIRCUIT_OPEN) and strictly blocks passwords, QR images, or raw PII", async () => {
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    const transport = {
      sendMessage: vi.fn(async (chatId: string, text: string) => {
        sentMessages.push({ chatId, text });
      }),
    };

    const alerts = new TelegramAlertDispatcher({
      adminChatIds: ["chat_admin"],
      transport,
    });

    await alerts.sendSystemAlert({
      type: "NEEDS_LOGIN",
      accountId: "am_01",
      platform: "ZALO",
      detail: "Phiên đăng nhập Zalo hết hạn, vui lòng mở Web Dashboard trên máy trạm để quét lại mã.",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain("NEEDS_LOGIN");
    expect(sentMessages[0]?.text).toContain("am_01");

    await expect(
      alerts.sendSystemAlert({
        type: "SECURITY_WARNING",
        accountId: "am_01",
        detail: "Mật khẩu đăng nhập là password: Secret123!",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);

    await expect(
      alerts.sendSystemAlert({
        type: "NEEDS_LOGIN",
        accountId: "am_01",
        detail: "Quét QR tại data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);

    await expect(
      alerts.sendSystemAlert({
        type: "DLQ_JOB",
        accountId: "am_01",
        detail: "Khách hàng CCCD 079091234567 lỗi gửi tin",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);

    // Also blocks Bearer tokens, Telegram bot tokens, QR image URLs, and DOB PII
    await expect(
      alerts.sendSystemAlert({
        type: "SECURITY_WARNING",
        detail: "Header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);

    await expect(
      alerts.sendSystemAlert({
        type: "NEEDS_LOGIN",
        detail: "Ảnh mã quét tại https://internal.local/qr-login-am01.png",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);

    await expect(
      alerts.sendSystemAlert({
        type: "DLQ_JOB",
        detail: "Đại diện SN: 14/02/1988 lỗi đồng bộ",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);

    // Enforces allowedChatIds allow-list even if operatorId is whitelisted
    const chatGuardedBot = new TelegramAdminBot({
      allowedOperatorIds: ["tg_admin_01"],
      allowedChatIds: ["chat_admin_private"],
      killSwitch: new KillSwitchController(new InMemoryKillSwitchStore()),
      transport,
      getDashboardSnapshot: async () => ({
        connectedAccounts: 1,
        needsLoginAccounts: 0,
        pendingReviewLeads: 0,
        activeCampaigns: 0,
      }),
      getQueueJobsSnapshot: async () => ({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        dlqCount: 0,
      }),
    });

    const unapprovedChat = await chatGuardedBot.handleUpdate({
      operatorId: "tg_admin_01",
      chatId: "public_group_chat_999",
      text: "/dashboard@am_sme_bot",
    });
    expect(unapprovedChat.authorized).toBe(false);

    const approvedChatWithSuffix = await chatGuardedBot.handleUpdate({
      operatorId: "tg_admin_01",
      chatId: "chat_admin_private",
      text: "/dashboard@am_sme_bot",
    });
    expect(approvedChatWithSuffix.authorized).toBe(true);
    expect(approvedChatWithSuffix.command).toBe("/dashboard");
  });

  it("PB-P10: dispatches Personal Branding notifications (SESSION_EXPIRED, WAITING_CONFIRMATION, JOB_FAILED, MORNING_DIGEST) and blocks QR/tokens", async () => {
    const sentMessages: Array<{ chatId: string; text: string }> = [];
    const transport = {
      sendMessage: vi.fn(async (chatId: string, text: string) => {
        sentMessages.push({ chatId, text });
      }),
    };

    const alerts = new TelegramAlertDispatcher({
      adminChatIds: ["chat_am_01"],
      transport,
    });

    await alerts.sendPublishingNotification({
      event: "WAITING_CONFIRMATION",
      accountCode: "zalo-dian-am01",
      platform: "ZALO",
      postCode: "PB001",
      postTitle: "Vì sao doanh nghiệp mới nên dùng Chữ ký số Viettel-CA?",
      dashboardUrl: "http://127.0.0.1:3000/publishing/jobs/job-1",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.text).toContain("WAITING_CONFIRMATION");
    expect(sentMessages[0]?.text).toContain("PB001");
    expect(sentMessages[0]?.text).toContain("zalo-dian-am01");

    await alerts.sendMorningScheduleDigest({
      dateLabel: "2026-11-11",
      scheduledCount: 3,
      waitingConfirmationCount: 1,
      expiredAccountsCount: 0,
      items: [
        {
          timeLabel: "08:30",
          accountCode: "zalo-dian-am01",
          platform: "ZALO",
          postCode: "PB001",
          topicCode: "CHU_KY_SO",
        },
      ],
    });

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1]?.text).toContain("2026-11-11");
    expect(sentMessages[1]?.text).toContain("PB001");

    // Must block if someone tries to smuggle a QR image link in postTitle or reason
    await expect(
      alerts.sendPublishingNotification({
        event: "SESSION_EXPIRED",
        accountCode: "zalo-dian-am01",
        platform: "ZALO",
        reason: "Quét mã tại https://internal.local/qrcode-zalo.png",
      }),
    ).rejects.toThrow(/FORBIDDEN_TELEGRAM_PAYLOAD/);
  });
});

