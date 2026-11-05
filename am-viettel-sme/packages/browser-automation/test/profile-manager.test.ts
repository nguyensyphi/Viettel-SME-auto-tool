import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserProfileManager,
  type PersistentContextHandle,
  type PersistentContextLauncher,
} from "../src/profile-manager.js";

function createFakeContext(): PersistentContextHandle & { closed: boolean } {
  const closeListeners: Array<() => void> = [];
  const handle = {
    closed: false,
    pages: () => [],
    newPage: vi.fn(),
    close: vi.fn(async () => {
      handle.closed = true;
      for (const fn of closeListeners) fn();
    }),
    on: vi.fn((event: "close", listener: () => void) => {
      if (event === "close") closeListeners.push(listener);
    }),
  };
  return handle;
}

describe("BrowserProfileManager — Playwright Persistent Context Isolation (Task 6)", () => {
  let tempStorageRoot: string;

  beforeEach(() => {
    tempStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "am-profiles-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempStorageRoot, { recursive: true, force: true });
  });

  it("isolates each account under storage/browser_profiles/<account_id>", () => {
    const manager = new BrowserProfileManager({ storageRootDir: tempStorageRoot });

    const dirA = manager.getProfileDir("am_001");
    const dirB = manager.getProfileDir("am_002");

    expect(dirA).toBe(path.join(tempStorageRoot, "browser_profiles", "am_001"));
    expect(dirB).toBe(path.join(tempStorageRoot, "browser_profiles", "am_002"));
    expect(dirA).not.toBe(dirB);
  });

  it("rejects path traversal or unsafe account identifiers fail-closed", () => {
    const manager = new BrowserProfileManager({ storageRootDir: tempStorageRoot });

    for (const badId of ["", "   ", "../etc", "am/../../root", "am\\evil", ".hidden", "a"]) {
      expect(() => manager.getProfileDir(badId)).toThrow(/accountId/i);
    }
  });

  it("creates isolated profile directory and launches persistent context with safe options", async () => {
    const fakeCtx = createFakeContext();
    const launchSpy = vi.fn(async () => fakeCtx);
    const launcher: PersistentContextLauncher = {
      launchPersistentContext: launchSpy,
    };

    const manager = new BrowserProfileManager({
      storageRootDir: tempStorageRoot,
      launcher,
    });

    const ctx = await manager.launchAccountBrowser("am_viettel_01", "ZALO", {
      headless: false,
    });

    const expectedDir = path.join(tempStorageRoot, "browser_profiles", "am_viettel_01");
    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(ctx).toBe(fakeCtx);
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(launchSpy).toHaveBeenCalledWith(
      expectedDir,
      expect.objectContaining({
        headless: false,
        acceptDownloads: false,
      }),
    );

    await ctx.close();
  });

  it("blocks launching a second concurrent browser context on the same account profile", async () => {
    const fakeCtx = createFakeContext();
    const launcher: PersistentContextLauncher = {
      launchPersistentContext: vi.fn(async () => fakeCtx),
    };
    const manager = new BrowserProfileManager({
      storageRootDir: tempStorageRoot,
      launcher,
    });

    const ctx1 = await manager.launchAccountBrowser("am_01", "ZALO", { headless: true });

    await expect(
      manager.launchAccountBrowser("am_01", "FACEBOOK", { headless: true }),
    ).rejects.toThrow(/PROFILE_ALREADY_IN_USE/i);

    // Closing releases the profile lock so subsequent jobs can launch cleanly
    await ctx1.close();
    const ctx2 = await manager.launchAccountBrowser("am_01", "FACEBOOK", { headless: true });
    expect(ctx2).toBeDefined();
    await ctx2.close();
  });

  it("forbids proxy bypassing or shared cookie/storageState injection (Ironclad Rule)", async () => {
    const launcher: PersistentContextLauncher = {
      launchPersistentContext: vi.fn(async () => createFakeContext()),
    };
    const manager = new BrowserProfileManager({
      storageRootDir: tempStorageRoot,
      launcher,
    });

    await expect(
      manager.launchAccountBrowser("am_01", "ZALO", {
        headless: true,
        // @ts-expect-error testing forbidden runtime proxy injection
        proxy: { server: "http://1.2.3.4:8080" },
      }),
    ).rejects.toThrow(/PROXY_BYPASS_FORBIDDEN/i);

    await expect(
      manager.launchAccountBrowser("am_01", "ZALO", {
        headless: true,
        // @ts-expect-error testing forbidden shared cookie injection
        storageState: "shared-cookies.json",
      }),
    ).rejects.toThrow(/SHARED_COOKIES_FORBIDDEN/i);
  });
});

