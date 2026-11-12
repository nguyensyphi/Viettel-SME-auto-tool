import { describe, expect, it, vi } from "vitest";
import { runUISmokeAudit, type UISmokeAuditEngine } from "../src/ui-smoke-runner.js";

describe("runUISmokeAudit (Automated UI/UX Visual & Smoke Verification Engine)", () => {
  it("audits tabs, records console errors, broken images, overflow, and captures screenshots", async () => {
    const mockScreenshots: string[] = [];
    const mockEvaluates: Array<() => any> = [];

    const mockPage = {
      goto: vi.fn(async () => {}),
      waitForLoadState: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      evaluate: vi.fn(async (fn: any) => {
        mockEvaluates.push(fn);
        // By default return 0 broken images, false overflow
        return 0;
      }),
      screenshot: vi.fn(async ({ path }: { path: string }) => {
        mockScreenshots.push(path);
      }),
      on: vi.fn((event: string, handler: any) => {
        // can simulate events if needed
      }),
      click: vi.fn(async () => {}),
      locator: vi.fn((selector: string) => ({
        click: vi.fn(async () => {}),
        count: vi.fn(async () => 1),
        first: vi.fn(() => ({ click: vi.fn(async () => {}) })),
      })),
    };

    const mockBrowser = {
      newPage: vi.fn(async () => mockPage),
      close: vi.fn(async () => {}),
    };

    const mockEngine: UISmokeAuditEngine = {
      launchBrowser: vi.fn(async () => mockBrowser as any),
    };

    const report = await runUISmokeAudit(
      {
        baseUrl: "http://127.0.0.1:3000",
        reportDir: "storage/test_reports/ui-audit",
        tabs: [
          { id: "dashboard", name: "Dashboard hôm nay" },
          { id: "leads", name: "Lead" },
          { id: "fb-poster", name: "Auto Poster Facebook" },
        ],
      },
      mockEngine,
    );

    expect(report.totalTabs).toBe(3);
    expect(report.passedTabs).toBe(3);
    expect(report.failedTabs).toBe(0);
    expect(report.success).toBe(true);
    expect(mockScreenshots.length).toBe(3);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("fails tab when broken images or console errors are encountered", async () => {
    const errorLogs: Array<{ text: () => string; type: () => string }> = [];

    const mockPage = {
      goto: vi.fn(async () => {}),
      waitForLoadState: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      evaluate: vi.fn(async (fnOrCode: any) => {
        const str = fnOrCode.toString();
        if (str.includes("naturalWidth")) return 2; // 2 broken images
        if (str.includes("scrollWidth")) return true; // overflow
        return 0;
      }),
      screenshot: vi.fn(async () => {}),
      on: vi.fn((event: string, handler: any) => {
        if (event === "console") {
          handler({
            type: () => "error",
            text: () => "Uncaught TypeError: Cannot read properties of undefined",
          });
        }
      }),
      locator: vi.fn(() => ({
        click: vi.fn(async () => {}),
        count: vi.fn(async () => 1),
        first: vi.fn(() => ({ click: vi.fn(async () => {}) })),
      })),
    };

    const mockBrowser = {
      newPage: vi.fn(async () => mockPage),
      close: vi.fn(async () => {}),
    };

    const mockEngine: UISmokeAuditEngine = {
      launchBrowser: vi.fn(async () => mockBrowser as any),
    };

    const report = await runUISmokeAudit(
      {
        baseUrl: "http://127.0.0.1:3000",
        tabs: [{ id: "fb-poster", name: "Auto Poster Facebook" }],
      },
      mockEngine,
    );

    expect(report.totalTabs).toBe(1);
    expect(report.passedTabs).toBe(0);
    expect(report.failedTabs).toBe(1);
    expect(report.success).toBe(false);
    expect(report.results[0]?.status).toBe("FAIL");
    expect(report.results[0]?.brokenImages).toBe(2);
    expect(report.results[0]?.hasHorizontalOverflow).toBe(true);
    expect(report.results[0]?.consoleErrors.length).toBe(1);
  });
});

