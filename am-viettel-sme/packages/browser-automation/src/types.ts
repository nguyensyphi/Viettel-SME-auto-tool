export type SocialPlatform = "ZALO" | "FACEBOOK";

export type AccountSessionStatus = "CONNECTED" | "NEEDS_LOGIN" | "SUSPENDED";

export interface BrowserPageHandle {
  url(): string;
  goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" | undefined; timeout?: number | undefined },
  ): Promise<unknown>;
  locator(selector: string): {
    count(): Promise<number>;
    first(): {
      click(options?: { timeout?: number | undefined }): Promise<void>;
      fill(value: string): Promise<void>;
      pressSequentially(text: string, options?: { delay?: number | undefined }): Promise<void>;
      setInputFiles(files: string | readonly string[]): Promise<void>;
      isVisible(): Promise<boolean>;
    };
  };
  screenshot(options?: { path?: string | undefined; fullPage?: boolean | undefined }): Promise<Uint8Array>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

export interface PersistentContextHandle {
  pages(): BrowserPageHandle[];
  newPage(): Promise<BrowserPageHandle>;
  close(): Promise<void>;
  on(event: "close", listener: () => void): void;
}

export interface PersistentLaunchOptions {
  headless: boolean;
  acceptDownloads: false;
  viewport?: { width: number; height: number } | undefined;
  channel?: "chrome" | "msedge" | undefined;
}

export interface PersistentContextLauncher {
  launchPersistentContext(
    userDataDir: string,
    options: PersistentLaunchOptions,
  ): Promise<PersistentContextHandle>;
}

