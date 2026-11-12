// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignView } from "../src/ui/campaign-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Facebook Group Auto-Poster UI — Dispatch Modal, Monitor Table & Bulk Import", () => {
  it("opens Dispatch Modal when clicking 'Điều phối đăng nhóm' and submits account & selected groups", async () => {
    const onDispatchCampaign = vi.fn(async () => {});

    const data = {
      campaigns: [
        {
          campaignId: "CAMP-FB-01",
          name: "Chiến dịch Viettel-CA Dĩ An",
          status: "APPROVED",
          targetCategories: ["STARTUP_SME"],
        },
      ],
      groups: [
        {
          groupId: "grp-dian-sme",
          platform: "FACEBOOK",
          name: "Hội Doanh nghiệp Dĩ An",
          url: "https://www.facebook.com/groups/sme_dian",
          category: "STARTUP_SME",
          postingPermission: "ALLOWED",
          minHoursBetweenPosts: 4,
          active: true,
        },
        {
          groupId: "grp-thuanan-sme",
          platform: "FACEBOOK",
          name: "SME Thuận An",
          url: "https://www.facebook.com/groups/sme_thuanan",
          category: "STARTUP_SME",
          postingPermission: "ALLOWED",
          minHoursBetweenPosts: 4,
          active: true,
        },
      ],
      accounts: [
        { accountId: "fb-viettel-sme", platform: "FACEBOOK", status: "CONNECTED" },
        { accountId: "zalo-dian-am01", platform: "ZALO", status: "CONNECTED" },
      ],
    };

    render(
      createElement(CampaignView, {
        data,
        onDispatchCampaign,
      }),
    );

    // 1. Click 'Điều phối đăng nhóm'
    const dispatchBtn = screen.getByRole("button", { name: /Điều phối đăng nhóm/i });
    fireEvent.click(dispatchBtn);

    // 2. Modal should appear with account selection and group checkboxes
    expect(screen.getByText(/Điều phối đăng bài lên nhóm/i)).toBeTruthy();

    // 3. Select account
    const accountSelect = screen.getByLabelText(/Tài khoản đăng bài/i);
    fireEvent.change(accountSelect, { target: { value: "fb-viettel-sme" } });

    // 4. Click confirm button
    const confirmBtn = screen.getByRole("button", { name: /Xác nhận điều phối/i });
    fireEvent.click(confirmBtn);

    expect(onDispatchCampaign).toHaveBeenCalledWith("CAMP-FB-01", {
      accountId: "fb-viettel-sme",
      groupIds: ["grp-dian-sme", "grp-thuanan-sme"],
    });
  });

  it("renders Group Posting Monitor table with live status and clickable post URLs", async () => {
    const onRunGroupJob = vi.fn(async () => {});

    const data = {
      groupJobs: [
        {
          jobId: "job-101",
          campaignId: "CAMP-FB-01",
          groupName: "Hội Kế toán Bình Dương",
          groupUrl: "https://www.facebook.com/groups/ketoan_bd",
          accountId: "fb-viettel-sme",
          status: "PUBLISHED",
          postUrl: "https://www.facebook.com/groups/ketoan_bd/posts/99887766/",
          dispatchedAt: new Date().toISOString(),
        },
        {
          jobId: "job-102",
          campaignId: "CAMP-FB-01",
          groupName: "SME Dĩ An",
          groupUrl: "https://www.facebook.com/groups/sme_dian",
          accountId: "fb-viettel-sme",
          status: "QUEUED",
          dispatchedAt: new Date().toISOString(),
        },
      ],
    };

    render(
      createElement(CampaignView, {
        data,
        onRunGroupJob,
      }),
    );

    expect(screen.getByText(/Theo Dõi & Lịch Sử Đăng Bài Nhóm/i)).toBeTruthy();
    expect(screen.getByText("Hội Kế toán Bình Dương")).toBeTruthy();

    // Check post link
    const postLink = screen.getByRole("link", { name: /Xem bài viết/i });
    expect(postLink.getAttribute("href")).toBe(
      "https://www.facebook.com/groups/ketoan_bd/posts/99887766/",
    );

    // Trigger execution on QUEUED job
    const runBtn = screen.getByRole("button", { name: /Chạy đăng bài/i });
    fireEvent.click(runBtn);
    expect(onRunGroupJob).toHaveBeenCalledWith("job-102");
  });

  it("imports multiple Facebook group URLs in bulk", async () => {
    const onBulkImportGroups = vi.fn(async () => {});

    render(
      createElement(CampaignView, {
        data: {},
        onBulkImportGroups,
      }),
    );

    const textarea = screen.getByPlaceholderText(/Dán danh sách link nhóm Facebook/i);
    fireEvent.change(textarea, {
      target: {
        value:
          "https://www.facebook.com/groups/sme1\nhttps://www.facebook.com/groups/sme2\nhttps://www.facebook.com/groups/sme3",
      },
    });

    const submitBtn = screen.getByRole("button", { name: /Thêm danh sách nhóm/i });
    fireEvent.click(submitBtn);

    expect(onBulkImportGroups).toHaveBeenCalledWith([
      "https://www.facebook.com/groups/sme1",
      "https://www.facebook.com/groups/sme2",
      "https://www.facebook.com/groups/sme3",
    ]);
  });
});
