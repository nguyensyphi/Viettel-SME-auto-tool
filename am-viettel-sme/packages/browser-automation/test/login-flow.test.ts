import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserProfileManager } from "../src/profile-manager.js";
import type {
  BrowserPageHandle,
  PersistentContextHandle,
  PersistentContextLauncher,
} from "../src/types.js";
import {
  InMemoryAccountSessionStore,
  InteractiveLoginController,
} from "../src/login-flow.js";
import { SessionHealthMonitor } from "../src/health-monitor.js";

interface MockPageConfig {
  currentUrl: string;
  visibleSelectors: Set<string>;
  onWaitTick?: () => void;
}

function createMockPage(cfg: MockPageConfig): BrowserPageHandle {
  return {
    url: () => cfg.currentUrl,
    goto: vi.fn(async (targetUrl: string) => {
      if (!cfg.currentUrl) {
        cfg.currentUrl = targetUrl;
      }
    }),
    locator: (selector: string) => ({
      count: async () => (cfg.visibleSelectors.has(selector) ? 1 : 0),
      first: () => ({
        click: vi.fn(),
        fill: vi.fn(),
        pressSequentially: vi.fn(),
        setInputFiles: vi.fn(),
        isVisible: async () => cfg.visibleSelectors.has(selector),
      }),
    }),
    screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
    waitForTimeout: vi.fn(async () => {
      cfg.onWaitTick?.();
    }),
    close: vi.fn(async () => {}),
  };
}

function createMockContext(page: BrowserPageHandle): PersistentContextHandle & { isClosed: boolean } {
  const listeners: Array<() => void> = [];
  const ctx = {
    isClosed: false,
    pages: () => [page],
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {
      ctx.isClosed = true;
      for (const fn of listeners) fn();
    }),
    on: vi.fn((event: "close", fn: () => void) => {
      if (event === "close") listeners.push(fn);
    }),
  };
  return ctx;
}

describe("Interactive Login & Session Health Monitor (Task 7)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "am-login-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("launches visible browser (headless: false) for AM real QR scan and marks CONNECTED on auth", async () => {
    let ticks = 0;
    const pageCfg: MockPageConfig = {
      currentUrl: "https://id.zalo.me/account?continue=https://chat.zalo.me",
      visibleSelectors: new Set(["[data-testid='qr-code']"]),
      onWaitTick: () => {
        ticks += 1;
        if (ticks >= 2) {
          pageCfg.currentUrl = "https://chat.zalo.me/";
          pageCfg.visibleSelectors = new Set(["#main-tab", "[data-id='div_Main_TabMsg']"]);
        }
      },
    };
    const mockCtx = createMockContext(createMockPage(pageCfg));
    const launchSpy = vi.fn(async () => mockCtx);
    const launcher: PersistentContextLauncher = { launchPersistentContext: launchSpy };

    const profileManager = new BrowserProfileManager({
      storageRootDir: tempRoot,
      launcher,
    });
    const sessionStore = new InMemoryAccountSessionStore();
    const loginController = new InteractiveLoginController(profileManager, sessionStore, {
      pollIntervalMs: 10,
      loginTimeoutMs: 500,
    });

    const result = await loginController.startLoginSession("am_qr_01", "ZALO");

    expect(result.status).toBe("CONNECTED");
    expect(launchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: false }),
    );
    expect(mockCtx.isClosed).toBe(true);
    expect((await sessionStore.getStatus("am_qr_01", "ZALO"))?.status).toBe("CONNECTED");
    expect(profileManager.isProfileActive("am_qr_01")).toBe(false);
  });

  it("returns TIMEOUT, marks NEEDS_LOGIN, and releases profile lock when QR is not scanned in time", async () => {
    const pageCfg: MockPageConfig = {
      currentUrl: "https://id.zalo.me/account",
      visibleSelectors: new Set(["[data-testid='qr-code']"]),
    };
    const mockCtx = createMockContext(createMockPage(pageCfg));
    const profileManager = new BrowserProfileManager({
      storageRootDir: tempRoot,
      launcher: { launchPersistentContext: vi.fn(async () => mockCtx) },
    });
    const sessionStore = new InMemoryAccountSessionStore();

    let fakeNow = 1_000;
    pageCfg.onWaitTick = () => {
      fakeNow += 200;
    };

    const loginController = new InteractiveLoginController(profileManager, sessionStore, {
      pollIntervalMs: 10,
      loginTimeoutMs: 350,
      nowFn: () => fakeNow,
    });

    const result = await loginController.startLoginSession("am_qr_timeout", "ZALO");

    expect(result.status).toBe("TIMEOUT");
    expect(mockCtx.isClosed).toBe(true);
    expect((await sessionStore.getStatus("am_qr_timeout", "ZALO"))?.status).toBe("NEEDS_LOGIN");
    expect(profileManager.isProfileActive("am_qr_timeout")).toBe(false);
  });

  it("checkSessionHealth confirms healthy headless session when authenticated UI is present", async () => {
    const pageCfg: MockPageConfig = {
      currentUrl: "https://www.facebook.com/",
      visibleSelectors: new Set(["[role='navigation']"]),
    };
    const mockCtx = createMockContext(createMockPage(pageCfg));
    const launchSpy = vi.fn(async () => mockCtx);
    const profileManager = new BrowserProfileManager({
      storageRootDir: tempRoot,
      launcher: { launchPersistentContext: launchSpy },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    const monitor = new SessionHealthMonitor(profileManager, sessionStore);

    const healthy = await monitor.checkSessionHealth("am_fb_01", "FACEBOOK");

    expect(healthy).toBe(true);
    expect(launchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: true }),
    );
    expect((await sessionStore.getStatus("am_fb_01", "FACEBOOK"))?.status).toBe("CONNECTED");
    expect(mockCtx.isClosed).toBe(true);
  });

  it("checkSessionHealth detects kicked/expired session, sets NEEDS_LOGIN, and alerts AM", async () => {
    const pageCfg: MockPageConfig = {
      currentUrl: "https://www.facebook.com/login/?next=...",
      visibleSelectors: new Set(["input[name='email']"]),
    };
    const mockCtx = createMockContext(createMockPage(pageCfg));
    const profileManager = new BrowserProfileManager({
      storageRootDir: tempRoot,
      launcher: { launchPersistentContext: vi.fn(async () => mockCtx) },
    });
    const sessionStore = new InMemoryAccountSessionStore();
    await sessionStore.setStatus("am_fb_kicked", "FACEBOOK", "CONNECTED");

    const alertSpy = vi.fn(async () => {});
    const monitor = new SessionHealthMonitor(profileManager, sessionStore, {
      onSessionExpired: alertSpy,
    });

    const healthy = await monitor.checkSessionHealth("am_fb_kicked", "FACEBOOK");

    expect(healthy).toBe(false);
    expect((await sessionStore.getStatus("am_fb_kicked", "FACEBOOK"))?.status).toBe("NEEDS_LOGIN");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "am_fb_kicked",
        platform: "FACEBOOK",
      }),
    );
    expect(mockCtx.isClosed).toBe(true);
  });
});
