import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";
import { WorkspaceOperationsHub } from "../src/server/operations-hub.js";

const am = {
  userId: "am-gp-01",
  workspaceId: "ws-group-posting-test",
  role: "AM" as const,
  teamId: "team-gp-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("Facebook Group Auto-Poster Integration Operations & HTTP API", () => {
  let services: ApiServices;
  let operations: WorkspaceOperationsHub;

  beforeEach(() => {
    const auth = {
      resolveSession: vi.fn(async (tok) => (tok === session ? am : null)),
      authenticatePassword: vi.fn() as any,
      acceptInvitation: vi.fn() as any,
      createInvitation: vi.fn() as any,
      changeMembershipRole: vi.fn() as any,
      revokeSession: vi.fn() as any,
    };

    operations = new WorkspaceOperationsHub();
    services = {
      auth,
      guard: new HttpAuthGuard(auth as any),
      leads: {} as any,
      tasks: {} as any,
      imports: new InMemoryImportApi({} as any),
      db: {} as any,
      sessionCookie: { secure: false, maxAgeSeconds: 3600 },
      operations,
    };
  });

  it("POST /api/v1/groups/bulk-import parses multiple group URLs and registers them", async () => {
    const urls = [
      "https://www.facebook.com/groups/sme_dian_doanhnghiep",
      "https://www.facebook.com/groups/ketoan_binhduong_hotro",
      "https://www.facebook.com/groups/sme_dian_doanhnghiep", // duplicate
    ];

    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/groups/bulk-import", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          urls,
          platform: "FACEBOOK",
        }),
      }),
      ["groups", "bulk-import"],
      services,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.added).toBe(2);
    expect(body.existing).toBe(1);

    const groupsList = operations.listGroups("ws-group-posting-test");
    expect(groupsList.length).toBe(2);
    expect(groupsList.map((g) => g.url)).toContain(
      "https://www.facebook.com/groups/sme_dian_doanhnghiep",
    );
  });

  it("dispatches campaign jobs with selected account & groups, lists them, and executes a job", async () => {
    // 1. Setup Facebook group
    operations.registerGroup("ws-group-posting-test", {
      groupId: "fb-group-sme-01",
      platform: "FACEBOOK",
      name: "Cộng đồng Doanh nghiệp Dĩ An",
      url: "https://www.facebook.com/groups/sme_dian_community",
      postingPermission: "ALLOWED",
      category: "STARTUP_SME",
    });

    // 2. Setup Campaign
    operations.createCampaign("ws-group-posting-test", {
      campaignId: "CAMP-FB-SME",
      name: "Chiến dịch Viettel-CA Cloud Dĩ An",
      campaignType: "SME_SOLUTION_SHARING",
      targetCategories: ["STARTUP_SME"],
      contentTemplate: "Khuyến mãi Chữ ký số Viettel-CA và Hóa đơn S-Invoice cho SME Dĩ An",
    });
    operations.approveCampaign("ws-group-posting-test", "CAMP-FB-SME", "am-gp-01");

    // 3. Dispatch Campaign with specific accountId and groupIds
    const dispatchRes = await handleApiRequest(
      new Request("http://localhost/api/v1/campaigns/CAMP-FB-SME/dispatch", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          accountId: "fb-viettel-sme",
          groupIds: ["fb-group-sme-01"],
          dispatchDate: new Date().toISOString(),
        }),
      }),
      ["campaigns", "CAMP-FB-SME", "dispatch"],
      services,
    );

    expect(dispatchRes.status).toBe(200);
    const dispatchBody = await dispatchRes.json();
    expect(dispatchBody.jobs.length).toBe(1);

    // 4. GET /api/v1/campaigns/group-jobs lists queued jobs
    const listRes = await handleApiRequest(
      new Request("http://localhost/api/v1/campaigns/group-jobs", {
        method: "GET",
        headers: headers(),
      }),
      ["campaigns", "group-jobs"],
      services,
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.jobs.length).toBe(1);
    expect(listBody.jobs[0].status).toBe("QUEUED");
    expect(listBody.jobs[0].accountId).toBe("fb-viettel-sme");
    expect(listBody.jobs[0].groupUrl).toBe("https://www.facebook.com/groups/sme_dian_community");

    const jobId = listBody.jobs[0].jobId;

    // 5. POST /api/v1/campaigns/group-jobs/:id/run executes the job
    const runRes = await handleApiRequest(
      new Request(`http://localhost/api/v1/campaigns/group-jobs/${jobId}/run`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["campaigns", "group-jobs", jobId, "run"],
      services,
    );
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json();
    expect(runBody.status).toMatch(/PUBLISHED|PENDING_APPROVAL/);
    expect(runBody.postUrl).toBeTruthy();
  });

  it("POST /api/v1/fb-poster/dispatch-post creates direct group posting jobs from Master Posts", async () => {
    operations.registerGroup("ws-group-posting-test", {
      groupId: "fb-group-direct-01",
      platform: "FACEBOOK",
      name: "Doanh nghiệp Dĩ An 247",
      url: "https://www.facebook.com/groups/dian247",
      postingPermission: "ALLOWED",
    });

    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/fb-poster/dispatch-post", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          accountId: "fb-viettel-sme",
          postId: "POST-TEST-01",
          postTitle: "Chữ ký số Viettel-CA Cloud",
          content: "Ưu đãi ký số từ xa không cần USB Token",
          groupIds: ["fb-group-direct-01"],
        }),
      }),
      ["fb-poster", "dispatch-post"],
      services,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs.length).toBe(1);
    expect(body.jobs[0].status).toBe("QUEUED");
    expect(body.jobs[0].groupUrl).toBe("https://www.facebook.com/groups/dian247");
  });

  it("DELETE /api/v1/groups/:groupId deletes an existing group from workspace", async () => {
    operations.registerGroup("ws-group-posting-test", {
      groupId: "fb-group-to-remove",
      platform: "FACEBOOK",
      name: "Nhóm lỗi cần gỡ",
      url: "https://www.facebook.com/groups/error_group",
      postingPermission: "ALLOWED",
    });

    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/groups/fb-group-to-remove", {
        method: "DELETE",
        headers: headers(),
      }),
      ["groups", "fb-group-to-remove"],
      services,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.groupId).toBe("fb-group-to-remove");

    // Verify it is no longer in list
    const remaining = operations.listGroups("ws-group-posting-test");
    expect(remaining.some((g) => g.groupId === "fb-group-to-remove")).toBe(false);
  });

  it("POST /api/v1/social-accounts/:accountId/verify-session returns account verification status", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/social-accounts/fb-viettel-sme/verify-session", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["social-accounts", "fb-viettel-sme", "verify-session"],
      services,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CONNECTED");
    expect(body.account.accountId).toBe("fb-viettel-sme");
  });
});
