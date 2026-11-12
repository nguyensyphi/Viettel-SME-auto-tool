// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIHealthInspector } from "../src/ui/ui-health-inspector.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UIHealthInspector (In-App UI/UX Diagnostic & Self-Test Panel)", () => {
  it("renders when open and executes automated UI/UX audit checks", async () => {
    const onClose = vi.fn();
    const mockRunCheck = vi.fn(async () => ({
      timestamp: "2026-11-12T09:00:00Z",
      metrics: { total: 4, passed: 3, warnings: 1, failed: 0 },
      results: [
        {
          id: "chk-api",
          category: "API & Endpoints",
          title: "Kiểm tra kết nối 5 API phân hệ cốt lõi",
          status: "PASS" as const,
          details: "5/5 API phản hồi HTTP 200 OK trong vòng 15ms",
        },
        {
          id: "chk-img",
          category: "Asset Integrity",
          title: "Kiểm tra tính toàn vẹn hình ảnh DOM",
          status: "PASS" as const,
          details: "Tất cả ảnh trên trang có naturalWidth > 0, không có ảnh lỗi 404",
        },
        {
          id: "chk-layout",
          category: "Layout & Viewport",
          title: "Kiểm tra tràn viền ngang (Horizontal Overflow)",
          status: "PASS" as const,
          details: "scrollWidth <= innerWidth, không xuất hiện thanh cuộn ngang",
        },
        {
          id: "chk-quota",
          category: "UX & Quota Guard",
          title: "Kiểm soát an toàn tài khoản & định mức",
          status: "WARN" as const,
          details: "Có 1 tài khoản Facebook chưa đồng bộ cookie đăng nhập",
        },
      ],
    }));

    render(
      createElement(UIHealthInspector, {
        isOpen: true,
        onClose,
        onRunSmokeCheck: mockRunCheck,
      }),
    );

    // 1. Dialog title and close button
    expect(screen.getByText("Chẩn đoán Sức khỏe UI & UX Hệ thống")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Đóng/i }).length).toBeGreaterThanOrEqual(1);

    // 2. Click run checks
    const runBtn = screen.getByRole("button", { name: /Chạy kiểm tra UI\/UX/i });
    fireEvent.click(runBtn);

    // 3. Verify results displayed
    await vi.waitFor(() => {
      expect(mockRunCheck).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/5\/5 API phản hồi HTTP 200/i)).toBeTruthy();
      expect(screen.getByText(/Kiểm tra tính toàn vẹn hình ảnh DOM/i)).toBeTruthy();
      expect(screen.getByText(/Có 1 tài khoản Facebook chưa đồng bộ/i)).toBeTruthy();
    });

    // 4. Close modal
    fireEvent.click(screen.getAllByRole("button", { name: /Đóng/i })[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      createElement(UIHealthInspector, {
        isOpen: false,
        onClose: () => {},
      }),
    );
    expect(container.firstChild).toBeNull();
  });
});
