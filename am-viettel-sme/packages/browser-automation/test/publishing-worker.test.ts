import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountCircuitBreaker,
  InMemoryCircuitBreakerStore,
  InMemoryKillSwitchStore,
  KillSwitchController,
} from "@am-sme/config";
import { InMemoryAccountSessionStore } from "../src/login-flow.js";
import { BrowserProfileManager } from "../src/profile-manager.js";
import type {
  BrowserPageHandle,
  PersistentContextHandle,
} from "../src/types.js";
import { PublishingWorker } from "../src/publishing-worker.js";

function createPublisherMockPage(options: {
  url: string;
  visibleSelectors: string[];
}) {
  const visible = new Set(options.visibleSelectors);
  const clickedSelectors: string[] = [];
  const typedEntries: Array<{ selector: string; text: string; delay?: number | undefined }> = [];
  const uploadedFiles: Array<{ selector: string; files: readonly string[] }> = [];

  const page: BrowserPageHandle = {
    url: () => options.url,
    goto: vi.fn(async () => {}),
    locator: (selector: string) => ({
      count: async () => (visible.has(selector) ? 1 : 0),
      first: () => ({
        click: vi.fn(async () => {
          clickedSelectors.push(selector);
        }),
        fill: vi.fn(async () => {}),
        pressSequentially: vi.fn(async (text: string, opts?: { delay?: number | undefined }) => {
          typedEntries.push({ selector, text, delay: opts?.delay });
        }),
        setInputFiles: vi.fn(async (files: string | readonly string[]) => {
          const arr = typeof files === "string" ? [files] : files;
          uploadedFiles.push({ selector, files: arr });
        }),
        isVisible: async () => visible.has(selector),
      }),
    }),
    screenshot: vi.fn(async (opts?: { path?: string | undefined }) => {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      if (opts?.path) {
        fs.mkdirSync(path.dirname(opts.path), { recursive: true });
        fs.writeFileSync(opts.path, bytes);
      }
      return bytes;
    }),
    waitForTimeout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };

  return { page, clickedSelectors, typedEntries, uploadedFiles };
}

function wrapContext(page: BrowserPageHandle): PersistentContextHandle & { isClosed: boolean } {
  const listeners: Array<() => void> = [];
  const ctx = {
    isClosed: false,
    pages: () => [page],
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {
      ctx.isClosed = true;
      for (const fn of listeners) fn();
    }),
    on: vi.fn((ev: "close", fn: () => void) => {
      if (ev === "close") listeners.push(fn);
    }),
  };
  return ctx;
}

describe("PublishingWorker — Playwright Full-Auto, Semi-Auto & Session Safety (Task 10)", () => {
  let tempDir: string;
  let sampleImagePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-publish-test-"));
    sampleImagePath = path.join(tempDir, "banner.png");
    fs.writeFileSync(sampleImagePath, new Uint8Array([1, 2, 3]));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("executes FULL_AUTO Facebook post with natural typing delay, media upload, and screenshot proof", async () => {
    const mock = createPublisherMockPage({
      url: "https://www.facebook.com/",
      visibleSelectors: [
        "[role='navigation']",
        "[role='button'][aria-label*='What']",
        "[role='textbox']",
        "input[type='file']",
        "[aria-label='Post']",
      ],
    });
    const ctx = wrapContext(mock.page);

    const profileManager = new BrowserProfileManager({
      storageRootDir: tempDir,
      launcher: { launchPersistentContext: vi.fn(async () => ctx) },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    const worker = new PublishingWorker({
      profileManager,
      sessionStore,
      evidenceDir: path.join(tempDir, "evidence"),
    });

    const result = await worker.executePublishingJob({
      jobId: "job-fb-01",
      accountId: "am_01",
      platform: "FACEBOOK",
      contentId: "POST-001",
      content: "Chia sẻ giải pháp chữ ký số doanh nghiệp SME.",
      mediaPaths: [sampleImagePath],
      mode: "FULL_AUTO",
    });

    expect(result.status).toBe("PUBLISHED");
    expect(mock.typedEntries).toHaveLength(1);
    expect(mock.typedEntries[0]?.text).toContain("chữ ký số");
    expect(mock.typedEntries[0]?.delay).toBeGreaterThanOrEqual(20);
    expect(mock.uploadedFiles[0]?.files).toEqual([sampleImagePath]);
    expect(result.screenshotPath).toBeDefined();
    expect(fs.existsSync(result.screenshotPath!)).toBe(true);
    expect(ctx.isClosed).toBe(true);
  });

  it("pauses before clicking submit in SEMI_AUTO mode when AM has not yet confirmed submission", async () => {
    const mock = createPublisherMockPage({
      url: "https://chat.zalo.me/",
      visibleSelectors: [
        "#main-tab",
        "[data-testid='compose-post']",
        "[contenteditable='true']",
        "[data-testid='submit-post']",
      ],
    });
    const ctx = wrapContext(mock.page);

    const profileManager = new BrowserProfileManager({
      storageRootDir: tempDir,
      launcher: { launchPersistentContext: vi.fn(async () => ctx) },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    const worker = new PublishingWorker({
      profileManager,
      sessionStore,
      evidenceDir: path.join(tempDir, "evidence"),
    });

    const result = await worker.executePublishingJob({
      jobId: "job-zalo-semi",
      accountId: "am_02",
      platform: "ZALO",
      contentId: "POST-002",
      content: "Bản nháp chờ AM xác nhận đăng",
      mode: "SEMI_AUTO",
      amApprovedSubmission: false,
    });

    expect(result.status).toBe("AWAITING_AM_CONFIRMATION");
    expect(mock.clickedSelectors).not.toContain("[data-testid='submit-post']");
    expect(result.screenshotPath).toBeDefined();
    expect(ctx.isClosed).toBe(true);
  });

  it("handles mid-job expired QR/session gracefully: sets NEEDS_LOGIN, alerts AM, does not submit", async () => {
    const mock = createPublisherMockPage({
      url: "https://id.zalo.me/account",
      visibleSelectors: ["[data-testid='qr-code']"],
    });
    const ctx = wrapContext(mock.page);
    const alertSpy = vi.fn(async () => {});

    const profileManager = new BrowserProfileManager({
      storageRootDir: tempDir,
      launcher: { launchPersistentContext: vi.fn(async () => ctx) },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    const worker = new PublishingWorker({
      profileManager,
      sessionStore,
      evidenceDir: path.join(tempDir, "evidence"),
      onSessionExpired: alertSpy,
    });

    const result = await worker.executePublishingJob({
      jobId: "job-zalo-expired",
      accountId: "am_expired",
      platform: "ZALO",
      contentId: "POST-003",
      content: "Không được phép chạy khi hết phiên",
      mode: "FULL_AUTO",
    });

    expect(result.status).toBe("NEEDS_LOGIN");
    expect((await sessionStore.getStatus("am_expired", "ZALO"))?.status).toBe("NEEDS_LOGIN");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(ctx.isClosed).toBe(true);
  });

  it("halts immediately without opening browser when Kill Switch or Account Circuit Breaker is tripped", async () => {
    const launchSpy = vi.fn();
    const profileManager = new BrowserProfileManager({
      storageRootDir: tempDir,
      launcher: { launchPersistentContext: launchSpy },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());
    const circuitBreaker = new AccountCircuitBreaker(new InMemoryCircuitBreakerStore(), {
      failureThreshold: 2,
    });

    const worker = new PublishingWorker({
      profileManager,
      sessionStore,
      evidenceDir: path.join(tempDir, "evidence"),
      killSwitch,
      circuitBreaker,
    });

    await circuitBreaker.recordFailure("am_tripped", "e1");
    await circuitBreaker.recordFailure("am_tripped", "e2");

    const circuitRes = await worker.executePublishingJob({
      jobId: "job-tripped",
      accountId: "am_tripped",
      platform: "ZALO",
      contentId: "POST-004",
      content: "Chặn bởi Circuit Breaker",
      mode: "FULL_AUTO",
    });
    expect(circuitRes.status).toBe("HALTED_CIRCUIT_OPEN");
    expect(launchSpy).not.toHaveBeenCalled();

    await killSwitch.activateKillSwitch("Admin emergency stop", "admin-01");
    const ksRes = await worker.executePublishingJob({
      jobId: "job-ks",
      accountId: "am_healthy",
      platform: "FACEBOOK",
      contentId: "POST-005",
      content: "Chặn bởi Kill Switch",
      mode: "FULL_AUTO",
    });
    expect(ksRes.status).toBe("HALTED_KILL_SWITCH");
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it("short-circuits known NEEDS_LOGIN/SUSPENDED sessions before launching browser, fails closed when file input is missing, and supports Vietnamese FB selectors", async () => {
    const launchSpy = vi.fn();
    const profileManager = new BrowserProfileManager({
      storageRootDir: tempDir,
      launcher: { launchPersistentContext: launchSpy },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    await sessionStore.setStatus("am_known_expired", "ZALO", "NEEDS_LOGIN", "QR_EXPIRED");

    const workerPreCheck = new PublishingWorker({
      profileManager,
      sessionStore,
      evidenceDir: path.join(tempDir, "evidence"),
    });

    const preRes = await workerPreCheck.executePublishingJob({
      jobId: "job-precheck",
      accountId: "am_known_expired",
      platform: "ZALO",
      contentId: "POST-PRE",
      content: "Không mở Chromium khi đã biết NEEDS_LOGIN",
      mode: "FULL_AUTO",
    });
    expect(preRes.status).toBe("NEEDS_LOGIN");
    expect(launchSpy).not.toHaveBeenCalled();

    // Fail-closed when mediaPaths is provided but input[type='file'] is missing
    const noFileInputMock = createPublisherMockPage({
      url: "https://www.facebook.com/",
      visibleSelectors: [
        "[role='navigation']",
        "[role='button'][aria-label*='Bạn đang nghĩ gì']",
        "[role='textbox']",
        "[aria-label='Đăng']",
      ],
    });
    const noFileCtx = wrapContext(noFileInputMock.page);
    const workerMediaGuard = new PublishingWorker({
      profileManager: new BrowserProfileManager({
        storageRootDir: tempDir,
        launcher: { launchPersistentContext: vi.fn(async () => noFileCtx) },
      }),
      sessionStore: new InMemoryAccountSessionStore(),
      evidenceDir: path.join(tempDir, "evidence"),
    });

    const missingInputRes = await workerMediaGuard.executePublishingJob({
      jobId: "job-missing-file-input",
      accountId: "am_vn_fb",
      platform: "FACEBOOK",
      contentId: "POST-MEDIA-FAIL",
      content: "Bài bắt buộc có ảnh nhưng thiếu input file",
      mediaPaths: [sampleImagePath],
      mode: "FULL_AUTO",
    });
    expect(missingInputRes.status).toBe("FAILED");
    expect(missingInputRes.reason).toMatch(/FILE_INPUT_NOT_FOUND/);

    // Vietnamese Facebook selectors succeed when input[type='file'] is present
    const vnFbMock = createPublisherMockPage({
      url: "https://www.facebook.com/",
      visibleSelectors: [
        "[role='navigation']",
        "[role='button'][aria-label*='Bạn đang nghĩ gì']",
        "[role='textbox']",
        "input[type='file']",
        "[aria-label='Đăng']",
      ],
    });
    const vnFbCtx = wrapContext(vnFbMock.page);
    const workerVnFb = new PublishingWorker({
      profileManager: new BrowserProfileManager({
        storageRootDir: tempDir,
        launcher: { launchPersistentContext: vi.fn(async () => vnFbCtx) },
      }),
      sessionStore: new InMemoryAccountSessionStore(),
      evidenceDir: path.join(tempDir, "evidence"),
    });

    const vnRes = await workerVnFb.executePublishingJob({
      jobId: "job-vn-fb-ok",
      accountId: "am_vn_fb_2",
      platform: "FACEBOOK",
      contentId: "POST-VN-FB",
      content: "Đăng bài trên giao diện Facebook tiếng Việt",
      mediaPaths: [sampleImagePath],
      mode: "FULL_AUTO",
    });
    expect(vnRes.status).toBe("PUBLISHED");
    expect(vnFbMock.clickedSelectors).toContain("[aria-label='Đăng']");
  });
});

