import fs from "node:fs";
import path from "node:path";
import type {
  PersistentContextHandle,
  PersistentContextLauncher,
  PersistentLaunchOptions,
  SocialPlatform,
} from "./types.js";

export type { PersistentContextHandle, PersistentContextLauncher };

const SAFE_ACCOUNT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;

export interface LaunchAccountOptions {
  headless: boolean;
  viewport?: { width: number; height: number } | undefined;
  channel?: "chrome" | "msedge" | undefined;
}

export interface BrowserProfileManagerOptions {
  storageRootDir?: string | undefined;
  launcher?: PersistentContextLauncher | undefined;
}

async function createDefaultPlaywrightLauncher(): Promise<PersistentContextLauncher> {
  const pw = await import("playwright-core");
  return {
    async launchPersistentContext(
      userDataDir: string,
      options: PersistentLaunchOptions,
    ): Promise<PersistentContextHandle> {
      const ctx = await pw.chromium.launchPersistentContext(userDataDir, {
        headless: options.headless,
        acceptDownloads: options.acceptDownloads,
        viewport: options.viewport ?? { width: 1280, height: 800 },
        ...(options.channel !== undefined ? { channel: options.channel } : {}),
      });
      return ctx as unknown as PersistentContextHandle;
    },
  };
}

export class BrowserProfileManager {
  private readonly profilesBaseDir: string;
  private readonly customLauncher?: PersistentContextLauncher | undefined;
  private readonly activeContexts = new Map<string, PersistentContextHandle>();

  constructor(options?: BrowserProfileManagerOptions) {
    const root = path.resolve(options?.storageRootDir ?? "storage");
    this.profilesBaseDir = path.resolve(root, "browser_profiles");
    this.customLauncher = options?.launcher;
  }

  validateAccountId(accountId: string): string {
    const trimmed = accountId?.trim() ?? "";
    if (!SAFE_ACCOUNT_ID.test(trimmed)) {
      throw new Error(
        "Invalid accountId: must match /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/ for isolated profile safety",
      );
    }
    return trimmed;
  }

  getProfileDir(accountId: string): string {
    const safeId = this.validateAccountId(accountId);
    const resolved = path.resolve(this.profilesBaseDir, safeId);
    const rel = path.relative(this.profilesBaseDir, resolved);

    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid accountId: profile path escaped browser_profiles root");
    }

    return resolved;
  }

  async launchAccountBrowser(
    accountId: string,
    _platform: SocialPlatform,
    options: LaunchAccountOptions,
  ): Promise<PersistentContextHandle> {
    const rawOpts = options as unknown as Record<string, unknown>;
    if ("proxy" in rawOpts && rawOpts["proxy"] !== undefined) {
      throw new Error(
        "PROXY_BYPASS_FORBIDDEN: proxy injection violates Master Plan browser isolation rules",
      );
    }
    if (
      ("storageState" in rawOpts && rawOpts["storageState"] !== undefined) ||
      ("cookies" in rawOpts && rawOpts["cookies"] !== undefined)
    ) {
      throw new Error(
        "SHARED_COOKIES_FORBIDDEN: shared cookies/storageState violate per-account QR login rules",
      );
    }

    const safeId = this.validateAccountId(accountId);
    if (this.activeContexts.has(safeId)) {
      throw new Error(
        `PROFILE_ALREADY_IN_USE: account ${safeId} already has an active browser context`,
      );
    }

    const profileDir = this.getProfileDir(safeId);
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

    const launcher = this.customLauncher ?? (await createDefaultPlaywrightLauncher());
    const context = await launcher.launchPersistentContext(profileDir, {
      headless: options.headless,
      acceptDownloads: false,
      viewport: options.viewport ?? { width: 1280, height: 800 },
      ...(options.channel !== undefined ? { channel: options.channel } : {}),
    });

    this.activeContexts.set(safeId, context);
    context.on("close", () => {
      this.activeContexts.delete(safeId);
    });

    return context;
  }

  isProfileActive(accountId: string): boolean {
    return this.activeContexts.has(this.validateAccountId(accountId));
  }
}

