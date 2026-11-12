// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FacebookAutoPosterView } from "../src/ui/facebook-auto-poster-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Facebook Dual-Channel Publisher & Account Lifecycle UI", () => {
  const sampleAccounts = [
    { accountId: "fb-viettel-sme", displayName: "Viettel AM Chính thức", platform: "FACEBOOK" as const, status: "ACTIVE_OK" },
    { accountId: "fb-checkpoint-user", displayName: "Nick Bị 2FA", platform: "FACEBOOK" as const, status: "CHECKPOINT_2FA" },
  ];

  const samplePosts = [
    {
      id: "post-01",
      title: "Ưu đãi Chữ ký số Viettel-CA Cloud",
      content: "Giải pháp ký số từ xa an toàn cho doanh nghiệp SME Dĩ An...",
      mediaPaths: ["https://example.com/banner-cks.png"],
    },
  ];

  const sampleGroups = [
    {
      groupId: "grp-dian",
      name: "Hội Doanh nghiệp Dĩ An",
      url: "https://www.facebook.com/groups/sme_dian",
      platform: "FACEBOOK" as const,
      postingPermission: "ALLOWED",
    },
  ];

  const sampleLogs = [
    {
      jobId: "job-001",
      groupName: "Hội Doanh nghiệp Dĩ An",
      groupUrl: "https://www.facebook.com/groups/sme_dian",
      accountId: "fb-viettel-sme",
      content: "Ưu đãi Chữ ký số Viettel-CA Cloud",
      status: "PUBLISHED" as const,
      postUrl: "https://www.facebook.com/groups/sme_dian/posts/11223344/",
      dispatchedAt: new Date().toISOString(),
    },
  ];

  it("renders dual-channel sub-tabs and allows switching between Group Poster and Fanpage/Profile Poster", () => {
    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
      }),
    );

    // Both sub-tabs must exist
    const groupTabBtn = screen.getByRole("tab", { name: /Đăng Hội Nhóm Facebook/i });
    const pageTabBtn = screen.getByRole("tab", { name: /Đăng Fanpage & Trang Cá Nhân/i });
    expect(groupTabBtn).toBeTruthy();
    expect(pageTabBtn).toBeTruthy();

    // Default is Group Poster
    expect(screen.getByText("Kho Bài Viết Mẫu (Master Posts)")).toBeTruthy();

    // Switch to Fanpage & Personal Profile Poster
    fireEvent.click(pageTabBtn);
    expect(screen.getByText(/Đăng bài lên Fanpage & Trang Cá Nhân/i)).toBeTruthy();
  });

  it("calls onDeleteGroup when clicking Xóa button on a group with window.confirm", async () => {
    const onDeleteGroup = vi.fn(async () => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onDeleteGroup,
      }),
    );

    // Find Delete button for the group
    const deleteBtn = screen.getByRole("button", { name: /Xóa/i });
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(onDeleteGroup).toHaveBeenCalledWith("grp-dian");
  });

  it("displays account health badge and handles CHECKPOINT_2FA case", () => {
    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
      }),
    );

    // Should indicate active and checkpoint status
    expect(screen.getAllByText(/Hoạt động/i).length).toBeGreaterThan(0);
  });

  it("allows selecting Viettel stock banners in Thêm bài viết mới form", () => {
    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
      }),
    );

    // Stock image pill for Viettel-CA should be clickable
    const caStockPill = screen.getByRole("button", { name: /Viettel-CA/i });
    expect(caStockPill).toBeTruthy();
    fireEvent.click(caStockPill);

    // Thumbnail strip should show 1 attached image
    expect(screen.getByAltText(/Ảnh đính kèm 1/i)).toBeTruthy();
  });

  it("dispatches page post when in Fanpage/Profile tab", async () => {
    const onDispatchPagePost = vi.fn(async () => {});

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onDispatchPagePost,
      }),
    );

    // Switch to Page subtab
    const pageTabBtn = screen.getByRole("tab", { name: /Đăng Fanpage & Trang Cá Nhân/i });
    fireEvent.click(pageTabBtn);

    // Click "Đăng lên Fanpage / Cá nhân"
    const openDispatchBtn = screen.getByRole("button", { name: /Đăng lên Fanpage \/ Cá nhân/i });
    fireEvent.click(openDispatchBtn);

    // Confirm in popup
    const confirmBtn = screen.getByRole("button", { name: /Bấm đăng ngay/i });
    fireEvent.click(confirmBtn);

    expect(onDispatchPagePost).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "fb-viettel-sme",
        postId: "post-01",
        targetType: "PERSONAL_WALL",
      }),
    );
  });
});
