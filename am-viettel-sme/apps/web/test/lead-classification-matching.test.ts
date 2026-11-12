import { describe, it, expect } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";

function callApi(
  services: ReturnType<typeof createDemoApiServices>,
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  const url = new URL(`http://localhost:3000${path}`);
  const segments = url.pathname.split("/").filter(Boolean);
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    ...(cookie ? { cookie } : {}),
  };
  let reqBody: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    reqBody = JSON.stringify(body);
  }
  const req = new Request(url.toString(), {
    method,
    headers,
    ...(reqBody ? { body: reqBody } : {}),
  });
  return handleApiRequest(req, segments, services);
}

describe("CA-005 & CA-006: Lead Classification and Product Matching API", () => {
  it("enriches lead detail with customer segment, screening questions, and matched Viettel products", async () => {
    const services = createDemoApiServices();

    // 1. Authenticate as AM
    const loginRes = await callApi(
      services,
      "/api/v1/auth/login",
      "POST",
      {
        workspaceId: "viettel-sme",
        email: "am@viettel.vn",
        password: "secret-password",
      },
    );
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    // 2. Create a new lead (Transport & Logistics company)
    const createLeadRes = await callApi(
      services,
      "/api/v1/leads",
      "POST",
      {
        companyName: "Công ty TNHH Vận Tải Sóng Thần Dĩ An",
        district: "Dĩ An",
        industry: "Vận tải hàng hóa & Logistics kho bãi",
        province: "Bình Dương",
        website: null,
        businessAddress: "KCN Sóng Thần 1, Dĩ An",
        ownerUserId: null,
        contact: {
          contactName: "Bác Hùng Quản lý Đội xe",
          phoneNormalized: "0912345678",
          emailNormalized: null,
          jobTitle: "Trưởng phòng điều hành",
        },
        source: {
          sourceType: "MANUAL",
          contactBasis: "LEGITIMATE_INTEREST",
          sourceLabel: "Khai thác thực địa KCN",
          sourceUrl: null,
          collectedAt: null,
        },
      },
      cookie,
    );
    expect(createLeadRes.status).toBe(201);
    const created = (await createLeadRes.json()) as { leadId: string };
    expect(created.leadId).toBeDefined();

    // 3. Fetch lead detail
    const detailRes = await callApi(
      services,
      `/api/v1/leads/${created.leadId}`,
      "GET",
      undefined,
      cookie,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      id: string;
      companyName: string;
      classification?: {
        segment: string;
        recommendedServices: string[];
        screeningQuestions: string[];
        suggestionStatus: string;
      };
      productMatches?: {
        serviceId: string;
        serviceName: string;
        bundleAvailable: boolean;
        bundleName?: string;
        painPointsAddressed: string[];
      }[];
    };

    // 4. Assert classification is present and classified as Logistics & Transport
    expect(detail.classification).toBeDefined();
    expect(detail.classification?.segment).toBe("LOGISTICS_TRANSPORT");
    expect(detail.classification?.screeningQuestions.length).toBeGreaterThan(0);
    expect(detail.classification?.suggestionStatus).toBe("PENDING_AM_REVIEW");

    // 5. Assert product matching includes vTracking & Camera ND10
    expect(detail.productMatches).toBeDefined();
    expect(detail.productMatches?.length).toBeGreaterThan(0);
    const serviceIds = detail.productMatches?.map((p) => p.serviceId) ?? [];
    expect(serviceIds).toContain("VTRACKING");
    expect(serviceIds).toContain("CAMERA_ND10");

    // 6. Assert AI Lead Scoring (100-Point Rubric - Slide 4)
    expect((detail as { leadScore?: { totalScore: number; tier: string } }).leadScore).toBeDefined();
    const score = (detail as { leadScore?: { totalScore: number; tier: string } }).leadScore;
    expect(score?.totalScore).toBeGreaterThanOrEqual(35);
    expect(["A", "B", "C", "D"]).toContain(score?.tier);

    // 7. Assert listLeads also includes leadScore
    const listRes = await callApi(
      services,
      "/api/v1/leads",
      "GET",
      undefined,
      cookie,
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { items: { leadScore?: { tier: string } }[] };
    expect(listData.items.length).toBeGreaterThan(0);
    expect(listData.items[0]?.leadScore).toBeDefined();
  });
});

