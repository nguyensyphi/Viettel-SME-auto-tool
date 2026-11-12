import { describe, it, expect, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import { handleApiRequest } from "../src/server/http-api.js";

const principal = {
  userId: "am-1",
  workspaceId: "workspace-1",
  role: "AM" as const,
  teamId: "team-1",
};

const validCookie = "am_sme_session=abcdefghijklmnopqrstuvwxyz0123456789-secret";

describe("Facebook Poster & Lead Scoring Endpoints", () => {
  it("should dispatch page/profile post via /api/v1/fb-poster/dispatch-page-post", async () => {
    const mockOperations = {
      dispatchPageOrWallPost: vi.fn().mockReturnValue({
        job: {
          jobId: "page-job-1",
          status: "QUEUED",
          groupName: "Trang cá nhân (Personal Profile)",
        },
      }),
    };

    const auth = {
      resolveSession: vi.fn(async () => principal),
    };

    const request = new Request("http://localhost/api/v1/fb-poster/dispatch-page-post", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: validCookie,
      },
      body: JSON.stringify({
        accountId: "fb-viettel-sme",
        postId: "post-1",
        postTitle: "Giải pháp Viettel-CA",
        content: "Nội dung bài viết giải pháp số",
        targetType: "PERSONAL_WALL",
        mediaPaths: ["https://example.com/banner.png"],
      }),
    });

    const response = await handleApiRequest(
      request,
      ["fb-poster", "dispatch-page-post"],
      {
        auth: auth as any,
        guard: new HttpAuthGuard(auth as any),
        sessionCookie: { secure: false, maxAgeSeconds: 86400 },
        operations: mockOperations as any,
      } as any,
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.job.jobId).toBe("page-job-1");
  });

  it("should evaluate 100-point lead score via /api/v1/leads/evaluate-score", async () => {
    const auth = {
      resolveSession: vi.fn(async () => principal),
    };

    const request = new Request("http://localhost/api/v1/leads/evaluate-score", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: validCookie,
      },
      body: JSON.stringify({
        taxCode: "3701234567",
        companyName: "CÔNG TY TNHH VẬN TẢI & LOGISTICS DĨ AN",
        establishedYear: new Date().getFullYear(),
        industry: "Vận tải",
        employeeCount: 20,
        hasPhone: true,
        hasEmail: true,
      }),
    });

    const response = await handleApiRequest(
      request,
      ["leads", "evaluate-score"],
      {
        auth: auth as any,
        guard: new HttpAuthGuard(auth as any),
        sessionCookie: { secure: false, maxAgeSeconds: 86400 },
        operations: {} as any,
      } as any,
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.totalScore).toBeGreaterThanOrEqual(80);
    expect(data.tier).toBe("A");
    expect(data.recommendedProducts).toBeDefined();
  });
});
