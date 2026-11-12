import { describe, expect, it, vi } from "vitest";
import {
  InMemoryKillSwitchStore,
  KillSwitchController,
} from "@am-sme/config";
import { DesktopAgentRunner } from "../src/desktop-agent-runner.js";

describe("DesktopAgentRunner (MOD-OPS-004 — Desktop Queue Polling & Kill Switch Guard)", () => {
  it("halts immediately when system kill switch is active without executing queued jobs", async () => {
    const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());
    await killSwitch.activateKillSwitch("admin-01", "Bảo trì khẩn cấp");

    const executePublishingJob = vi.fn();
    const fetchDueJobs = vi.fn(async () => [
      {
        jobId: "job-1",
        accountId: "zalo-dian-am01",
        platform: "ZALO" as const,
        contentId: "PB001",
        content: "Nội dung bài viết",
        mode: "ASSISTED_PUBLISH" as const,
      },
    ]);

    const runner = new DesktopAgentRunner({
      killSwitch,
      worker: { executePublishingJob } as any,
      queuePort: {
        fetchDueJobs,
        markJobOutcome: vi.fn(async () => {}),
      },
    });

    const summary = await runner.runCycle();
    expect(summary.haltedByKillSwitch).toBe(true);
    expect(summary.processedCount).toBe(0);
    expect(executePublishingJob).not.toHaveBeenCalled();
  });

  it("polls due jobs, executes via PublishingWorker, records outcomes, and notifies on WAITING_CONFIRMATION or NEEDS_LOGIN", async () => {
    const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());
    const markJobOutcome = vi.fn(async () => {});
    const onNotification = vi.fn(async () => {});

    const executePublishingJob = vi
      .fn()
      .mockResolvedValueOnce({
        status: "AWAITING_AM_CONFIRMATION",
        jobId: "job-1",
        accountId: "zalo-dian-am01",
        platform: "ZALO",
        screenshotPath: "storage/evidence/job-1.png",
        completedAt: "2026-11-11T09:00:00.000Z",
      })
      .mockResolvedValueOnce({
        status: "NEEDS_LOGIN",
        jobId: "job-2",
        accountId: "fb-viettel-sme",
        platform: "FACEBOOK",
        reason: "SESSION_EXPIRED",
        completedAt: "2026-11-11T09:01:00.000Z",
      });

    const runner = new DesktopAgentRunner({
      killSwitch,
      worker: { executePublishingJob } as any,
      queuePort: {
        fetchDueJobs: async () => [
          {
            jobId: "job-1",
            accountId: "zalo-dian-am01",
            platform: "ZALO",
            contentId: "PB001",
            content: "Bài đăng 1",
            mode: "ASSISTED_PUBLISH",
          },
          {
            jobId: "job-2",
            accountId: "fb-viettel-sme",
            platform: "FACEBOOK",
            contentId: "PB002",
            content: "Bài đăng 2",
            mode: "AUTO_PUBLISH",
          },
        ],
        markJobOutcome,
      },
      onNotification,
    });

    const summary = await runner.runCycle();
    expect(summary.haltedByKillSwitch).toBe(false);
    expect(summary.processedCount).toBe(2);
    expect(summary.awaitingConfirmationCount).toBe(1);
    expect(summary.needsLoginCount).toBe(1);
    expect(markJobOutcome).toHaveBeenCalledTimes(2);
    expect(onNotification).toHaveBeenCalledTimes(2);
  });
});

