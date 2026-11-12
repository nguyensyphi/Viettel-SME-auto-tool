import { describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";
import { WorkspaceOperationsHub } from "../src/server/operations-hub.js";

const am = {
  userId: "am-dian-e2e",
  workspaceId: "ws-mod-pc-003-e2e",
  role: "AM" as const,
  teamId: "team-dian-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("MOD-PC-003 End-to-End Integration — Partner & Group Campaign Automation (PC-P01, PC-P02, PC-P03)", () => {
  it("executes the full lifecycle from Community Group Campaign Dispatch to Partner Onboarding, Tax-Code Deduplication, Commission Payout & Channel Analytics", async () => {
    const auth = {
      resolveSession: vi.fn(async (tok) => (tok === session ? am : null)),
      authenticatePassword: vi.fn() as any,
      acceptInvitation: vi.fn() as any,
      createInvitation: vi.fn() as any,
      changeMembershipRole: vi.fn() as any,
      revokeSession: vi.fn() as any,
    };

    const services: ApiServices = {
      auth,
      guard: new HttpAuthGuard(auth as any),
      leads: {} as any,
      tasks: {} as any,
      imports: new InMemoryImportApi({} as any),
      db: {} as any,
      sessionCookie: { secure: false, maxAgeSeconds: 3600 },
      operations: new WorkspaceOperationsHub(),
    };

    // 1. Register 2 Community Groups (1 ALLOWED Accounting group, 1 BLOCKED group)
    const g1Res = await handleApiRequest(
      new Request("http://localhost/api/v1/groups", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          groupId: "zalo_ketoan_binhduong",
          platform: "ZALO",
          name: "Hội Kế toán Thuế Hóa đơn điện tử Bình Dương",
          url: "https://zalo.me/g/ketoanbd2026",
          postingPermission: "ALLOWED",
          minHoursBetweenPosts: 24,
        }),
      }),
      ["api", "v1", "groups"],
      services,
    );
    expect(g1Res.status).toBe(201);

    const g2Res = await handleApiRequest(
      new Request("http://localhost/api/v1/groups", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          groupId: "fb_ketoan_blocked",
          platform: "FACEBOOK",
          name: "Nhóm Kế toán Nội bộ Đóng",
          url: "https://facebook.com/groups/ketoannoibo",
          postingPermission: "BLOCKED",
        }),
      }),
      ["api", "v1", "groups"],
      services,
    );
    expect(g2Res.status).toBe(201);

    // 2. Create & Approve Group Campaign for PARTNER_RECRUITMENT
    const campRes = await handleApiRequest(
      new Request("http://localhost/api/v1/campaigns", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          campaignId: "camp_e2e_ctv_2026",
          name: "Tuyển CTV Kế toán & Dịch vụ Thành lập DN Bình Dương",
          campaignType: "PARTNER_RECRUITMENT",
          targetCategories: ["ACCOUNTING_TAX"],
          contentTemplate:
            "Hợp tác CTV Viettel Bình Dương: Hoa hồng minh bạch khi giới thiệu Chữ ký số Viettel-CA & Hóa đơn điện tử S-Invoice.",
          mediaPaths: ["storage/media/ctv-recruitment.png"],
        }),
      }),
      ["api", "v1", "campaigns"],
      services,
    );
    expect(campRes.status).toBe(201);

    await handleApiRequest(
      new Request(
        "http://localhost/api/v1/campaigns/camp_e2e_ctv_2026/approve",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({}),
        },
      ),
      ["api", "v1", "campaigns", "camp_e2e_ctv_2026", "approve"],
      services,
    );

    const dispatchRes = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/campaigns/camp_e2e_ctv_2026/dispatch",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            accountId: "zalo-dian-am01",
            dispatchDate: "2026-11-11T08:00:00.000Z",
          }),
        },
      ),
      ["api", "v1", "campaigns", "camp_e2e_ctv_2026", "dispatch"],
      services,
    );
    expect(dispatchRes.status).toBe(200);
    const dispatchData = (await dispatchRes.json()) as any;
    expect(dispatchData.jobs).toHaveLength(1);
    expect(dispatchData.jobs[0].idempotencyKey).toBe(
      "campaign:camp_e2e_ctv_2026:group:zalo_ketoan_binhduong:date:2026-11-11",
    );
    expect(dispatchData.skippedGroups).toEqual([
      {
        groupId: "fb_ketoan_blocked",
        reason: "POSTING_NOT_PERMITTED:BLOCKED",
      },
    ]);

    // 3. Reject Partner CTV containing forbidden CCCD PII (Decree 13 guard)
    const badPiiRes = await handleApiRequest(
      new Request("http://localhost/api/v1/partners", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          partnerId: "ctv_bad",
          fullName: "Lê Văn X",
          phone: "0919888777",
          profession: "ACCOUNTANT",
          notes: "CCCD 079091002233",
        }),
      }),
      ["api", "v1", "partners"],
      services,
    );
    expect(badPiiRes.status).toBe(400);

    // 4. Register 2 legitimate Partner CTVs and activate both
    const p1Res = await handleApiRequest(
      new Request("http://localhost/api/v1/partners", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          partnerId: "ctv_e2e_01",
          fullName: "Đặng Thu Thảo (Dịch vụ Kế toán Dĩ An)",
          phone: "0918111222",
          profession: "ACCOUNTANT",
          sourceGroupId: "zalo_ketoan_binhduong",
          notes: "Chuyên thành lập DN mới tại KCN Sóng Thần",
        }),
      }),
      ["api", "v1", "partners"],
      services,
    );
    expect(p1Res.status).toBe(201);
    const p1 = (await p1Res.json()) as any;
    expect(p1.phoneMasked).toContain("*");

    const p2Res = await handleApiRequest(
      new Request("http://localhost/api/v1/partners", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          partnerId: "ctv_e2e_02",
          fullName: "Võ Hoàng Minh (Tư vấn DN)",
          phone: "0908333444",
          profession: "BUSINESS_CONSULTANT",
        }),
      }),
      ["api", "v1", "partners"],
      services,
    );
    expect(p2Res.status).toBe(201);

    for (const pid of ["ctv_e2e_01", "ctv_e2e_02"]) {
      await handleApiRequest(
        new Request(`http://localhost/api/v1/partners/${pid}/stage`, {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ newStage: "CONTACTED" }),
        }),
        ["api", "v1", "partners", pid, "stage"],
        services,
      );
      await handleApiRequest(
        new Request(`http://localhost/api/v1/partners/${pid}/stage`, {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ newStage: "ACTIVE_PARTNER" }),
        }),
        ["api", "v1", "partners", pid, "stage"],
        services,
      );
    }

    // 5. Partner 1 refers SME taxCode 3705566778; Partner 2 attempts duplicate claim -> 409
    const ref1Res = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/partners/ctv_e2e_01/referrals",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            referralId: "ref_e2e_01",
            companyName: "Công ty TNHH Logistics Sóng Thần",
            taxCode: "3705566778",
            productCodes: ["CA", "SINVOICE", "VCONTRACT"],
          }),
        },
      ),
      ["api", "v1", "partners", "ctv_e2e_01", "referrals"],
      services,
    );
    expect(ref1Res.status).toBe(201);

    const dupClaimRes = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/partners/ctv_e2e_02/referrals",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            referralId: "ref_e2e_dup",
            companyName: "Công ty TNHH Logistics Sóng Thần",
            taxCode: "3705566778",
            productCodes: ["CA"],
          }),
        },
      ),
      ["api", "v1", "partners", "ctv_e2e_02", "referrals"],
      services,
    );
    expect(dupClaimRes.status).toBe(409);

    // 6. Record Conversion & Payout
    const convRes = await handleApiRequest(
      new Request("http://localhost/api/v1/partners/conversions", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          conversionId: "conv_e2e_01",
          referralId: "ref_e2e_01",
          contractRevenueVnd: 8_000_000,
          commissionRatePercent: 10,
          policyReferenceNote: "Combo Chữ ký số + Hóa đơn điện tử + vContract",
        }),
      }),
      ["api", "v1", "partners", "conversions"],
      services,
    );
    expect(convRes.status).toBe(201);

    const payoutRes = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/partners/conversions/conv_e2e_01/payout",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            payoutReference: "UNC-VIETTEL-20261111-001",
          }),
        },
      ),
      ["api", "v1", "partners", "conversions", "conv_e2e_01", "payout"],
      services,
    );
    expect(payoutRes.status).toBe(200);

    // 7. Verify Partner Channel Analytics
    const analyticsRes = await handleApiRequest(
      new Request("http://localhost/api/v1/analytics/partners", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "analytics", "partners"],
      services,
    );
    expect(analyticsRes.status).toBe(200);
    const analytics = (await analyticsRes.json()) as any;
    expect(analytics.activePartners).toBe(2);
    expect(analytics.totalReferrals).toBe(1);
    expect(analytics.convertedReferrals).toBe(1);
    expect(analytics.conversionRatePercent).toBe(100);
    expect(analytics.totalRevenueVnd).toBe(8_000_000);
    expect(analytics.paidCommissionVnd).toBe(800_000);
    expect(analytics.groupSummary.totalGroups).toBe(2);
    expect(analytics.groupSummary.postableGroups).toBe(1);
  });
});

