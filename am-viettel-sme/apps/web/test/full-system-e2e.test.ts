// @vitest-environment jsdom
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryKillSwitchStore,
  KillSwitchController,
} from "@am-sme/config";
import { mapLeadRow } from "@am-sme/excel-import";
import {
  classifyCustomerLead,
  confirmSuggestion,
  CustomerSegment,
  generateOutreachMessage,
  matchProductsForCustomer,
} from "@am-sme/domain";
import {
  matchMediaToPost,
  parseStructuredPosts,
  PublishingScheduler,
} from "@am-sme/content-library";
import {
  BrowserProfileManager,
  InMemoryAccountSessionStore,
  PublishingWorker,
  type BrowserPageHandle,
  type PersistentContextHandle,
} from "@am-sme/browser-automation";
import {
  CampaignManager,
  GroupManager,
  PartnerCrmService,
} from "@am-sme/campaigns";
import { TelegramAdminBot } from "@am-sme/telegram-bot";
import { WorkspaceApp } from "../src/ui/workspace-app.js";
import { AccountsView } from "../src/ui/accounts-view.js";
import { CalendarView } from "../src/ui/calendar-view.js";
import { CampaignView } from "../src/ui/campaign-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Viettel AM SME Platform — Full System E2E & Dashboard Views (Task 14)", () => {
  it("executes complete pipeline: Lead Import -> P0 Suggestion/AM Confirm -> Content Schedule & Publish -> Partner CRM -> Telegram Kill Switch", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-full-e2e-"));
    try {
      // 1. Module 01: Lead Import -> Suggestion Classification/Matching -> AM Confirmation -> Outreach Draft
      const rowResult = mapLeadRow(
        [
          "Công ty TNHH Giải Pháp Số Bình Dương",
          "0908123456",
          "Công nghệ phần mềm",
          "Dĩ An",
          "CONSENT_RECORDED",
          "ALLOWED_FOR_RECORDED_PURPOSE",
        ],
        [
          { sourceColumnIndex: 0, targetField: "company_name" },
          { sourceColumnIndex: 1, targetField: "phone" },
          { sourceColumnIndex: 2, targetField: "industry" },
          { sourceColumnIndex: 3, targetField: "district" },
          { sourceColumnIndex: 4, targetField: "lawful_contact_basis" },
          { sourceColumnIndex: 5, targetField: "consent_status" },
        ],
      );
      expect(rowResult.success).toBe(true);
      if (!rowResult.success) throw new Error("unexpected mapping failure");

      const classification = classifyCustomerLead({
        businessName: rowResult.lead.company_name,
        taxCode: "3702888999",
        isNewlyEstablished: true,
        ...(rowResult.lead.industry ? { industry: rowResult.lead.industry } : {}),
      });
      expect(classification.segment).toBe(CustomerSegment.NEW_ESTABLISHED);
      expect(classification.suggestionStatus).toBe("PENDING_AM_REVIEW");
      expect(classification.autoAssigned).toBe(false);

      const matches = matchProductsForCustomer({
        segment: classification.segment,
      });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.policyStatus).toBe("CAN_XAC_NHAN_LAI");
      expect(matches[0]?.suggestionStatus).toBe("PENDING_AM_REVIEW");

      const eligibilityInput = {
        status: "ALLOWED_FOR_RECORDED_PURPOSE" as const,
        hasSourceEvidence: true,
        hasContactBasis: true,
        hasConsentEvidence: true,
        channelAllowed: true,
        hasPurpose: true,
        hasConsentTimestamp: true,
        suppressed: false,
      };

      // Blocked before AM confirmation
      const blockedBeforeConfirm = generateOutreachMessage({
        channel: "ZALO",
        businessName: rowResult.lead.company_name,
        contactName: "Anh Minh",
        serviceOffering: "VIETTEL_CA",
        amProfile: {
          fullName: "Hùng",
          title: "AM Viettel SME",
          phoneNumber: "0988111222",
        },
        eligibilityInput,
      });
      expect(blockedBeforeConfirm.allowed).toBe(false);

      const confirmedProfile = confirmSuggestion(classification, {
        amUserId: "am_01",
        confirmedSegment: classification.segment,
        confirmedServices: ["VIETTEL_CA", "HOA_DON_DIEN_TU"],
        confirmedAt: "2026-11-05T09:00:00.000Z",
      });

      const outreach = generateOutreachMessage({
        channel: "ZALO",
        businessName: rowResult.lead.company_name,
        contactName: "Anh Minh",
        serviceOffering: "VIETTEL_CA",
        amProfile: {
          fullName: "Hùng",
          title: "AM Viettel SME",
          phoneNumber: "0988111222",
        },
        eligibilityInput,
        amConfirmation: confirmedProfile,
      });
      expect(outreach.allowed).toBe(true);
      if (outreach.allowed) {
        expect(outreach.messageText).toContain("TỪ CHỐI");
      }

      // 2. Module 02: Content Library -> Media Matcher -> Scheduler -> Playwright PublishingWorker
      const parsedPosts = parseStructuredPosts(`
CONTENT_ID: POST-E2E-01
TOPIC: CHU_KY_SO
MEDIA_REQUIRED: true
PLATFORMS: FACEBOOK
CONTENT:
Giải pháp chữ ký số doanh nghiệp mới thành lập tại Bình Dương & TP.HCM.
`);
      expect(parsedPosts).toHaveLength(1);
      const bannerPath = path.join(tempDir, "POST-E2E-01_banner.png");
      fs.writeFileSync(bannerPath, new Uint8Array([137, 80, 78, 71]));

      const assets = [
        {
          assetId: "asset_01",
          fileName: "POST-E2E-01_banner.png",
          mimeType: "image/png" as const,
          sizeBytes: 4,
          localPath: bannerPath,
          sha256: "abc",
          contentIdHint: "POST-E2E-01",
        },
      ];
      const matchedMedia = matchMediaToPost(parsedPosts[0]!, assets);
      expect(matchedMedia).toHaveLength(1);

      const scheduler = new PublishingScheduler();
      scheduler.registerDraft(parsedPosts[0]!, assets);
      scheduler.approvePost("POST-E2E-01", "am_01");
      const scheduled = scheduler.schedulePost(
        "POST-E2E-01",
        "am_01",
        "FACEBOOK",
        new Date("2026-11-06T09:00:00.000Z"),
      );
      expect(scheduled.post.lifecycleStatus).toBe("SCHEDULED");

      const visible = new Set([
        "[role='navigation']",
        "[role='button'][aria-label*='What']",
        "[role='textbox']",
        "input[type='file']",
        "[aria-label='Post']",
      ]);
      const mockPage: BrowserPageHandle = {
        url: () => "https://www.facebook.com/",
        goto: vi.fn(async () => {}),
        locator: (sel: string) => ({
          count: async () => (visible.has(sel) ? 1 : 0),
          first: () => ({
            click: vi.fn(async () => {}),
            fill: vi.fn(async () => {}),
            pressSequentially: vi.fn(async () => {}),
            setInputFiles: vi.fn(async () => {}),
            isVisible: async () => visible.has(sel),
          }),
        }),
        screenshot: vi.fn(async (opts?: { path?: string | undefined }) => {
          const bytes = new Uint8Array([1, 2, 3]);
          if (opts?.path) {
            fs.mkdirSync(path.dirname(opts.path), { recursive: true });
            fs.writeFileSync(opts.path, bytes);
          }
          return bytes;
        }),
        waitForTimeout: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      const listeners: Array<() => void> = [];
      const mockCtx: PersistentContextHandle = {
        pages: () => [mockPage],
        newPage: async () => mockPage,
        close: async () => {
          for (const fn of listeners) fn();
        },
        on: (ev, fn) => {
          if (ev === "close") listeners.push(fn);
        },
      };

      const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());
      const profileManager = new BrowserProfileManager({
        storageRootDir: tempDir,
        launcher: { launchPersistentContext: async () => mockCtx },
      });
      const worker = new PublishingWorker({
        profileManager,
        sessionStore: new InMemoryAccountSessionStore(),
        evidenceDir: path.join(tempDir, "evidence"),
        killSwitch,
      });

      const pubRes = await worker.executePublishingJob({
        jobId: "job_e2e_1",
        accountId: "am_01",
        platform: "FACEBOOK",
        contentId: scheduled.jobSpec.contentId,
        content: scheduled.jobSpec.content,
        mediaPaths: scheduled.jobSpec.mediaPaths,
        mode: "FULL_AUTO",
      });
      expect(pubRes.status).toBe("PUBLISHED");

      // 3. Module 03: Group Campaign + Partner CRM Reconciliation
      const groupManager = new GroupManager();
      groupManager.registerGroup({
        groupId: "grp_ketoan_bd",
        platform: "FACEBOOK",
        name: "Hội Kế Toán Bình Dương",
        url: "https://www.facebook.com/groups/ketoanbd",
        postingPermission: "ALLOWED",
      });
      const campaignManager = new CampaignManager({ groupManager, killSwitch });
      campaignManager.createCampaign({
        campaignId: "CMP-E2E",
        name: "Tuyển CTV Kế Toán Bình Dương",
        campaignType: "PARTNER_RECRUITMENT",
        targetCategories: ["ACCOUNTING_TAX"],
        contentTemplate: "Hợp tác giới thiệu giải pháp số doanh nghiệp SME.",
      });
      campaignManager.approveCampaign("CMP-E2E", "am_01");
      const dispatch = await campaignManager.buildDispatchJobs({
        campaignId: "CMP-E2E",
        accountId: "am_01",
        dispatchDate: new Date("2026-11-05T10:00:00.000Z"),
      });
      expect(dispatch.jobs).toHaveLength(1);

      const partnerCrm = new PartnerCrmService();
      partnerCrm.registerPartner({
        partnerId: "ctv_e2e_01",
        fullName: "Nguyễn Thị Hoa",
        phone: "0918222333",
        profession: "ACCOUNTANT",
        sourceGroupId: "grp_ketoan_bd",
      });
      partnerCrm.transitionPartnerStage("ctv_e2e_01", "CONTACTED", "am_01");
      partnerCrm.transitionPartnerStage("ctv_e2e_01", "ACTIVE_PARTNER", "am_01");
      partnerCrm.recordReferral({
        referralId: "ref_e2e_01",
        partnerId: "ctv_e2e_01",
        companyName: rowResult.lead.company_name,
        taxCode: "3702888999",
        productCodes: ["VIETTEL_CA", "HOA_DON_DIEN_TU"],
      });
      partnerCrm.recordConversion({
        conversionId: "conv_e2e_01",
        referralId: "ref_e2e_01",
        contractRevenueVnd: 2_000_000,
        commissionRatePercent: 10,
        commissionPolicyConfirmedByAmId: "am_01",
      });
      expect(
        partnerCrm.getPartnerReconciliationSummary("ctv_e2e_01")
          .approvedPendingCommissionVnd,
      ).toBe(200_000);

      // 4. Module 04: Telegram Admin Bot Kill Switch Integration
      const bot = new TelegramAdminBot({
        allowedOperatorIds: ["admin_tg_01"],
        killSwitch,
        transport: { sendMessage: async () => {} },
        getDashboardSnapshot: async () => ({
          connectedAccounts: 1,
          needsLoginAccounts: 0,
          pendingReviewLeads: 1,
          activeCampaigns: 1,
        }),
        getQueueJobsSnapshot: async () => ({
          waiting: 0,
          active: 0,
          completed: 2,
          failed: 0,
          dlqCount: 0,
        }),
      });

      await bot.handleUpdate({
        operatorId: "admin_tg_01",
        chatId: "chat_01",
        text: "/pause Kiểm tra bảo trì",
      });

      const haltedRes = await worker.executePublishingJob({
        jobId: "job_e2e_2",
        accountId: "am_01",
        platform: "FACEBOOK",
        contentId: "POST-E2E-01",
        content: scheduled.jobSpec.content,
        mode: "FULL_AUTO",
      });
      expect(haltedRes.status).toBe("HALTED_KILL_SWITCH");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("renders AccountsView, CalendarView, and CampaignView inside WorkspaceApp navigation", async () => {
    expect(AccountsView).toBeTypeOf("function");
    expect(CalendarView).toBeTypeOf("function");
    expect(CampaignView).toBeTypeOf("function");

    const principal = {
      userId: "am-1",
      workspaceId: "workspace-1",
      role: "AM" as const,
      teamId: "team-1",
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ user: principal }), {
          status: 200,
          headers: { "content-type": "application/json" } ,
        });
      }
      if (url.endsWith("/social-accounts")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                accountId: "am_zalo_01",
                platform: "ZALO",
                status: "NEEDS_LOGIN",
                profileDir: "storage/browser_profiles/am_zalo_01",
                circuitState: "CLOSED",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/publishing-calendar")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                contentId: "POST-001",
                topic: "CHU_KY_SO",
                platform: "FACEBOOK",
                status: "SCHEDULED",
                mode: "SEMI_AUTO",
                publishTime: "2026-11-06T09:00:00.000Z",
                mediaCount: 1,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/campaigns-overview")) {
        return new Response(
          JSON.stringify({
            campaigns: [
              {
                campaignId: "CMP-CTV-01",
                name: "Tuyển CTV Kế Toán Dĩ An",
                status: "APPROVED",
                targetCategories: ["ACCOUNTING_TAX"],
              },
            ],
            partners: [
              {
                partnerId: "ctv_01",
                fullName: "Trần Thị Minh",
                phoneMasked: "********78",
                profession: "ACCOUNTANT",
                stage: "ACTIVE_PARTNER",
                totalReferrals: 3,
                approvedPendingCommissionVnd: 450000,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    render(createElement(WorkspaceApp));

    await screen.findByRole("heading", { name: "Dashboard hôm nay" });

    fireEvent.click(screen.getByRole("button", { name: "Tài khoản & Phiên" }));
    expect(await screen.findByText("am_zalo_01")).toBeTruthy();
    expect(screen.getByText("NEEDS_LOGIN")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Quét QR đăng nhập/i }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Lịch nội dung" }));
    expect(await screen.findByText("POST-001")).toBeTruthy();
    expect(screen.getByText("SEMI_AUTO")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chiến dịch & CTV" }));
    expect(await screen.findByText("Tuyển CTV Kế Toán Dĩ An")).toBeTruthy();
    expect(screen.getByText("Trần Thị Minh")).toBeTruthy();
    expect(screen.getByText("********78")).toBeTruthy();
  });

  it("surfaces 500/403 API errors on Phase 2-4 tabs instead of swallowing them and POSTs QR login & post approval actions", async () => {
    const principal = {
      userId: "am-1",
      workspaceId: "workspace-1",
      role: "AM" as const,
      teamId: "team-1",
    };

    let failSocialAccountsOnce = true;
    const postCalls: Array<{ url: string; method: string }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        postCalls.push({ url, method });
      }

      if (url.endsWith("/auth/me")) {
        return new Response(JSON.stringify({ user: principal }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/social-accounts") && method === "GET") {
        if (failSocialAccountsOnce) {
          failSocialAccountsOnce = false;
          return new Response(JSON.stringify({ error: "BACKEND_UNAVAILABLE" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                accountId: "am_zalo_01",
                platform: "ZALO",
                status: "NEEDS_LOGIN",
                profileDir: "storage/browser_profiles/am_zalo_01",
                circuitState: "CLOSED",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/social-accounts/am_zalo_01/qr-login") && method === "POST") {
        return new Response(
          JSON.stringify({ accountId: "am_zalo_01", status: "QR_SESSION_REQUESTED" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/publishing-calendar") && method === "GET") {
        return new Response(
          JSON.stringify({
            items: [
              {
                contentId: "POST-DRAFT-99",
                topic: "CHU_KY_SO",
                platform: "FACEBOOK",
                status: "DRAFT",
                mode: "SEMI_AUTO",
                publishTime: "2026-11-06T09:00:00.000Z",
                mediaCount: 1,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/publishing-calendar/POST-DRAFT-99/approve") && method === "POST") {
        return new Response(
          JSON.stringify({ contentId: "POST-DRAFT-99", status: "APPROVED" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    render(createElement(WorkspaceApp));
    await screen.findByRole("heading", { name: "Dashboard hôm nay" });

    // First click hits 500 -> must surface error alert instead of swallowing!
    fireEvent.click(screen.getByRole("button", { name: "Tài khoản & Phiên" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "BACKEND_UNAVAILABLE",
    );

    // Refresh loads accounts -> click QR login button -> must POST to backend!
    fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
    expect(await screen.findByText("am_zalo_01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Quét QR đăng nhập/i }));

    // Calendar tab -> click Duyệt bài -> must POST to backend!
    fireEvent.click(screen.getByRole("button", { name: "Lịch nội dung" }));
    expect(await screen.findByText("POST-DRAFT-99")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt bài" }));

    await vi.waitFor(() => {
      expect(
        postCalls.some((c) =>
          c.url.endsWith("/social-accounts/am_zalo_01/qr-login"),
        ),
      ).toBe(true);
      expect(
        postCalls.some((c) =>
          c.url.endsWith("/publishing-calendar/POST-DRAFT-99/approve"),
        ),
      ).toBe(true);
    });
  });
});
