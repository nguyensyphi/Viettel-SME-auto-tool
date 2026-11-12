import { describe, expect, it } from "vitest";
import { WorkspaceOperationsHub } from "../src/server/operations-hub.js";

describe("Task 5: Operational Data for Accounts, Calendar, and Campaigns", () => {
  it("initializes default social accounts for workspace", () => {
    const hub = new WorkspaceOperationsHub();
    const accounts = hub.listSocialAccounts("viettel-sme");
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    expect(accounts.some((a) => a.platform === "ZALO")).toBe(true);
    expect(accounts.some((a) => a.platform === "FACEBOOK")).toBe(true);
  });

  it("initializes default publishing calendar records", () => {
    const hub = new WorkspaceOperationsHub();
    const calendar = hub.listCalendarRecords("viettel-sme");
    expect(calendar.length).toBeGreaterThanOrEqual(2);
    expect(calendar.some((c) => c.topic.includes("Viettel-CA") || c.topic.includes("S-Invoice"))).toBe(true);
  });

  it("initializes active campaigns, community groups, and partner CRM overview", () => {
    const hub = new WorkspaceOperationsHub();
    const overview = hub.getCampaignsOverview("viettel-sme");
    expect(overview.campaigns.length).toBeGreaterThanOrEqual(1);
    expect(overview.partners.length).toBeGreaterThanOrEqual(1);
    expect(overview.groups.length).toBeGreaterThanOrEqual(2);
    expect(overview.referrals.length).toBeGreaterThanOrEqual(1);
    expect(overview.conversions.length).toBeGreaterThanOrEqual(1);
  });

  it("declares a new social account and marks it as connected after QR verification", () => {
    const hub = new WorkspaceOperationsHub();
    const declared = hub.declareSocialAccount("viettel-sme", {
      accountId: "zalo-dian-am02",
      platform: "ZALO",
    }, "user-am");
    expect(declared.status).toBe("NEEDS_LOGIN");
    expect(declared.accountId).toBe("zalo-dian-am02");

    const connected = hub.connectSocialAccount("viettel-sme", "zalo-dian-am02", "ZALO", "user-am");
    expect(connected.status).toBe("CONNECTED");
    expect(connected.qrLoginRequested).toBe(false);

    const list = hub.listSocialAccounts("viettel-sme");
    expect(list.find((a) => a.accountId === "zalo-dian-am02")?.status).toBe("CONNECTED");
  });

  it("creates and approves a new campaign", () => {
    const hub = new WorkspaceOperationsHub();
    const created = hub.createCampaign("viettel-sme", {
      campaignId: "CAMP-DIAN-02",
      name: "Chiến dịch số hóa hộ kinh doanh Tân Bình",
      campaignType: "PARTNER_RECRUITMENT",
      targetCategories: ["BUSINESS_ASSOCIATION"],
      contentTemplate: "Chào bạn, Viettel Dĩ An đang tuyển CTV số hóa...",
    });
    expect(created.status).toBe("DRAFT");

    const approved = hub.approveCampaign("viettel-sme", "CAMP-DIAN-02", "user-am");
    expect(approved.status).toBe("APPROVED");
  });

  it("registers a partner CTV and transitions stage", () => {
    const hub = new WorkspaceOperationsHub();
    const partner = hub.registerPartner("viettel-sme", {
      partnerId: "CTV-TEST-01",
      fullName: "Nguyễn Văn Test",
      phone: "0901234567",
      profession: "ACCOUNTANT",
      notes: "Kế toán viên tự do",
    });
    expect(partner.stage).toBe("NEW");
    expect(partner.fullName).toBe("Nguyễn Văn Test");

    const contacted = hub.transitionPartnerStage("viettel-sme", "CTV-TEST-01", "CONTACTED", "user-am");
    expect(contacted.stage).toBe("CONTACTED");

    const updated = hub.transitionPartnerStage("viettel-sme", "CTV-TEST-01", "ACTIVE_PARTNER", "user-am");
    expect(updated.stage).toBe("ACTIVE_PARTNER");
  });
});
