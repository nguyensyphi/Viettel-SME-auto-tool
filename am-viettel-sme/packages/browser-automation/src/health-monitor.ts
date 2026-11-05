import {
  isPageAuthenticated,
  PLATFORM_ENTRY_URL,
  type AccountSessionStore,
} from "./login-flow.js";
import type { BrowserProfileManager } from "./profile-manager.js";
import type { SocialPlatform } from "./types.js";

export interface SessionExpiredAlert {
  accountId: string;
  platform: SocialPlatform;
  reason: string;
  detectedAt: string;
}

export interface SessionHealthMonitorOptions {
  onSessionExpired?: ((alert: SessionExpiredAlert) => Promise<void>) | undefined;
}

export class SessionHealthMonitor {
  private readonly onSessionExpired?:
    | ((alert: SessionExpiredAlert) => Promise<void>)
    | undefined;

  constructor(
    private readonly profileManager: BrowserProfileManager,
    private readonly sessionStore: AccountSessionStore,
    options?: SessionHealthMonitorOptions,
  ) {
    this.onSessionExpired = options?.onSessionExpired;
  }

  async checkSessionHealth(
    accountId: string,
    platform: SocialPlatform,
  ): Promise<boolean> {
    const context = await this.profileManager.launchAccountBrowser(
      accountId,
      platform,
      { headless: true },
    );

    try {
      const existingPages = context.pages();
      const page = existingPages[0] ?? (await context.newPage());
      await page.goto(PLATFORM_ENTRY_URL[platform], {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const check = await isPageAuthenticated(page, platform);
      if (check.authenticated) {
        await this.sessionStore.setStatus(accountId, platform, "CONNECTED");
        return true;
      }

      const reason = check.reason ?? "SESSION_EXPIRED";
      await this.sessionStore.setStatus(accountId, platform, "NEEDS_LOGIN", reason);

      if (this.onSessionExpired) {
        await this.onSessionExpired({
          accountId,
          platform,
          reason,
          detectedAt: new Date().toISOString(),
        });
      }

      return false;
    } finally {
      await context.close();
    }
  }
}

