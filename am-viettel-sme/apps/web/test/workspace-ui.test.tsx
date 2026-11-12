// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApp } from "../src/ui/workspace-app.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("private workspace entry UI", () => {
  it("shows invite-only login and no public account-creation option", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<WorkspaceApp />);
    expect(
      await screen.findByRole("heading", { name: "Đăng nhập workspace" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Workspace ID")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Mật khẩu")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /đăng ký|tạo tài khoản/i }),
    ).toBeNull();
    expect(screen.getByText(/Không có đăng ký công khai/)).toBeTruthy();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("acceptance UI stays separate from login and requires invite token context", async () => {
    render(<WorkspaceApp initialView="invite" />);
    expect(
      screen.getByRole("heading", { name: "Hoàn tất tài khoản" }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/Tên hiển thị/)).toBeTruthy();
    expect(screen.getByLabelText("Mật khẩu (ít nhất 12 ký tự)")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Đăng ký" })).toBeNull(),
    );
  });

  it("shows due-today tasks from the scoped API on the P0 dashboard", async () => {
    const principal = {
      userId: "am-1",
      workspaceId: "workspace-1",
      role: "AM",
      teamId: "team-1",
    };
    const task = {
      id: "task-1",
      type: "REVIEW_LEAD",
      outcomeGoal: "Rà soát lead synthetic",
      dueAt: new Date().toISOString(),
      estimatedMinutes: 30,
      approvalStatus: "NOT_REQUIRED",
      leadId: "lead-1",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/auth/me")
        ? { user: principal }
        : url.includes("/tasks?status=OPEN")
          ? [task]
          : [];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkspaceApp />);
    expect(
      await screen.findByRole("heading", { name: "Dashboard hôm nay" }),
    ).toBeTruthy();
    expect(await screen.findByText("Rà soát lead synthetic")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks?status=OPEN",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});

it("shows Review after a successful preview validation response", async () => {
  const principal = {
    userId: "am-1",
    workspaceId: "workspace-1",
    role: "AM",
    teamId: "team-1",
  };
  const handle = {
    handle: "handle-1",
    status: "UPLOADED",
    expiresAt: "2026-11-03T12:00:00.000Z",
    headers: [{ index: 0, name: "company_name" }],
    suggestedMapping: [{ sourceColumnIndex: 0, targetField: "company_name" }],
    headerInspection: {
      status: "READY",
      columnMap: [{ sourceColumnIndex: 0, targetField: "company_name" }],
      quarantinedColumns: [],
      warnings: [],
    },
  };
  const preview = {
    previewId: "preview-1",
    headerInspection: handle.headerInspection,
    rows: [
      {
        rowNumber: 2,
        status: "READY",
        companyName: "Synthetic Company",
        stage: "PENDING_REVIEW",
        contact: { phoneMasked: null, emailMasked: null },
        issues: [],
        provenanceReviewReasons: [],
        suppressionIntent: null,
        duplicateReview: null,
      },
    ],
    totalRows: 1,
    commitEligible: false,
    decisionStatus: "AWAITING_AM_REVIEW",
  };
  const validatedHandle = { ...handle, status: "VALIDATED", preview };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.endsWith("/auth/me")
      ? { user: principal }
      : url.includes("/import-jobs/") && url.endsWith("/validate")
        ? validatedHandle
        : url.includes("/import-jobs")
          ? handle
          : [];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "synthetic-uuid-1" });
  render(<WorkspaceApp />);

  await screen.findByRole("heading", { name: "Dashboard hôm nay" });
  fireEvent.click(screen.getByRole("button", { name: "Import Excel" }));
  const file = new File(["synthetic workbook"], "synthetic.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const input = screen.getByLabelText(/Workbook \(.xlsx\)/);
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await screen.findByRole("heading", { name: "Mapping allow-list" });
  const previewButton = screen.getByRole("button", { name: "Tạo preview" });
  fireEvent.click(previewButton);
  fireEvent.click(previewButton);

  expect(
    await screen.findByRole("heading", { name: "Review 1 dòng" }),
  ).toBeTruthy();
  expect(await screen.findByText("Synthetic Company")).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/validate")),
  ).toHaveLength(1);
});

it("preserves tab data and avoids layout shift when switching tabs", async () => {
  const principal = {
    userId: "am-1",
    workspaceId: "workspace-1",
    role: "AM",
    teamId: "team-1",
  };
  const task = {
    id: "task-1",
    type: "REVIEW_LEAD",
    outcomeGoal: "Rà soát lead synthetic",
    dueAt: new Date().toISOString(),
    estimatedMinutes: 30,
    approvalStatus: "NOT_REQUIRED",
    leadId: "lead-1",
  };
  const leads = {
    items: [
      {
        id: "lead-1",
        companyName: "Công ty ABC",
        stage: "PENDING_REVIEW",
      },
    ],
  };

  let openTasksCallCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ user: principal }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/tasks?status=OPEN")) {
      openTasksCallCount++;
      return new Response(JSON.stringify([task]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/leads")) {
      return new Response(JSON.stringify(leads), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceApp />);

  // 1. Initial load on "Dashboard hôm nay"
  expect(await screen.findByRole("heading", { name: "Dashboard hôm nay" })).toBeTruthy();
  expect(await screen.findByText("Rà soát lead synthetic")).toBeTruthy();
  expect(openTasksCallCount).toBe(1);

  // 2. Switch to "Lead"
  fireEvent.click(screen.getByRole("button", { name: "Lead" }));
  expect(await screen.findByText("Công ty ABC")).toBeTruthy();

  // 3. Switch back to "Dashboard hôm nay"
  fireEvent.click(screen.getByRole("button", { name: "Dashboard hôm nay" }));

  // Crucial check: Tab switch is instant and preserved; does NOT show empty loading message
  expect(screen.queryByText("Đang tải tác vụ trong phạm vi được cấp.")).toBeNull();
  expect(screen.getByText("Rà soát lead synthetic")).toBeTruthy();

  // Crucial check: SWR cache avoids redundant re-fetch within TTL
  expect(openTasksCallCount).toBe(1);
});

it("renders 'Kiểm tra UI/UX' button in workspace header and opens the UIHealthInspector modal", async () => {
  const principal = {
    userId: "user-am",
    email: "am@viettel.vn",
    role: "AM",
    workspaceId: "ws-dian",
    permissions: ["*"],
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ user: principal }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceApp />);

  const inspectorBtn = await screen.findByRole("button", { name: /Kiểm tra UI\/UX/i });
  expect(inspectorBtn).toBeTruthy();

  // Click to open modal
  fireEvent.click(inspectorBtn);
  expect(await screen.findByText("Chẩn đoán Sức khỏe UI & UX Hệ thống")).toBeTruthy();
});

it("renders AI Lead Scoring Tier badge in Lead list and 100-point rubric breakdown in Lead detail", async () => {
  const principal = {
    userId: "user-am",
    email: "am@viettel.vn",
    role: "AM",
    workspaceId: "ws-dian",
    permissions: ["*"],
  };
  const mockLead = {
    id: "lead-test-01",
    companyName: "Công ty Vận Tải & Logistics Sóng Thần",
    stage: "NEW",
    district: "Dĩ An",
    contacts: [{ id: "c1", contactName: "Bác Hùng", phone: "0912••••78", email: null, contactabilityStatus: "ELIGIBLE" }],
    leadScore: {
      totalScore: 85,
      tier: "A",
      recommendedProducts: ["vTracking", "CA", "S-Invoice"],
      tierExplanation: "Ưu tiên cao - Phù hợp chuyển đổi nhanh dịch vụ số Viettel.",
      industryScore: 20,
      establishmentScore: 15,
      scaleScore: 10,
      productDemandScore: 25,
      contactInfoScore: 10,
      businessSignalScore: 5,
    },
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ user: principal }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/leads?limit=")) {
      return new Response(JSON.stringify({ items: [mockLead], total: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/leads/lead-test-01")) {
      return new Response(JSON.stringify(mockLead), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  render(<WorkspaceApp />);

  // Switch to Lead tab
  const leadTabBtn = await screen.findByRole("button", { name: "Lead" });
  fireEvent.click(leadTabBtn);

  // 1. Assert Tier A badge in LeadList
  expect(await screen.findByText(/Tier A · 85đ/i)).toBeTruthy();

  // 2. Click lead row to view detail
  fireEvent.click(screen.getByText("Công ty Vận Tải & Logistics Sóng Thần"));

  // 3. Assert AI Lead Scoring breakdown in LeadDetail
  expect(await screen.findByText(/AI Lead Scoring \(Thang điểm 100\)/i)).toBeTruthy();
  expect(screen.getByText(/Ngành nghề phù hợp/i)).toBeTruthy();
  expect(screen.getByText(/Thời gian thành lập/i)).toBeTruthy();
  expect(screen.getByText(/Nhu cầu SP dự kiến/i)).toBeTruthy();
});

it("supports filtering and searching leads in LeadList", async () => {
  const principal = { userId: "am-1", workspaceId: "workspace-1", role: "AM" };
  const mockLeads = [
    {
      id: "lead-1",
      companyName: "Tân Bình Logistics",
      stage: "NEW",
      district: "Dĩ An",
      leadScore: { totalScore: 90, tier: "A" },
    },
    {
      id: "lead-2",
      companyName: "May Mặc Sóng Thần",
      stage: "NEW",
      district: "Thuận An",
      leadScore: { totalScore: 65, tier: "B" },
    },
  ];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: principal }));
      if (url.includes("/leads?limit=")) return new Response(JSON.stringify({ items: mockLeads, total: 2 }));
      return new Response(JSON.stringify([]));
    }),
  );

  render(<WorkspaceApp />);
  const leadTabBtn = await screen.findByRole("button", { name: "Lead" });
  fireEvent.click(leadTabBtn);

  expect(await screen.findByText("Tân Bình Logistics")).toBeTruthy();
  expect(screen.getByText("May Mặc Sóng Thần")).toBeTruthy();

  // Test search input
  const searchInput = screen.getByPlaceholderText(/Tìm theo tên doanh nghiệp/i);
  fireEvent.change(searchInput, { target: { value: "May Mặc" } });
  expect(screen.queryByText("Tân Bình Logistics")).toBeNull();
  expect(screen.getByText("May Mặc Sóng Thần")).toBeTruthy();

  // Reset search and test Tier filter
  fireEvent.change(searchInput, { target: { value: "" } });
  const tierSelect = screen.getByLabelText(/Lọc theo Tier/i);
  fireEvent.change(tierSelect, { target: { value: "A" } });
  expect(screen.getByText("Tân Bình Logistics")).toBeTruthy();
  expect(screen.queryByText("May Mặc Sóng Thần")).toBeNull();
});

it("renders Top KPI Overview row on TodayDashboard", async () => {
  const principal = { userId: "am-1", workspaceId: "workspace-1", role: "AM" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: principal }));
      if (url.includes("/tasks?status=")) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify([]));
    }),
  );

  render(<WorkspaceApp />);
  expect(await screen.findByText(/Tổng quan hoạt động hôm nay/i)).toBeTruthy();
  expect(screen.getByText(/Tác vụ cần làm/i)).toBeTruthy();
  expect(screen.getByText(/Phễu SME & Lead/i)).toBeTruthy();
  expect(screen.getByText(/Tự động hoá MXH/i)).toBeTruthy();
});




