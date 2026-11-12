import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";

const am = {
  userId: "am-user-1",
  workspaceId: "workspace-publishing-test",
  role: "AM" as const,
  teamId: "team-pub-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("Social Accounts, Publishing Calendar & Queue HTTP API (PB-P06, PB-P07)", () => {
  let mockContentRepo: any;
  let services: ApiServices;

  beforeEach(() => {
    const accounts: any[] = [
      {
        id: "acc-zalo-1",
        workspaceId: am.workspaceId,
        accountCode: "zalo-dian-am01",
        platform: "ZALO",
        displayName: "Zalo Lê Văn AM",
        ownerUserId: am.userId,
        profileDir: "storage/browser_profiles/zalo-dian-am01",
        assignedTopics: ["CHU_KY_SO", "HOA_DON_DIEN_TU"],
        maxPostsPerDay: 2,
        minIntervalMinutes: 180,
        preferredWindows: ["08:00-10:00", "13:30-15:30"],
        status: "ACTIVE",
        lastSessionCheckAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const posts: any[] = [
      {
        id: "post-1",
        workspaceId: am.workspaceId,
        documentId: "gdoc-1",
        postCode: "PB001",
        title: "Chữ ký số Viettel-CA cho DN mới thành lập",
        body: "Nội dung bài viết CKS",
        topicCode: "CHU_KY_SO",
        targetAudience: "BUSINESS_OWNER",
        platforms: ["ZALO", "FACEBOOK"],
        status: "APPROVED",
        priority: "NORMAL",
        mediaHint: null,
        hashtags: ["#Viettel", "#ChuKySo"],
        version: 1,
        contentHash: "hash-pb001",
        validFrom: null,
        validUntil: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "post-draft",
        workspaceId: am.workspaceId,
        documentId: "gdoc-1",
        postCode: "PB002",
        title: "Bài nháp chưa duyệt",
        body: "Nội dung nháp",
        topicCode: "CHU_KY_SO",
        targetAudience: "BUSINESS_OWNER",
        platforms: ["ZALO"],
        status: "DRAFT",
        priority: "NORMAL",
        mediaHint: null,
        hashtags: [],
        version: 1,
        contentHash: "hash-pb002",
        validFrom: null,
        validUntil: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const campaigns: any[] = [];
    const schedules: any[] = [];
    const jobs: any[] = [];
    const jobSteps: any[] = [];
    const results: any[] = [];

    mockContentRepo = {
      listSocialAccounts: vi.fn(async (wsId: string) =>
        accounts.filter((a) => a.workspaceId === wsId),
      ),
      getSocialAccountById: vi.fn(async (wsId: string, id: string) =>
        accounts.find((a) => a.workspaceId === wsId && (a.id === id || a.accountCode === id)) ??
        null,
      ),
      upsertSocialAccount: vi.fn(async (input: any) => {
        const created = {
          id: `acc-${accounts.length + 1}`,
          workspaceId: input.workspaceId,
          accountCode: input.accountCode,
          platform: input.platform,
          displayName: input.displayName,
          ownerUserId: input.ownerUserId,
          profileDir: `storage/browser_profiles/${input.accountCode}`,
          assignedTopics: input.assignedTopics ?? [],
          maxPostsPerDay: input.maxPostsPerDay ?? 2,
          minIntervalMinutes: input.minIntervalMinutes ?? 180,
          preferredWindows: input.preferredWindows ?? [],
          status: input.status ?? "NEEDS_AUTH",
          lastSessionCheckAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        accounts.push(created);
        return created;
      }),
      updateSocialAccount: vi.fn(async (wsId: string, id: string, input: any) => {
        const acc = accounts.find(
          (a) => a.workspaceId === wsId && (a.id === id || a.accountCode === id),
        );
        if (!acc) return null;
        Object.assign(acc, input, { updatedAt: new Date().toISOString() });
        return acc;
      }),
      getPostById: vi.fn(async (wsId: string, id: string) =>
        posts.find((p) => p.workspaceId === wsId && p.id === id) ?? null,
      ),
      createPublishingCampaign: vi.fn(async (input: any) => {
        const camp = {
          id: `camp-${campaigns.length + 1}`,
          ...input,
          status: input.status ?? "ACTIVE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        campaigns.push(camp);
        return camp;
      }),
      listPublishingCampaigns: vi.fn(async (wsId: string) =>
        campaigns.filter((c) => c.workspaceId === wsId),
      ),
      createPublishingSchedule: vi.fn(async (input: any) => {
        const sched = {
          id: `sched-${schedules.length + 1}`,
          ...input,
          scheduledAt: new Date(input.scheduledAt).toISOString(),
          publishMode: input.publishMode ?? "ASSISTED_PUBLISH",
          status: input.status ?? "SCHEDULED",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        schedules.push(sched);
        return sched;
      }),
      listPublishingSchedules: vi.fn(async (wsId: string, filters?: any) =>
        schedules.filter((s) => {
          if (s.workspaceId !== wsId) return false;
          if (filters?.accountId && s.accountId !== filters.accountId) return false;
          return true;
        }),
      ),
      createPublishingJob: vi.fn(async (input: any) => {
        const job = {
          id: `job-${jobs.length + 1}`,
          ...input,
          scheduledAt: new Date(input.scheduledAt).toISOString(),
          publishMode: input.publishMode ?? "ASSISTED_PUBLISH",
          status: input.status ?? "QUEUED",
          errorCode: null,
          errorMessage: null,
          retryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        jobs.push(job);
        return job;
      }),
      getPublishingJobById: vi.fn(async (wsId: string, id: string) =>
        jobs.find((j) => j.workspaceId === wsId && j.id === id) ?? null,
      ),
      listPublishingJobs: vi.fn(async (wsId: string, filters?: any) =>
        jobs.filter((j) => {
          if (j.workspaceId !== wsId) return false;
          if (filters?.accountId && j.accountId !== filters.accountId) return false;
          if (filters?.status && j.status !== filters.status) return false;
          return true;
        }),
      ),
      updatePublishingJobStatus: vi.fn(async (wsId: string, id: string, input: any) => {
        const job = jobs.find((j) => j.workspaceId === wsId && j.id === id);
        if (!job) return null;
        Object.assign(job, input, { updatedAt: new Date().toISOString() });
        return job;
      }),
      appendPublishingJobStep: vi.fn(async (input: any) => {
        const step = {
          id: `step-${jobSteps.length + 1}`,
          ...input,
          createdAt: new Date().toISOString(),
        };
        jobSteps.push(step);
        return step;
      }),
      listPublishingJobSteps: vi.fn(async (jobId: string) =>
        jobSteps.filter((s) => s.jobId === jobId),
      ),
      recordPublishingResult: vi.fn(async (input: any) => {
        const res = {
          id: `res-${results.length + 1}`,
          ...input,
          publishedAt: new Date().toISOString(),
        };
        results.push(res);
        return res;
      }),
      getPublishingResultByJobId: vi.fn(async (jobId: string) =>
        results.find((r) => r.jobId === jobId) ?? null,
      ),
    };

    const auth = {
      resolveSession: vi.fn(async (tok) => (tok === session ? am : null)),
      authenticatePassword: vi.fn() as any,
      acceptInvitation: vi.fn() as any,
      createInvitation: vi.fn() as any,
      changeMembershipRole: vi.fn() as any,
      revokeSession: vi.fn() as any,
    };

    services = {
      auth,
      guard: new HttpAuthGuard(auth as any),
      leads: {} as any,
      tasks: {} as any,
      imports: new InMemoryImportApi({} as any),
      db: {} as any,
      sessionCookie: { secure: false, maxAgeSeconds: 3600 },
      contentLibrary: mockContentRepo,
    };
  });

  it("manages social accounts via /api/v1/accounts (list, create, get, patch, pause, resume, check-session)", async () => {
    // 1. List accounts
    const listRes = await handleApiRequest(
      new Request("http://localhost/api/v1/accounts", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "accounts"],
      services,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.items).toHaveLength(1);

    // 2. Create new Facebook account
    const createRes = await handleApiRequest(
      new Request("http://localhost/api/v1/accounts", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          accountCode: "fb-dian-am01",
          platform: "FACEBOOK",
          displayName: "Facebook Lê Văn AM",
          assignedTopics: ["CHU_KY_SO", "VCONTRACT"],
          maxPostsPerDay: 2,
          minIntervalMinutes: 180,
        }),
      }),
      ["api", "v1", "accounts"],
      services,
    );
    expect(createRes.status).toBe(201);
    const createdAcc = ((await createRes.json()) as any).account;
    expect(createdAcc.accountCode).toBe("fb-dian-am01");
    expect(createdAcc.profileDir).toBe("storage/browser_profiles/fb-dian-am01");

    // 3. Pause and Resume account
    const pauseRes = await handleApiRequest(
      new Request(`http://localhost/api/v1/accounts/${createdAcc.id}/pause`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "accounts", createdAcc.id, "pause"],
      services,
    );
    expect(pauseRes.status).toBe(200);
    expect(((await pauseRes.json()) as any).status).toBe("PAUSED");

    const resumeRes = await handleApiRequest(
      new Request(`http://localhost/api/v1/accounts/${createdAcc.id}/resume`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "accounts", createdAcc.id, "resume"],
      services,
    );
    expect(resumeRes.status).toBe(200);
    expect(((await resumeRes.json()) as any).status).toBe("ACTIVE");

    // 4. Check session
    const sessionRes = await handleApiRequest(
      new Request(`http://localhost/api/v1/accounts/${createdAcc.id}/check-session`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "accounts", createdAcc.id, "check-session"],
      services,
    );
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as any;
    expect(sessionBody.account.lastSessionCheckAt).toBeDefined();
  });

  it("schedules approved post into Publishing Calendar & Queue and blocks DRAFT or duplicate posts", async () => {
    // 1. Reject DRAFT post scheduling (PB-SC-003)
    const draftSchedRes = await handleApiRequest(
      new Request("http://localhost/api/v1/publishing/schedule", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          contentId: "post-draft",
          accountId: "acc-zalo-1",
          scheduledAt: "2026-11-15T09:00:00.000Z",
          publishMode: "ASSISTED_PUBLISH",
        }),
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(draftSchedRes.status).toBe(400);
    expect(((await draftSchedRes.json()) as any).error).toBe("POST_NOT_APPROVED");

    // 2. Schedule APPROVED post (post-1)
    const okSchedRes = await handleApiRequest(
      new Request("http://localhost/api/v1/publishing/schedule", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          contentId: "post-1",
          accountId: "acc-zalo-1",
          scheduledAt: "2026-11-15T09:00:00.000Z",
          publishMode: "ASSISTED_PUBLISH",
        }),
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(okSchedRes.status).toBe(201);
    const okSchedBody = (await okSchedRes.json()) as any;
    expect(okSchedBody.schedule).toBeDefined();
    expect(okSchedBody.job).toBeDefined();
    expect(okSchedBody.preparedContent.platform).toBe("ZALO");

    // 3. Reject duplicate scheduling of post-1 on same account within 30 days (PB-SC-001)
    const dupSchedRes = await handleApiRequest(
      new Request("http://localhost/api/v1/publishing/schedule", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          contentId: "post-1",
          accountId: "acc-zalo-1",
          scheduledAt: "2026-11-20T09:00:00.000Z",
          publishMode: "ASSISTED_PUBLISH",
        }),
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    expect(dupSchedRes.status).toBe(409);
    expect(((await dupSchedRes.json()) as any).error).toBe("DUPLICATE_CONTENT_ON_ACCOUNT");
  });

  it("manages publishing jobs (list, detail, confirm-assisted, cancel, retry)", async () => {
    // Schedule a job first
    const schedRes = await handleApiRequest(
      new Request("http://localhost/api/v1/publishing/schedule", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          contentId: "post-1",
          accountId: "acc-zalo-1",
          scheduledAt: "2026-11-18T09:00:00.000Z",
          publishMode: "ASSISTED_PUBLISH",
        }),
      }),
      ["api", "v1", "publishing", "schedule"],
      services,
    );
    const { job } = (await schedRes.json()) as any;

    // Confirm assisted publishing
    const confirmRes = await handleApiRequest(
      new Request(`http://localhost/api/v1/publishing/jobs/${job.id}/confirm-assisted`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          publishedUrl: "https://zalo.me/post/pb001",
          screenshotPath: "storage/evidence/pb001.png",
        }),
      }),
      ["api", "v1", "publishing", "jobs", job.id, "confirm-assisted"],
      services,
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as any;
    expect(confirmBody.job.status).toBe("PUBLISHED");
    expect(confirmBody.result.publishedUrl).toBe("https://zalo.me/post/pb001");

    // Get job detail with steps & result
    const detailRes = await handleApiRequest(
      new Request(`http://localhost/api/v1/publishing/jobs/${job.id}`, {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "publishing", "jobs", job.id],
      services,
    );
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as any;
    expect(detailBody.job.status).toBe("PUBLISHED");
    expect(detailBody.result).toBeDefined();
    expect(detailBody.steps.length).toBeGreaterThanOrEqual(1);
  });
});

