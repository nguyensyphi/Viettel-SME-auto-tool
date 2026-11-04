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
