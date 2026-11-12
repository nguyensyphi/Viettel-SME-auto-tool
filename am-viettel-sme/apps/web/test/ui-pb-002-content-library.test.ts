// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "../src/ui/calendar-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UI-PB-002 — Web Dashboard Content Library, Google Docs Importer, Media Matching & Publishing Analytics", () => {
  it("renders analytics summary cards, Google Docs content library, imports [POST_START] blocks, matches media, validates posts, and confirms assisted publish jobs", async () => {
    const onImportGoogleDocsText = vi.fn(async () => {});
    const onMatchMedia = vi.fn(async () => {});
    const onValidateContent = vi.fn(async () => {});
    const onConfirmAssistedJob = vi.fn(async () => {});

    const calendarPayload = {
      items: [
        {
          contentId: "POST-001",
          topic: "CHU_KY_SO",
          platform: "ZALO" as const,
          status: "SCHEDULED" as const,
          mode: "SEMI_AUTO" as const,
          publishTime: "2026-11-11T09:00:00.000Z",
          mediaCount: 1,
        },
      ],
      contents: [
        {
          id: "post-uuid-1",
          postCode: "PB001",
          title: "Vì sao DN mới thành lập cần Chữ ký số Viettel-CA Cloud?",
          topicCode: "CHU_KY_SO",
          platforms: ["ZALO", "FACEBOOK"],
          status: "APPROVED",
          version: 2,
        },
      ],
      jobs: [
        {
          id: "job-uuid-1",
          contentId: "post-uuid-1",
          platform: "ZALO",
          publishMode: "ASSISTED_PUBLISH",
          status: "WAITING_CONFIRMATION",
          scheduledAt: "2026-11-11T09:30:00.000Z",
        },
      ],
      analytics: {
        posts: { total: 5, approved: 4, draft: 1, rejected: 0 },
        media: { total: 8, approved: 6, pending: 2 },
        accounts: { total: 2, active: 2, needsAuth: 0 },
        jobs: {
          total: 3,
          queued: 0,
          waitingConfirmation: 1,
          published: 2,
          failed: 0,
        },
      },
    };

    render(
      createElement(CalendarView, {
        data: calendarPayload,
        onImportGoogleDocsText,
        onMatchMedia,
        onValidateContent,
        onConfirmAssistedJob,
      }),
    );

    // 1. Analytics summary cards rendered
    expect(screen.getByText(/Tổng bài viết thư viện/i)).toBeTruthy();
    expect(screen.getByText(/Ảnh Drive đã duyệt/i)).toBeTruthy();

    // 2. Content Library item rendered
    expect(
      screen.getByText(
        "Vì sao DN mới thành lập cần Chữ ký số Viettel-CA Cloud?",
      ),
    ).toBeTruthy();
    expect(screen.getByText("PB001")).toBeTruthy();

    // 3. Match media & Validate buttons trigger callbacks
    fireEvent.click(screen.getByRole("button", { name: /Ghép ảnh tự động/i }));
    await vi.waitFor(() => {
      expect(onMatchMedia).toHaveBeenCalledWith("post-uuid-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra hợp lệ/i }));
    await vi.waitFor(() => {
      expect(onValidateContent).toHaveBeenCalledWith("post-uuid-1");
    });

    // 4. Confirm assisted publish job
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận đã đăng/i }));
    await vi.waitFor(() => {
      expect(onConfirmAssistedJob).toHaveBeenCalledWith("job-uuid-1");
    });

    // 5. Import Google Docs [POST_START] text
    const rawBlock = `[POST_START]\nPOST_ID: PB009\nTITLE: Hợp đồng điện tử vContract\nTOPIC: VCONTRACT\nPLATFORMS: ZALO\nSTATUS: APPROVED\nCONTENT:\nKý số hợp đồng từ xa mọi lúc mọi nơi.\n[POST_END]`;
    fireEvent.change(
      screen.getByPlaceholderText(/\[POST_START\]/i),
      { target: { value: rawBlock } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Nhập từ Google Docs/i }),
    );
    await vi.waitFor(() => {
      expect(onImportGoogleDocsText).toHaveBeenCalledWith(rawBlock);
    });
  });
});

