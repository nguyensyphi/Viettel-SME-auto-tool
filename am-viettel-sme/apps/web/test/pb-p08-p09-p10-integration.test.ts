import { describe, expect, it, vi } from "vitest";
import { TelegramAlertDispatcher } from "@am-sme/telegram-bot";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";

describe("PB-P08, PB-P09 & PB-P10 End-to-End Integration Test (Full Module 02 Closure)", () => {
  it("executes end-to-end Personal Branding pipeline -> Assisted Publish -> Analytics Summary, Topics, Accounts -> Safe Telegram Notification Dispatch", async () => {
    const services = createDemoApiServices();

    // Authenticate as AM
    const authResult = await services.auth.authenticatePassword({
      workspaceId: "viettel-sme",
      email: "am@viettel.vn",
      password: "demo",
    });
    expect(authResult).not.toBeNull();
    const token = authResult!.sessionToken;

    function req(path: string, method = "GET", body?: Record<string, unknown>): Request {
      return new Request(`http://127.0.0.1:3000${path}`, {
        method,
        headers: {
          cookie: `am_sme_session=${token}`,
          origin: "http://127.0.0.1:3000",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }

    // 1. Sync Google Docs content
    const syncDocRes = await handleApiRequest(
      req("/api/v1/google/sync-documents", "POST", {
        connectionId: "conn-viettel-dian",
        documentId: "gdoc_viettel_am_posts",
      }),
      ["api", "v1", "google", "sync-documents"],
      services,
    );
    expect(syncDocRes.status).toBe(200);

    // 2. Get active Zalo account from /api/v1/accounts
    const accountsRes = await handleApiRequest(
      req("/api/v1/accounts"),
      ["api", "v1", "accounts"],
      services,
    );
    expect(accountsRes.status).toBe(200);
    const accounts = ((await accountsRes.json()) as any).items;
    const zaloAccount = accounts.find((a: any) => a.platform === "ZALO");
    expect(zaloAccount).toBeDefined();

    // 3. Get approved CHU_KY_SO post
    const contentsRes = await handleApiRequest(
      req("/api/v1/contents?topicCode=CHU_KY_SO&status=APPROVED"),
      ["api", "v1", "contents"],
      services,
    );
    const approvedPosts = ((await contentsRes.json()) as any).items;
    const cksPost = approvedPosts[0];
    expect(cksPost).toBeDefined();

    // 4. Match media & validate post
    const matchRes = await handleApiRequest(
      req(`/api/v1/contents/${cksPost.id}/match-media`, "POST"),
      ["api", "v1", "contents", cksPost.id, "match-media"],
      services,
    );
    expect(matchRes.status).toBe(200);

    const validateRes = await handleApiRequest(
      req(`/api/v1/contents/${cksPost.id}/validate`, "POST"),
      ["api", "v1", "contents", cksPost.id, "validate"],
      services,
    );
    expect(validateRes.status).toBe(200);
    expect(((await validateRes.json()) as any).valid).toBe(true);

    // 5. Schedule post in ASSISTED_PUBLISH mode
    const schedRes = await handleApiRequest(
      req("/api/v1/publishing/schedule", "POST", {
        contentId: cksPost.id,
        accountId: zaloAccount.id,
        scheduledAt: "2026-11-22T08:30:00.000Z",
        publishMode: "ASSISTED_PUBLISH",
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(schedRes.status).toBe(201);
    const { job } = (await schedRes.json()) as any;

    // 6. Prepare composer & send Telegram notification to AM
    const approveJobRes = await handleApiRequest(
      req(`/api/v1/publishing/jobs/${job.id}/approve`, "POST"),
      ["api", "v1", "publishing", "jobs", job.id, "approve"],
      services,
    );
    expect(approveJobRes.status).toBe(200);

    const sentTelegramMessages: Array<{ chatId: string; text: string }> = [];
    const dispatcher = new TelegramAlertDispatcher({
      adminChatIds: ["chat_am_viettel"],
      transport: {
        sendMessage: vi.fn(async (chatId: string, text: string) => {
          sentTelegramMessages.push({ chatId, text });
        }),
      },
    });

    await dispatcher.sendPublishingNotification({
      event: "WAITING_CONFIRMATION",
      accountCode: zaloAccount.accountCode,
      platform: "ZALO",
      postCode: cksPost.postCode,
      postTitle: cksPost.title,
      dashboardUrl: `http://127.0.0.1:3000/publishing/jobs/${job.id}`,
    });
    expect(sentTelegramMessages).toHaveLength(1);
    expect(sentTelegramMessages[0]?.text).toContain("WAITING_CONFIRMATION");

    // 7. AM confirms assisted publish
    const confirmRes = await handleApiRequest(
      req(`/api/v1/publishing/jobs/${job.id}/confirm-assisted`, "POST", {
        publishedUrl: "https://zalo.me/post/cks-viettel-01",
        screenshotPath: "storage/evidence/cks-viettel-01.png",
      }),
      ["api", "v1", "publishing", "jobs", job.id, "confirm-assisted"],
      services,
    );
    expect(confirmRes.status).toBe(200);

    // 8. Verify Analytics Summary, Topics, and Accounts endpoints
    const summaryRes = await handleApiRequest(
      req("/api/v1/analytics/publishing-summary"),
      ["api", "v1", "analytics", "publishing-summary"],
      services,
    );
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as any;
    expect(summary.posts.total).toBeGreaterThanOrEqual(4);
    expect(summary.jobs.published).toBe(1);

    const topicsRes = await handleApiRequest(
      req("/api/v1/analytics/topics"),
      ["api", "v1", "analytics", "topics"],
      services,
    );
    expect(topicsRes.status).toBe(200);
    const topicsData = (await topicsRes.json()) as any;
    const cksStats = topicsData.topics.find((t: any) => t.topicCode === "CHU_KY_SO");
    expect(cksStats).toBeDefined();
    expect(cksStats.publishedJobs).toBe(1);

    const accStatsRes = await handleApiRequest(
      req("/api/v1/analytics/accounts"),
      ["api", "v1", "analytics", "accounts"],
      services,
    );
    expect(accStatsRes.status).toBe(200);
    const accStatsData = (await accStatsRes.json()) as any;
    const zaloStats = accStatsData.accounts.find(
      (a: any) => a.accountId === zaloAccount.id,
    );
    expect(zaloStats).toBeDefined();
    expect(zaloStats.publishedCount).toBe(1);
  });
});

