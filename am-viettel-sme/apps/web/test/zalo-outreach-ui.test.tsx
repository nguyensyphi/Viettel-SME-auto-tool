// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CampaignView } from "../src/ui/campaign-view.js";

describe("Task 4: Zalo Outreach Campaign UI Component", () => {
  const mockLeads = [
    {
      id: "lead-01",
      companyName: "CÔNG TY TNHH CƠ KHÍ DĨ AN",
      phone: "0912345678",
      contactName: "Anh Dũng",
      industry: "Cơ khí",
    },
    {
      id: "lead-02",
      companyName: "CÔNG TY CP MAY MẶC SÓNG THẦN",
      phone: "0987654321",
      contactName: "Chị Thảo",
      industry: "May mặc",
    },
  ];

  const mockData = {
    campaigns: [],
    partners: [],
    leads: mockLeads,
  };

  it("renders Zalo Outreach section and allows creating a new outreach batch", async () => {
    const handleCreateBatch = vi.fn(async () => {});

    render(
      <CampaignView
        data={mockData}
        onCreateOutreachBatch={handleCreateBatch}
      />,
    );

    // Section title
    expect(
      screen.getByText(/Chiến dịch Tiếp cận Zalo Cá nhân/i),
    ).toBeDefined();

    // Fill outreach batch name
    const batchNameInput = screen.getByPlaceholderText(/ví dụ: Tiếp cận DN mới thành lập/i);
    fireEvent.change(batchNameInput, {
      target: { value: "Đợt tiếp cận DNMTL Tháng 11" },
    });

    // Click submit
    const submitBtn = screen.getByRole("button", {
      name: /Khởi tạo đợt tiếp cận Zalo/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleCreateBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          batchName: "Đợt tiếp cận DNMTL Tháng 11",
          templateCode: "ZALO_DNMTL_INTRO_V1",
        }),
      );
    });
  });

  it("renders active batch controls and allows running next task", async () => {
    const handleRunNext = vi.fn(async () => {});

    const dataWithBatch = {
      ...mockData,
      activeOutreachBatch: {
        batchId: "batch-123",
        batchName: "Tiếp cận DNMTL Tuần 1",
        summary: { total: 2, queued: 1, sent: 1, friendRequested: 0, notFound: 0, skipped: 0 },
        tasks: [
          {
            id: "task-1",
            leadId: "lead-01",
            companyName: "CÔNG TY TNHH CƠ KHÍ DĨ AN",
            phone: "0912345678",
            status: "SENT",
          },
          {
            id: "task-2",
            leadId: "lead-02",
            companyName: "CÔNG TY CP MAY MẶC SÓNG THẦN",
            phone: "0987654321",
            status: "QUEUED",
          },
        ],
      },
    };

    render(
      <CampaignView
        data={dataWithBatch}
        onRunNextOutreachTask={handleRunNext}
      />,
    );

    // Summary displays
    expect(screen.getByText("Tiếp cận DNMTL Tuần 1")).toBeDefined();
    expect(screen.getByText("1 / 2 đã gửi")).toBeDefined();

    // Click run next
    const runNextBtn = screen.getByRole("button", {
      name: /Tiếp cận 1 khách tiếp theo/i,
    });
    fireEvent.click(runNextBtn);

    await waitFor(() => {
      expect(handleRunNext).toHaveBeenCalledWith("batch-123");
    });
  });
});
