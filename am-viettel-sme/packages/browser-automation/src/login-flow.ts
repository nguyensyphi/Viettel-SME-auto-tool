import type { BrowserProfileManager } from "./profile-manager.js";
import type {
  AccountSessionStatus,
  BrowserPageHandle,
  SocialPlatform,
} from "./types.js";

export interface AccountSessionRecord {
  accountId: string;
  platform: SocialPlatform;
  status: AccountSessionStatus;
  updatedAt: string;
  reason?: string | undefined;
}

export interface AccountSessionStore {
  getStatus(
    accountId: string,
    platform: SocialPlatform,
  ): Promise<AccountSessionRecord | null>;
  setStatus(
    accountId: string,
    platform: SocialPlatform,
    status: AccountSessionStatus,
    reason?: string,
  ): Promise<AccountSessionRecord>;
}

export class InMemoryAccountSessionStore implements AccountSessionStore {
  private readonly records = new Map<string, AccountSessionRecord>();

  private key(accountId: string, platform: SocialPlatform): string {
    return `${platform}:${accountId}`;
  }

  async getStatus(
    accountId: string,
    platform: SocialPlatform,
  ): Promise<AccountSessionRecord | null> {
    return this.records.get(this.key(accountId, platform)) ?? null;
  }

  async setStatus(
    accountId: string,
    platform: SocialPlatform,
    status: AccountSessionStatus,
    reason?: string,
  ): Promise<AccountSessionRecord> {
    const record: AccountSessionRecord = {
      accountId,
      platform,
      status,
      updatedAt: new Date().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    };
    this.records.set(this.key(accountId, platform), record);
    return record;
  }
}

export const PLATFORM_ENTRY_URL: Record<SocialPlatform, string> = {
  ZALO: "https://chat.zalo.me/",
  FACEBOOK: "https://www.facebook.com/",
};

const AUTHENTICATED_SELECTORS: Record<SocialPlatform, readonly string[]> = {
  ZALO: ["#main-tab", "[data-id='div_Main_TabMsg']", "#contact-search-input"],
  FACEBOOK: ["[role='navigation']", "[aria-label='Facebook']", "[data-pagelet='LeftRail']"],
};

const LOGIN_SCREEN_SELECTORS: Record<SocialPlatform, readonly string[]> = {
  ZALO: ["[data-testid='qr-code']", ".qrcode", "input[type='password']"],
  FACEBOOK: ["input[name='email']", "input[name='pass']", "form[action*='login']"],
};

export async function isPageAuthenticated(
  page: BrowserPageHandle,
  platform: SocialPlatform,
): Promise<{ authenticated: boolean; reason?: string | undefined }> {
  const currentUrl = page.url().toLowerCase();

  if (platform === "ZALO") {
    if (currentUrl.includes("id.zalo.me") || currentUrl.includes("/login")) {
      return { authenticated: false, reason: "REDIRECTED_TO_ZALO_LOGIN" };
    }
  } else {
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/checkpoint") ||
      currentUrl.includes("/recover")
    ) {
      return { authenticated: false, reason: "REDIRECTED_TO_FACEBOOK_LOGIN_OR_CHECKPOINT" };
    }
  }

  for (const loginSel of LOGIN_SCREEN_SELECTORS[platform]) {
    if ((await page.locator(loginSel).count()) > 0) {
      return { authenticated: false, reason: `LOGIN_PROMPT_VISIBLE:${loginSel}` };
    }
  }

  for (const authSel of AUTHENTICATED_SELECTORS[platform]) {
    if ((await page.locator(authSel).count()) > 0) {
      return { authenticated: true };
    }
  }

  return { authenticated: false, reason: "AUTHENTICATED_WORKSPACE_NOT_FOUND" };
}

export interface InteractiveLoginOptions {
  loginTimeoutMs?: number | undefined;
  pollIntervalMs?: number | undefined;
  nowFn?: (() => number) | undefined;
}

export interface LoginSessionResult {
  status: "CONNECTED" | "TIMEOUT" | "FAILED";
  reason?: string | undefined;
}

export class InteractiveLoginController {
  private readonly loginTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly nowFn: () => number;

  constructor(
    private readonly profileManager: BrowserProfileManager,
    private readonly sessionStore: AccountSessionStore,
    options?: InteractiveLoginOptions,
  ) {
    this.loginTimeoutMs = options?.loginTimeoutMs ?? 180_000;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1_500;
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /**
   * Opens a visible browser window (headless: false) using the account's isolated
   * persistent profile so the AM scans the real QR code / completes login directly.
   */
  async startLoginSession(
    accountId: string,
    platform: SocialPlatform,
  ): Promise<LoginSessionResult> {
    const context = await this.profileManager.launchAccountBrowser(
      accountId,
      platform,
      { headless: false },
    );

    try {
      const existingPages = context.pages();
      const page = existingPages[0] ?? (await context.newPage());
      await page.goto(PLATFORM_ENTRY_URL[platform], {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const deadline = this.nowFn() + this.loginTimeoutMs;
      while (this.nowFn() < deadline) {
        const check = await isPageAuthenticated(page, platform);
        if (check.authenticated) {
          await this.sessionStore.setStatus(accountId, platform, "CONNECTED");
          return { status: "CONNECTED" };
        }
        await page.waitForTimeout(this.pollIntervalMs);
      }

      await this.sessionStore.setStatus(
        accountId,
        platform,
        "NEEDS_LOGIN",
        "QR_LOGIN_TIMEOUT",
      );
      return { status: "TIMEOUT", reason: "QR_LOGIN_TIMEOUT" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.sessionStore.setStatus(accountId, platform, "NEEDS_LOGIN", msg);
      return { status: "FAILED", reason: msg };
    } finally {
      await context.close();
    }
  }
}
