import { describe, expect, it } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";

describe("PB-P06 & PB-P07 End-to-End Integration Test", () => {
  it("executes full workflow: Register Account -> Verify Session -> Create Campaign -> Schedule Post -> Enforce Duplicate & Interval Policy -> Assisted Publish Confirmation -> Result Tracking", async () => {
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

    // 1. Register a dedicated Zalo Personal Account for AM
    const createAccRes = await handleApiRequest(
      req("/api/v1/accounts", "POST", {
        accountCode: "zalo-am-binhduong-01",
        platform: "ZALO",
        displayName: "Zalo Lê Văn AM - Chi nhánh Bình Dương",
        assignedTopics: ["CHU_KY_SO", "HOA_DON_DIEN_TU"],
        maxPostsPerDay: 2,
        minIntervalMinutes: 180,
        preferredWindows: ["08:00-10:00", "14:00-16:00"],
        status: "ACTIVE",
      }),
      ["api", "v1", "accounts"],
      services,
    );
    expect(createAccRes.status).toBe(201);
    const zaloAccount = ((await createAccRes.json()) as any).account;
    expect(zaloAccount.profileDir).toBe("storage/browser_profiles/zalo-am-binhduong-01");

    // 2. Check session health of the account
    const checkSessionRes = await handleApiRequest(
      req(`/api/v1/accounts/${zaloAccount.id}/check-session`, "POST", {
        status: "ACTIVE",
      }),
      ["api", "v1", "accounts", zaloAccount.id, "check-session"],
      services,
    );
    expect(checkSessionRes.status).toBe(200);
    const checkedAccount = ((await checkSessionRes.json()) as any).account;
    expect(checkedAccount.lastSessionCheckAt).toBeDefined();

    // 3. Create a Publishing Campaign
    const createCampRes = await handleApiRequest(
      req("/api/v1/publishing/campaigns", "POST", {
        name: "Chiến dịch Xây dựng Thương hiệu AM T11/2026",
        topicCodes: ["CHU_KY_SO", "HOA_DON_DIEN_TU"],
        accountIds: [zaloAccount.id],
        startDate: "2026-11-01T00:00:00.000Z",
        endDate: "2026-11-30T23:59:59.000Z",
      }),
      ["api", "v1", "publishing", "campaigns"],
      services,
    );
    expect(createCampRes.status).toBe(201);
    const campaign = ((await createCampRes.json()) as any).campaign;
    expect(campaign.id).toBeDefined();

    // 4. Fetch seeded posts (post-demo-01: APPROVED CHU_KY_SO, post-demo-02: APPROVED HOA_DON_DIEN_TU, post-demo-03: DRAFT VCONTRACT)
    const contentsRes = await handleApiRequest(
      req("/api/v1/contents"),
      ["api", "v1", "contents"],
      services,
    );
    const contents = ((await contentsRes.json()) as any).items;
    const post1 = contents.find((p: any) => p.postCode === "PB001");
    const post2 = contents.find((p: any) => p.postCode === "PB002");
    const draftPost = contents.find((p: any) => p.postCode === "PB003");
    expect(post1).toBeDefined();
    expect(post2).toBeDefined();
    expect(draftPost).toBeDefined();

    // 5. Attempt to schedule DRAFT post -> blocked (PB-SC-003)
    const draftSchedRes = await handleApiRequest(
      req("/api/v1/publishing/schedule", "POST", {
        campaignId: campaign.id,
        contentId: draftPost.id,
        accountId: zaloAccount.id,
        scheduledAt: "2026-11-20T08:30:00.000Z",
        publishMode: "ASSISTED_PUBLISH",
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(draftSchedRes.status).toBe(400);
    expect(((await draftSchedRes.json()) as any).error).toBe("POST_NOT_APPROVED");

    // 6. Schedule APPROVED post1 at 08:30 -> succeeds
    const sched1Res = await handleApiRequest(
      req("/api/v1/publishing/schedule", "POST", {
        campaignId: campaign.id,
        contentId: post1.id,
        accountId: zaloAccount.id,
        scheduledAt: "2026-11-20T08:30:00.000Z",
        publishMode: "ASSISTED_PUBLISH",
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(sched1Res.status).toBe(201);
    const sched1Data = (await sched1Res.json()) as any;
    expect(sched1Data.job.status).toBe("QUEUED");
    expect(sched1Data.preparedContent.platform).toBe("ZALO");
    expect(sched1Data.preparedContent.hashtags.length).toBeLessThanOrEqual(3);

    // 7. Attempt to schedule post1 again on same account 5 days later -> blocked by 30-day reuse rule (PB-SC-001)
    const dupSchedRes = await handleApiRequest(
      req("/api/v1/publishing/schedule", "POST", {
        campaignId: campaign.id,
        contentId: post1.id,
        accountId: zaloAccount.id,
        scheduledAt: "2026-11-25T08:30:00.000Z",
        publishMode: "ASSISTED_PUBLISH",
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(dupSchedRes.status).toBe(409);
    expect(((await dupSchedRes.json()) as any).error).toBe("DUPLICATE_CONTENT_ON_ACCOUNT");

    // 8. Attempt to schedule post2 at 09:30 on same day (only 60 mins after 08:30, < 180 mins required) -> blocked (PB-SC-005)
    const tooCloseRes = await handleApiRequest(
      req("/api/v1/publishing/schedule", "POST", {
        campaignId: campaign.id,
        contentId: post2.id,
        accountId: zaloAccount.id,
        scheduledAt: "2026-11-20T09:30:00.000Z",
        publishMode: "ASSISTED_PUBLISH",
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(tooCloseRes.status).toBe(400);
    expect(((await tooCloseRes.json()) as any).error).toBe("MIN_INTERVAL_VIOLATION");

    // 9. Schedule post2 at 14:30 on same day (360 mins after 08:30, >= 180 mins) -> succeeds
    const sched2Res = await handleApiRequest(
      req("/api/v1/publishing/schedule", "POST", {
        campaignId: campaign.id,
        contentId: post2.id,
        accountId: zaloAccount.id,
        scheduledAt: "2026-11-20T14:30:00.000Z",
        publishMode: "ASSISTED_PUBLISH",
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(sched2Res.status).toBe(201);

    // 10. Approve job1 (prepares composer) and then confirm assisted publish
    const job1Id = sched1Data.job.id;
    const approveJobRes = await handleApiRequest(
      req(`/api/v1/publishing/jobs/${job1Id}/approve`, "POST"),
      ["api", "v1", "publishing", "jobs", job1Id, "approve"],
      services,
    );
    expect(approveJobRes.status).toBe(200);
    expect(((await approveJobRes.json()) as any).job.status).toBe("WAITING_CONFIRMATION");

    const confirmRes = await handleApiRequest(
      req(`/api/v1/publishing/jobs/${job1Id}/confirm-assisted`, "POST", {
        publishedUrl: "https://zalo.me/post/viettel-ca-001",
        screenshotPath: "storage/evidence/viettel-ca-001.png",
      }),
      ["api", "v1", "publishing", "jobs", job1Id, "confirm-assisted"],
      services,
    );
    expect(confirmRes.status).toBe(200);
    const confirmData = (await confirmRes.json()) as any;
    expect(confirmData.job.status).toBe("PUBLISHED");
    expect(confirmData.result.publishedUrl).toBe("https://zalo.me/post/viettel-ca-001");

    // 11. Verify calendar and job step history
    const calRes = await handleApiRequest(
      req(`/api/v1/publishing/calendar?accountId=${zaloAccount.id}`),
      ["api", "v1", "publishing", "calendar"],
      services,
    );
    expect(calRes.status).toBe(200);
    const calData = (await calRes.json()) as any;
    expect(calData.schedules).toHaveLength(2);
    expect(calData.campaigns.length).toBeGreaterThanOrEqual(1);

    const jobDetailRes = await handleApiRequest(
      req(`/api/v1/publishing/jobs/${job1Id}`),
      ["api", "v1", "publishing", "jobs", job1Id],
      services,
    );
    expect(jobDetailRes.status).toBe(200);
    const jobDetail = (await jobDetailRes.json()) as any;
    expect(jobDetail.steps.map((s: any) => s.stepName)).toEqual([
      "VALIDATE_CONTENT",
      "PREPARE_COMPOSER",
      "SUBMIT_POST",
    ]);
    expect(jobDetail.result.status).toBe("PUBLISHED");
  });
});

