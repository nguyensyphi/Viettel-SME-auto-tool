// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FacebookAutoPosterView } from "../src/ui/facebook-auto-poster-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FacebookAutoPosterView — Dedicated FB Auto Poster Dashboard", () => {
  const sampleAccounts = [
    { accountId: "fb-viettel-sme", platform: "FACEBOOK" as const, status: "CONNECTED" },
    { accountId: "fb-clone-dian", platform: "FACEBOOK" as const, status: "CONNECTED" },
  ];

  const samplePosts = [
    {
      id: "post-01",
      title: "Ưu đãi Chữ ký số Viettel-CA Cloud",
      content: "Giải pháp ký số từ xa an toàn cho doanh nghiệp SME Dĩ An...",
    },
  ];

  const sampleGroups = [
    {
      groupId: "grp-dian",
      name: "Hội Doanh nghiệp Dĩ An",
      url: "https://www.facebook.com/groups/sme_dian",
      platform: "FACEBOOK" as const,
      postingPermission: "ALLOWED",
      minHoursBetweenPosts: 4,
    },
    {
      groupId: "grp-ketoan",
      name: "Kế toán Thuế Bình Dương",
      url: "https://www.facebook.com/groups/ketoan_bd",
      platform: "FACEBOOK" as const,
      postingPermission: "ALLOWED",
      minHoursBetweenPosts: 4,
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
    {
      jobId: "job-002",
      groupName: "Kế toán Thuế Bình Dương",
      groupUrl: "https://www.facebook.com/groups/ketoan_bd",
      accountId: "fb-viettel-sme",
      content: "Ưu đãi Chữ ký số Viettel-CA Cloud",
      status: "QUEUED" as const,
      dispatchedAt: new Date().toISOString(),
    },
  ];

  it("renders header metrics and accounts correctly", () => {
    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
      }),
    );

    expect(screen.getByText("Auto Poster Facebook")).toBeTruthy();
    expect(screen.getByText("Tổng bài viết mẫu (Master Posts)")).toBeTruthy();
    expect(screen.getByText("Tổng nhóm mục tiêu (Master Groups)")).toBeTruthy();
  });

  it("dispatches a Master Post to selected target groups", async () => {
    const onDispatchPost = vi.fn(async () => {});

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onDispatchPost,
      }),
    );

    // 1. Click "Đăng bài này lên nhóm" on post-01
    const postDispatchBtn = screen.getByRole("button", { name: /Đăng bài này lên nhóm/i });
    fireEvent.click(postDispatchBtn);

    // 2. Select target account & confirm
    const confirmBtn = screen.getByRole("button", { name: /Xác nhận chạy đăng bài/i });
    fireEvent.click(confirmBtn);

    expect(onDispatchPost).toHaveBeenCalledWith({
      accountId: "fb-viettel-sme",
      postId: "post-01",
      groupIds: ["grp-dian", "grp-ketoan"],
      delaySeconds: expect.any(Number),
    });
  });

  it("previews live spin-tax variation and configures cooldown delay in the dispatch modal", async () => {
    const postWithSpintax = [
      {
        id: "post-spintax",
        title: "Khuyến mãi SME",
        content: "{Xin chào|Kính gửi} Quý Doanh nghiệp tại [TÊN_NHÓM]",
      },
    ];

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: postWithSpintax,
        groups: sampleGroups,
        logs: sampleLogs,
      }),
    );

    // Open dispatch modal
    const postDispatchBtn = screen.getByRole("button", { name: /Đăng bài này lên nhóm/i });
    fireEvent.click(postDispatchBtn);

    // Delay selector exists
    const delaySelect = screen.getByLabelText(/Khoảng cách giữa các bài đăng/i);
    expect(delaySelect).toBeTruthy();

    // Spin-tax preview button exists and resolves template
    const previewBtn = screen.getByRole("button", { name: /Xem thử biến thể/i });
    expect(previewBtn).toBeTruthy();
    fireEvent.click(previewBtn);

    const previewContainer = screen.getByTestId("spintax-preview");
    expect(previewContainer.textContent).not.toContain("{");
    expect(previewContainer.textContent).not.toContain("}");
  });

  it("executes a queued job when clicking 'Chạy đăng bài'", async () => {
    const onRunJob = vi.fn(async () => {});

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onRunJob,
      }),
    );

    // Clicking 'Chạy đăng bài' on job-002
    const runBtn = screen.getByRole("button", { name: /Chạy đăng bài/i });
    fireEvent.click(runBtn);

    expect(onRunJob).toHaveBeenCalledWith("job-002");
  });

  it("imports multiple Facebook groups in bulk", async () => {
    const onBulkImportGroups = vi.fn(async () => {});

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onBulkImportGroups,
      }),
    );

    const textarea = screen.getByPlaceholderText(/Dán danh sách URL nhóm Facebook/i);
    fireEvent.change(textarea, {
      target: {
        value: "https://www.facebook.com/groups/g1\nhttps://www.facebook.com/groups/g2",
      },
    });

    const submitBtn = screen.getByRole("button", { name: /Nạp danh sách nhóm/i });
    fireEvent.click(submitBtn);

    expect(onBulkImportGroups).toHaveBeenCalledWith([
      "https://www.facebook.com/groups/g1",
      "https://www.facebook.com/groups/g2",
    ]);
  });

  it("handles sync accounts, launch browser, and add account actions", async () => {
    const onSyncAccounts = vi.fn(async () => {});
    const onLaunchBrowser = vi.fn(async () => {});
    const onAddAccount = vi.fn(async () => {});

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onSyncAccounts,
        onLaunchBrowser,
        onAddAccount,
      }),
    );

    // 1. Sync accounts button
    const syncBtn = screen.getByRole("button", { name: /Đồng bộ nick/i });
    fireEvent.click(syncBtn);
    expect(onSyncAccounts).toHaveBeenCalledTimes(1);

    // 2. Launch browser button
    const launchBtn = screen.getByRole("button", { name: /Mở trình duyệt đăng nhập/i });
    fireEvent.click(launchBtn);
    expect(onLaunchBrowser).toHaveBeenCalledWith("fb-viettel-sme");

    // 3. Add account button & modal
    const addAccBtn = screen.getByRole("button", { name: /Thêm nick mới/i });
    fireEvent.click(addAccBtn);

    const input = screen.getByPlaceholderText(/Nhập tên tài khoản/i);
    fireEvent.change(input, { target: { value: "Acc Chi Hoa" } });

    const submitAddBtn = screen.getByRole("button", { name: /Mở Chrome đăng nhập/i });
    fireEvent.click(submitAddBtn);

    expect(onAddAccount).toHaveBeenCalledWith("Acc Chi Hoa");
  });

  it("displays attached image thumbnails in Master Posts and supports adding images when creating posts", async () => {
    const onCreatePost = vi.fn(async () => {});
    const postsWithImages = [
      {
        id: "post-img-01",
        title: "Bài viết có hình ảnh minh họa",
        content: "Nội dung bài viết về chữ ký số kèm hình ảnh đẹp...",
        mediaPaths: ["https://example.com/cks-banner.png"],
      },
    ];

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: postsWithImages,
        groups: sampleGroups,
        logs: sampleLogs,
        onCreatePost,
      }),
    );

    // 1. Verifies image thumbnail is rendered
    const img = screen.getByRole("img", { name: /Bài viết có hình ảnh minh họa/i });
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://example.com/cks-banner.png");

    // 2. Add new post with image URL / path
    const titleInput = screen.getByPlaceholderText(/Tiêu đề bài viết/i);
    const contentInput = screen.getByPlaceholderText(/Nội dung bài viết/i);
    const mediaInput = screen.getByPlaceholderText(/URL hoặc đường dẫn ảnh/i);

    fireEvent.change(titleInput, { target: { value: "Post Mới Kèm Ảnh" } });
    fireEvent.change(contentInput, { target: { value: "Khuyến mãi hóa đơn điện tử S-Invoice" } });
    fireEvent.change(mediaInput, { target: { value: "https://example.com/sinvoice.png" } });

    const submitBtn = screen.getByRole("button", { name: /Lưu vào kho bài mẫu/i });
    fireEvent.click(submitBtn);

    expect(onCreatePost).toHaveBeenCalledWith({
      title: "Post Mới Kèm Ảnh",
      content: "Khuyến mãi hóa đơn điện tử S-Invoice",
      mediaPaths: ["https://example.com/sinvoice.png"],
    });
  });

  it("allows deleting a target group from Master Groups list with confirmation", async () => {
    const onDeleteGroup = vi.fn(async () => {});
    vi.spyOn(window, "confirm").mockImplementation(() => true);

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onDeleteGroup,
      }),
    );

    // Find delete buttons in group table
    const deleteButtons = screen.getAllByRole("button", { name: /Xoá/i });
    expect(deleteButtons.length).toBeGreaterThan(0);

    // Click delete on first group (grp-dian)
    fireEvent.click(deleteButtons[0]!);

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Hội Doanh nghiệp Dĩ An"),
    );
    expect(onDeleteGroup).toHaveBeenCalledWith("grp-dian");
  });

  it("strictly filters out Zalo accounts and non-Facebook groups and logs from the view", () => {
    const mixedAccounts = [
      { accountId: "zalo-dian-am01", displayName: "Zalo CSKH", platform: "ZALO" as const, status: "CONNECTED" },
      { accountId: "fb-tin-nguyen", displayName: "Tín Nguyễn", platform: "FACEBOOK" as const, status: "CONNECTED" },
    ];

    const mixedGroups = [
      {
        groupId: "grp-zalo-01",
        name: "Hội Kế toán Thuế Bình Dương Zalo",
        url: "https://zalo.me/g/ketoanbinhduong",
        platform: "ZALO" as const,
      },
      {
        groupId: "grp-fb-01",
        name: "Hội Doanh nhân Trẻ TP. Dĩ An",
        url: "https://www.facebook.com/groups/doanhnhandian",
        platform: "FACEBOOK" as const,
      },
    ];

    const mixedLogs = [
      {
        jobId: "log-zalo",
        groupName: "Hội Kế toán Thuế Bình Dương Zalo",
        groupUrl: "https://zalo.me/g/ketoanbinhduong",
        accountId: "fb-viettel-sme",
        content: "Bài Zalo nhầm",
        status: "QUEUED" as const,
        dispatchedAt: new Date().toISOString(),
      },
      {
        jobId: "log-fb",
        groupName: "Hội Doanh nhân Trẻ TP. Dĩ An",
        groupUrl: "https://www.facebook.com/groups/doanhnhandian",
        accountId: "fb-tin-nguyen",
        content: "Bài Facebook chuẩn",
        status: "PUBLISHED" as const,
        dispatchedAt: new Date().toISOString(),
      },
    ];

    render(
      createElement(FacebookAutoPosterView, {
        accounts: mixedAccounts,
        posts: samplePosts,
        groups: mixedGroups,
        logs: mixedLogs,
      }),
    );

    // Zalo account must NOT appear in Facebook dropdown
    expect(screen.queryByText(/zalo-dian-am01/i)).toBeNull();
    // Facebook account MUST appear
    expect(screen.getByText(/Tín Nguyễn/i)).toBeTruthy();

    // Zalo group must NOT appear in Master Groups table
    expect(screen.queryByText("Hội Kế toán Thuế Bình Dương Zalo")).toBeNull();
    // Facebook group MUST appear
    expect(screen.getAllByText("Hội Doanh nhân Trẻ TP. Dĩ An").length).toBeGreaterThan(0);

    // Zalo log must NOT appear in Posting Log
    expect(screen.queryByText("Bài Zalo nhầm")).toBeNull();
    // Facebook log MUST appear
    expect(screen.getByText(/Bài Facebook chuẩn/i)).toBeTruthy();
  });

  it("synchronizes selectedAccountId with loaded Facebook accounts and calls onLaunchBrowser with correct account", async () => {
    const onLaunchBrowser = vi.fn(async () => {});
    const loadedAccounts = [
      { accountId: "fb-tin-nguyen", displayName: "Tín Nguyễn", platform: "FACEBOOK" as const, status: "CONNECTED" },
    ];

    render(
      createElement(FacebookAutoPosterView, {
        accounts: loadedAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onLaunchBrowser,
      }),
    );

    // Click "Mở trình duyệt đăng nhập"
    const launchBtn = screen.getByRole("button", { name: /Mở trình duyệt đăng nhập/i });
    fireEvent.click(launchBtn);

    // Must be called with the actual loaded account "fb-tin-nguyen", NOT the default "fb-viettel-sme"!
    expect(onLaunchBrowser).toHaveBeenCalledWith("fb-tin-nguyen");
  });

  it("prevents submitting empty post and shows client-side validation error", async () => {
    const onCreatePost = vi.fn(async () => {});

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        onCreatePost,
      }),
    );

    const submitBtn = screen.getByRole("button", { name: /Lưu vào kho bài mẫu/i });
    fireEvent.click(submitBtn);

    // onCreatePost must NOT be called
    expect(onCreatePost).not.toHaveBeenCalled();
    // Validation message must be visible
    expect(screen.getByText(/Vui lòng nhập đầy đủ tiêu đề và nội dung bài viết/i)).toBeTruthy();
  });

  it("allows 1-click importing an approved post from Google Docs content library", async () => {
    const onCreatePost = vi.fn(async () => {});
    const libraryPosts = [
      {
        id: "PB001",
        title: "Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?",
        content: "Chữ ký số giúp doanh nghiệp kê khai thuế điện tử...",
        mediaPaths: ["https://example.com/cks-banner.png"],
      },
    ];

    render(
      createElement(FacebookAutoPosterView, {
        accounts: sampleAccounts,
        posts: samplePosts,
        groups: sampleGroups,
        logs: sampleLogs,
        libraryPosts,
        onCreatePost,
      }),
    );

    // Click "📥 Chọn từ Thư viện Google Docs"
    const openLibraryBtn = screen.getByRole("button", { name: /Chọn từ Thư viện Google Docs/i });
    fireEvent.click(openLibraryBtn);

    // Modal opens and shows PB001
    expect(screen.getByText("Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?")).toBeTruthy();

    // Click "Nạp bài này"
    const importPostBtn = screen.getByRole("button", { name: /Nạp bài này/i });
    fireEvent.click(importPostBtn);

    expect(onCreatePost).toHaveBeenCalledWith({
      title: "Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?",
      content: "Chữ ký số giúp doanh nghiệp kê khai thuế điện tử...",
      mediaPaths: ["https://example.com/cks-banner.png"],
    });
  });
});

