import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";
import { WorkspaceOperationsHub } from "../src/server/operations-hub.js";

const am = {
  userId: "am-pc-01",
  workspaceId: "ws-mod-pc-003",
  role: "AM" as const,
  teamId: "team-pc-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("MOD-PC-003 HTTP API — Community Groups, Campaign Dispatch, Partner Referrals, Conversions & Analytics", () => {
  let services: ApiServices;

  beforeEach(() => {
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
      operations: new WorkspaceOperationsHub(),
    };
  });

  it("registers community groups, infers categories, checks eligibility, and dispatches group campaign jobs (PC-P01)", async () => {
    // 1. Register an ALLOWED accounting group
    const reg1 = await handleApiRequest(
      new Request("http://localhost/api/v1/groups", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          groupId: "grp_ketoan_01",
          platform: "ZALO",
          name: "Hội Kế toán Thuế Dĩ An Bình Dương",
          url: "https://zalo.me/g/ketoandian",
          postingPermission: "ALLOWED",
          minHoursBetweenPosts: 24,
        }),
      }),
      ["api", "v1", "groups"],
      services,
    );
    expect(reg1.status).toBe(201);
    const grp1 = (await reg1.json()) as any;
    expect(grp1.category).toBe("ACCOUNTING_TAX");

    // 2. Register a READ_ONLY accounting group
    const reg2 = await handleApiRequest(
      new Request("http://localhost/api/v1/groups", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          groupId: "grp_ketoan_readonly",
          platform: "FACEBOOK",
          name: "Cộng đồng Kế toán Kiểm toán Miền Nam",
          url: "https://facebook.com/groups/ketoanmn",
          postingPermission: "READ_ONLY",
        }),
      }),
      ["api", "v1", "groups"],
      services,
    );
    expect(reg2.status).toBe(201);

    // 3. List groups
    const listRes = await handleApiRequest(
      new Request("http://localhost/api/v1/groups?category=ACCOUNTING_TAX", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "groups"],
      services,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.groups).toHaveLength(2);

    // 4. Check eligibility on READ_ONLY group
    const eligRes = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/groups/grp_ketoan_readonly/check-eligibility",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({}),
        },
      ),
      ["api", "v1", "groups", "grp_ketoan_readonly", "check-eligibility"],
      services,
    );
    expect(eligRes.status).toBe(200);
    const eligBody = (await eligRes.json()) as any;
    expect(eligBody.eligible).toBe(false);
    expect(eligBody.reason).toContain("POSTING_NOT_PERMITTED");

    // 5. Create & Approve Group Campaign
    const createCamp = await handleApiRequest(
      new Request("http://localhost/api/v1/campaigns", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          campaignId: "camp_kt_01",
          name: "Tuyển CTV Kế toán Thuế Q4/2026",
          campaignType: "PARTNER_RECRUITMENT",
          targetCategories: ["ACCOUNTING_TAX"],
          contentTemplate:
            "Viettel Dĩ An hợp tác CTV Kế toán triển khai Chữ ký số Viettel-CA & Hóa đơn điện tử S-Invoice.",
        }),
      }),
      ["api", "v1", "campaigns"],
      services,
    );
    expect(createCamp.status).toBe(201);

    const approveCamp = await handleApiRequest(
      new Request("http://localhost/api/v1/campaigns/camp_kt_01/approve", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({}),
      }),
      ["api", "v1", "campaigns", "camp_kt_01", "approve"],
      services,
    );
    expect(approveCamp.status).toBe(200);

    // 6. Dispatch Campaign Jobs
    const dispatchRes = await handleApiRequest(
      new Request("http://localhost/api/v1/campaigns/camp_kt_01/dispatch", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          accountId: "zalo-dian-am01",
        }),
      }),
      ["api", "v1", "campaigns", "camp_kt_01", "dispatch"],
      services,
    );
    expect(dispatchRes.status).toBe(200);
    const dispatchBody = (await dispatchRes.json()) as any;
    expect(dispatchBody.jobs).toHaveLength(1);
    expect(dispatchBody.jobs[0].groupId).toBe("grp_ketoan_01");
    expect(dispatchBody.skippedGroups).toEqual([
      {
        groupId: "grp_ketoan_readonly",
        reason: "POSTING_NOT_PERMITTED:READ_ONLY",
      },
    ]);
  });

  it("manages partner referrals, blocks duplicate taxCode across partners, records AM-confirmed conversions, payouts, and analytics (PC-P02 & PC-P03)", async () => {
    // 1. Transition seeded partner part-01 (NEW -> CONTACTED -> ACTIVE_PARTNER)
    await handleApiRequest(
      new Request("http://localhost/api/v1/partners/part-01/stage", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ newStage: "CONTACTED" }),
      }),
      ["api", "v1", "partners", "part-01", "stage"],
      services,
    );
    await handleApiRequest(
      new Request("http://localhost/api/v1/partners/part-01/stage", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ newStage: "ACTIVE_PARTNER" }),
      }),
      ["api", "v1", "partners", "part-01", "stage"],
      services,
    );

    // 2. Record referral for part-01
    const refRes = await handleApiRequest(
      new Request("http://localhost/api/v1/partners/part-01/referrals", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          referralId: "ref_api_01",
          companyName: "Công ty TNHH Thương mại Tân Phú",
          taxCode: "3701234567 - 001",
          productCodes: ["CA", "SINVOICE"],
        }),
      }),
      ["api", "v1", "partners", "part-01", "referrals"],
      services,
    );
    expect(refRes.status).toBe(201);
    const refBody = (await refRes.json()) as any;
    expect(refBody.normalizedTaxCode).toBe("3701234567-001");

    // 3. Duplicate taxCode referral must return 409
    const dupRefRes = await handleApiRequest(
      new Request("http://localhost/api/v1/partners/part-01/referrals", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          referralId: "ref_api_02",
          companyName: "Công ty TNHH Thương mại Tân Phú",
          taxCode: "3701234567-001",
          productCodes: ["CA"],
        }),
      }),
      ["api", "v1", "partners", "part-01", "referrals"],
      services,
    );
    expect(dupRefRes.status).toBe(409);

    // 4. Record conversion
    const convRes = await handleApiRequest(
      new Request("http://localhost/api/v1/partners/conversions", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          conversionId: "conv_api_01",
          referralId: "ref_api_01",
          contractRevenueVnd: 6_000_000,
          commissionRatePercent: 10,
          policyReferenceNote: "Tờ trình CTV SME Q4/2026",
        }),
      }),
      ["api", "v1", "partners", "conversions"],
      services,
    );
    expect(convRes.status).toBe(201);
    const convBody = (await convRes.json()) as any;
    expect(convBody.commissionAmountVnd).toBe(600_000);
    expect(convBody.payoutStatus).toBe("APPROVED_PENDING_PAYOUT");

    // 5. Mark conversion PAID
    const payoutRes = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/partners/conversions/conv_api_01/payout",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            payoutReference: "UNC-20261111-777",
          }),
        },
      ),
      ["api", "v1", "partners", "conversions", "conv_api_01", "payout"],
      services,
    );
    expect(payoutRes.status).toBe(200);
    const payoutBody = (await payoutRes.json()) as any;
    expect(payoutBody.payoutStatus).toBe("PAID");
    expect(payoutBody.payoutReference).toBe("UNC-20261111-777");

    // 6. Get partner reconciliation
    const reconRes = await handleApiRequest(
      new Request("http://localhost/api/v1/partners/part-01/reconciliation", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "partners", "part-01", "reconciliation"],
      services,
    );
    expect(reconRes.status).toBe(200);
    const reconBody = (await reconRes.json()) as any;
    expect(reconBody.summary).toEqual({
      partnerId: "part-01",
      totalReferrals: 1,
      convertedCount: 1,
      totalRevenueVnd: 6_000_000,
      approvedPendingCommissionVnd: 0,
      paidCommissionVnd: 600_000,
    });
    expect(reconBody.referrals).toHaveLength(1);
    expect(reconBody.conversions).toHaveLength(1);

    // 7. Get Partner & Group Analytics
    const analyticsRes = await handleApiRequest(
      new Request("http://localhost/api/v1/analytics/partners", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "analytics", "partners"],
      services,
    );
    expect(analyticsRes.status).toBe(200);
    const analyticsBody = (await analyticsRes.json()) as any;
    expect(analyticsBody.totalPartners).toBeGreaterThanOrEqual(1);
    expect(analyticsBody.activePartners).toBe(1);
    expect(analyticsBody.totalReferrals).toBe(1);
    expect(analyticsBody.convertedReferrals).toBe(1);
    expect(analyticsBody.totalRevenueVnd).toBe(6_000_000);
    expect(analyticsBody.paidCommissionVnd).toBe(600_000);
  });
});

