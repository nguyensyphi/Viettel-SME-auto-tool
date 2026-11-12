import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";

const am = {
  userId: "am-user-1",
  workspaceId: "workspace-analytics-test",
  role: "AM" as const,
  teamId: "team-analytics-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("Analytics & Reporting HTTP API (PB-P09, Spec 17 & 20.7)", () => {
  let services: ApiServices;

  beforeEach(() => {
    const mockContentRepo = {
      listPosts: vi.fn(async () => [
        {
          id: "post-1",
          postCode: "PB001",
          topicCode: "CHU_KY_SO",
          status: "APPROVED",
          platforms: ["ZALO", "FACEBOOK"],
        },
        {
          id: "post-2",
          postCode: "PB002",
          topicCode: "HOA_DON_DIEN_TU",
          status: "APPROVED",
          platforms: ["ZALO"],
        },
        {
          id: "post-3",
          postCode: "PB003",
          topicCode: "CHU_KY_SO",
          status: "DRAFT",
          platforms: ["FACEBOOK"],
        },
      ]),
      listMediaAssets: vi.fn(async () => [
        { id: "m-1", topicCode: "CHU_KY_SO", status: "APPROVED" },
        { id: "m-2", topicCode: "HOA_DON_DIEN_TU", status: "PENDING" },
      ]),
      listSocialAccounts: vi.fn(async () => [
        {
          id: "acc-1",
          accountCode: "zalo-dian-am01",
          platform: "ZALO",
          displayName: "Zalo Lê Văn AM",
          status: "ACTIVE",
        },
        {
          id: "acc-2",
          accountCode: "fb-dian-am01",
          platform: "FACEBOOK",
          displayName: "Facebook Lê Văn AM",
          status: "SESSION_EXPIRED",
        },
      ]),
      listPublishingJobs: vi.fn(async () => [
        {
          id: "job-1",
          contentId: "post-1",
          accountId: "acc-1",
          platform: "ZALO",
          status: "PUBLISHED",
        },
        {
          id: "job-2",
          contentId: "post-2",
          accountId: "acc-1",
          platform: "ZALO",
          status: "WAITING_CONFIRMATION",
        },
        {
          id: "job-3",
          contentId: "post-1",
          accountId: "acc-2",
          platform: "FACEBOOK",
          status: "FAILED",
        },
      ]),
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
      contentLibrary: mockContentRepo as any,
    };
  });

  it("GET /api/v1/analytics/publishing-summary returns overall content, media, account, and job metrics", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/analytics/publishing-summary", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "analytics", "publishing-summary"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.posts.total).toBe(3);
    expect(body.posts.approved).toBe(2);
    expect(body.posts.draft).toBe(1);
    expect(body.media.total).toBe(2);
    expect(body.media.approved).toBe(1);
    expect(body.jobs.total).toBe(3);
    expect(body.jobs.published).toBe(1);
    expect(body.jobs.waitingConfirmation).toBe(1);
    expect(body.jobs.failed).toBe(1);
  });

  it("GET /api/v1/analytics/topics returns breakdown of posts and published jobs per topicCode", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/analytics/topics", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "analytics", "topics"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const cks = body.topics.find((t: any) => t.topicCode === "CHU_KY_SO");
    expect(cks).toBeDefined();
    expect(cks.totalPosts).toBe(2);
    expect(cks.publishedJobs).toBe(1);
  });

  it("GET /api/v1/analytics/accounts returns per-account publishing stats and session status", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/analytics/accounts", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "analytics", "accounts"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.accounts).toHaveLength(2);
    const zalo = body.accounts.find((a: any) => a.accountCode === "zalo-dian-am01");
    expect(zalo.publishedCount).toBe(1);
    expect(zalo.waitingConfirmationCount).toBe(1);
    const fb = body.accounts.find((a: any) => a.accountCode === "fb-dian-am01");
    expect(fb.status).toBe("SESSION_EXPIRED");
    expect(fb.failedCount).toBe(1);
  });
});

