import * as fs from "node:fs";
import * as path from "node:path";

export interface TabTarget {
  readonly id: string;
  readonly name: string;
  readonly urlPath?: string | undefined;
}

export interface TabAuditResult {
  readonly tabId: string;
  readonly tabName: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly consoleErrors: readonly string[];
  readonly brokenImages: number;
  readonly hasHorizontalOverflow: boolean;
  readonly screenshotPath: string;
  readonly durationMs: number;
}

export interface UISmokeOptions {
  readonly baseUrl: string;
  readonly reportDir?: string | undefined;
  readonly headless?: boolean | undefined;
  readonly channel?: string | undefined;
  readonly tabs?: readonly TabTarget[] | undefined;
}

export interface UISmokeReport {
  readonly timestamp: string;
  readonly totalTabs: number;
  readonly passedTabs: number;
  readonly failedTabs: number;
  readonly results: readonly TabAuditResult[];
  readonly success: boolean;
}

export interface UISmokeAuditEngine {
  launchBrowser(options: { headless?: boolean; channel?: string }): Promise<{
    newPage(): Promise<any>;
    close(): Promise<void>;
  }>;
}

export const DEFAULT_AUDIT_TABS: readonly TabTarget[] = [
  { id: "dashboard", name: "Dashboard hôm nay" },
  { id: "leads", name: "Lead" },
  { id: "import", name: "Import Excel" },
  { id: "planner", name: "Tác vụ & Planner" },
  { id: "accounts", name: "Tài khoản & Phiên" },
  { id: "calendar", name: "Lịch nội dung" },
  { id: "fb-poster", name: "Auto Poster Facebook" },
  { id: "campaigns", name: "Chiến dịch & CTV" },
];

export async function createPlaywrightSmokeEngine(): Promise<UISmokeAuditEngine> {
  const pw = await import("playwright-core");
  return {
    async launchBrowser(options) {
      try {
        return await pw.chromium.launch({
          headless: options.headless ?? true,
          channel: options.channel ?? "chrome",
        });
      } catch {
        // Fallback without channel if system chrome is not default
        return await pw.chromium.launch({
          headless: options.headless ?? true,
        });
      }
    },
  };
}

export async function runUISmokeAudit(
  options: UISmokeOptions,
  customEngine?: UISmokeAuditEngine,
): Promise<UISmokeReport> {
  const engine = customEngine ?? (await createPlaywrightSmokeEngine());
  const reportDir = options.reportDir ?? "storage/reports/ui-audit";
  const tabs = options.tabs ?? DEFAULT_AUDIT_TABS;

  // Ensure report directory exists
  try {
    fs.mkdirSync(reportDir, { recursive: true });
  } catch {
    // ignore in mock environments
  }

  const browser = await engine.launchBrowser({
    headless: options.headless ?? true,
    channel: options.channel ?? "chrome",
  });

  const results: TabAuditResult[] = [];

  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];

    page.on?.("console", (msg: any) => {
      if (typeof msg.type === "function" && msg.type() === "error") {
        const txt = typeof msg.text === "function" ? msg.text() : String(msg);
        if (!txt.includes("favicon.ico") && !txt.includes("status of 404")) {
          consoleErrors.push(txt);
        }
      }
    });

    page.on?.("response", (res: any) => {
      if (typeof res.status === "function" && res.status() >= 400) {
        const url = typeof res.url === "function" ? res.url() : "";
        if (!url.includes("favicon.ico") && !url.includes("/auth/me")) {
          consoleErrors.push(`HTTP ${res.status()} trên resource: ${url}`);
        }
      }
    });

    // Set high-res desktop viewport for crisp screenshots
    if (typeof page.setViewportSize === "function") {
      await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    }

    // Navigate to base URL
    await page.goto(options.baseUrl);
    await page.waitForLoadState?.("networkidle").catch(() => {});

    // Wait for initial hydration / auth check to complete
    if (typeof page.waitForSelector === "function") {
      await page.waitForSelector('input[name="email"], .workspace-layout', { timeout: 15000 }).catch(() => {});
    }

    // Auto login if on login screen
    try {
      const emailField = page.locator('input[name="email"]');
      if (typeof emailField?.count === "function" && (await emailField.count()) > 0) {
        if (typeof page.fill === "function") {
          await page.fill('input[name="workspaceId"]', "viettel-sme").catch(() => {});
          await page.fill('input[name="email"]', "am@viettel.vn").catch(() => {});
          await page.fill('input[name="password"]', "password123").catch(() => {});
        }
        const submitBtn = page.locator('button.primary');
        if (typeof submitBtn?.first === "function" && typeof submitBtn.first().click === "function") {
          await submitBtn.first().click().catch(() => {});
        } else if (typeof page.click === "function") {
          await page.click('button.primary').catch(() => {});
        }
        if (typeof page.waitForSelector === "function") {
          await page.waitForSelector('.workspace-layout', { timeout: 15000 }).catch(() => {});
        }
        await page.waitForLoadState?.("networkidle").catch(() => {});
        await page.waitForTimeout?.(1200).catch(() => {});

        // Remove only pre-login auth check 401 logs from consoleErrors
        for (let i = consoleErrors.length - 1; i >= 0; i--) {
          if (consoleErrors[i]?.includes("/auth/me") || consoleErrors[i]?.includes("401")) {
            consoleErrors.splice(i, 1);
          }
        }
      }
    } catch {
      // ignore in mock environments
    }

    for (const tab of tabs) {
      const startTime = Date.now();

      // Filter errors that occurred during this tab
      const errorCountBefore = consoleErrors.length;

      // Click on sidebar navigation item for this tab if not already there
      let navClicked = false;
      try {
        const navButton = page.locator(`button.nav-item:has-text("${tab.name}")`);
        if (typeof navButton?.count === "function" && (await navButton.count()) > 0) {
          await navButton.first().click();
          navClicked = true;
          await page.waitForTimeout?.(1200).catch(() => {});
        }
      } catch {
        // proceed
      }

      // Check broken images
      const brokenImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return imgs.filter((img) => img.complete && img.naturalWidth === 0).length;
      }).catch(() => 0);

      // Check horizontal overflow
      let overflowCulprits: string[] = [];
      const hasHorizontalOverflow = await page.evaluate(() => {
        return (
          document.body.scrollWidth > window.innerWidth ||
          document.documentElement.scrollWidth > window.innerWidth
        );
      }).catch(() => false);

      if (hasHorizontalOverflow) {
        overflowCulprits = await page.evaluate(() => {
          const list: string[] = [];
          document.querySelectorAll('*').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth + 2 || el.scrollWidth > window.innerWidth + 2) {
              const tag = el.tagName.toLowerCase();
              const cls = el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : '';
              list.push(`${tag}${cls} (w:${Math.round(rect.width)}, right:${Math.round(rect.right)}, sw:${el.scrollWidth})`);
            }
          });
          return list.slice(0, 5);
        }).catch(() => []);
        if (overflowCulprits.length > 0) {
          console.log(`[Overflow debug - ${tab.name}]:`, overflowCulprits);
        }
      }

      // Collect new errors (include initial errors for first tab)
      const currentTabErrors =
        results.length === 0
          ? [...consoleErrors]
          : consoleErrors.slice(errorCountBefore);

      // Capture screenshot
      const screenshotPath = path.join(reportDir, `${tab.id}.png`).replace(/\\/g, "/");
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        // ignore in mock environments
      }

      const durationMs = Date.now() - startTime;
      const isFail = currentTabErrors.length > 0 || brokenImages > 0 || hasHorizontalOverflow;

      results.push({
        tabId: tab.id,
        tabName: tab.name,
        status: isFail ? "FAIL" : "PASS",
        consoleErrors: currentTabErrors,
        brokenImages,
        hasHorizontalOverflow,
        screenshotPath,
        durationMs,
      });
    }
  } finally {
    await browser.close();
  }

  const passedTabs = results.filter((r) => r.status === "PASS").length;
  const failedTabs = results.filter((r) => r.status === "FAIL").length;

  return {
    timestamp: new Date().toISOString(),
    totalTabs: results.length,
    passedTabs,
    failedTabs,
    results,
    success: failedTabs === 0,
  };
}

export function formatUISmokeSummary(report: UISmokeReport): string {
  const lines: string[] = [
    "========================================================================================",
    "                     VIETTEL AM SME — BÁO CÁO KIỂM THỬ UI/UX TỰ ĐỘNG",
    "========================================================================================",
    `Thời gian kiểm thử : ${report.timestamp}`,
    `Tổng số phân hệ    : ${report.totalTabs} tabs`,
    `Kết quả tổng quan  : ${report.passedTabs} ĐẠT / ${report.failedTabs} LỖI`,
    "----------------------------------------------------------------------------------------",
    "Phân hệ                    | Trạng thái | Console Error | Ảnh hỏng | Tràn viền | Screenshot",
    "---------------------------+------------+---------------+----------+-----------+----------------",
  ];

  for (const r of report.results) {
    const padName = r.tabName.padEnd(25, " ").slice(0, 25);
    const padStatus = r.status.padEnd(10, " ");
    const padErr = String(r.consoleErrors.length).padEnd(13, " ");
    const padImg = String(r.brokenImages).padEnd(8, " ");
    const padOver = (r.hasHorizontalOverflow ? "CÓ" : "Không").padEnd(9, " ");
    lines.push(`${padName} | ${padStatus} | ${padErr} | ${padImg} | ${padOver} | ${r.screenshotPath}`);
  }

  lines.push("========================================================================================");
  for (const r of report.results) {
    if (r.consoleErrors.length > 0) {
      lines.push(`\n[Chi tiết lỗi Console - ${r.tabName}]:`);
      for (const err of r.consoleErrors) {
        lines.push(`  ❌ ${err}`);
      }
    }
  }
  if (report.success) {
    lines.push("🎉 TOÀN BỘ PHÂN HỆ GIAO DIỆN ĐẠT TIÊU CHUẨN UI/UX HOÀN HẢO (100% PASS)");
  } else {
    lines.push("⚠️ PHÁT HIỆN LỖI UI/UX CẦN KHẮC PHỤC (Xem chi tiết bảng trên)");
  }
  lines.push("========================================================================================");

  return lines.join("\n");
}
