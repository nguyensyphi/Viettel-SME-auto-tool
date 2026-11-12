import { describe, it, expect, vi } from "vitest";
import {
  ZaloOutreachService,
  type OutreachTask,
} from "../src/zalo-outreach-service.js";

describe("Task 3: Zalo Outreach Service & Work Queue", () => {
  const amProfile = {
    name: "Lê Văn AM",
    phone: "0976543210",
  };

  const sampleLeads = [
    {
      id: "lead-01",
      companyName: "CÔNG TY TNHH ĐẠI THÀNH",
      contactName: "Anh Thành",
      phone: "0912345678",
      industry: "Xây dựng",
      province: "Bình Dương",
      contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
    },
    {
      id: "lead-02",
      companyName: "CÔNG TY CP MINH ĐỨC",
      contactName: "Chị Hạnh",
      phone: "0987654321",
      industry: "Dịch vụ kế toán",
      province: "TP.HCM",
      contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
    },
    {
      id: "lead-03",
      companyName: "CÔNG TY TNHH VẬN TẢI AN BÌNH",
      contactName: "Anh Bình",
      phone: "0900000000",
      industry: "Logistics",
      province: "Bình Dương",
      contactabilityStatus: "OPTED_OUT", // Must be skipped
    },
  ];

  it("creates an outreach batch and personalizes messages for eligible leads", () => {
    const service = new ZaloOutreachService();
    const batch = service.createOutreachBatch({
      batchName: "Tiếp cận DNMTL Tuần 1",
      leads: sampleLeads,
      templateCode: "ZALO_DNMTL_INTRO_V1",
      amProfile,
      accountId: "acc-zalo-01",
      action: "ADD_FRIEND_AND_SEND_MESSAGE",
    });

    expect(batch.batchId).toBeDefined();
    expect(batch.tasks.length).toBe(3);

    const task1 = batch.tasks.find((t) => t.leadId === "lead-01");
    expect(task1).toBeDefined();
    expect(task1?.status).toBe("QUEUED");
    expect(task1?.messageContent).toContain("Em chào Anh Thành, em là Lê Văn AM từ Viettel.");
    expect(task1?.messageContent).toContain("CÔNG TY TNHH ĐẠI THÀNH mới thành lập");
    expect(task1?.friendGreeting).toContain("Anh Thành");
  });

  it("skips opted-out leads fail-closed during execution", async () => {
    const service = new ZaloOutreachService();
    const batch = service.createOutreachBatch({
      batchName: "Batch Skip Test",
      leads: sampleLeads,
      templateCode: "ZALO_DNMTL_INTRO_V1",
      amProfile,
      accountId: "acc-zalo-01",
      action: "ADD_FRIEND_AND_SEND_MESSAGE",
    });

    const runner = vi.fn(async () => ({
      status: "SUCCESS" as const,
      phone: "",
    }));

    // Task 3 is for lead-03 which is OPTED_OUT
    const task3 = batch.tasks.find((t) => t.leadId === "lead-03")!;
    const result = await service.executeTask(task3.id, runner);

    expect(result.status).toBe("SKIPPED");
    expect(result.reason).toBe("OPTED_OUT");
    expect(runner).not.toHaveBeenCalled();
  });

  it("executes eligible queued tasks sequentially and updates statuses", async () => {
    const service = new ZaloOutreachService();
    const batch = service.createOutreachBatch({
      batchName: "Batch Sequential Test",
      leads: sampleLeads.slice(0, 2),
      templateCode: "ZALO_DNMTL_INTRO_V1",
      amProfile,
      accountId: "acc-zalo-01",
      action: "ADD_FRIEND_AND_SEND_MESSAGE",
    });

    const mockRunner = vi.fn(async (input: { phone: string }) => {
      if (input.phone === "0912345678") {
        return { status: "MESSAGE_SENT" as const, phone: input.phone };
      }
      return { status: "ZALO_ACCOUNT_NOT_FOUND" as const, phone: input.phone };
    });

    // Execute first queued task
    const next1 = await service.executeNextQueuedTask(batch.batchId, mockRunner);
    expect(next1).toBeDefined();
    expect(next1?.task.status).toBe("SENT");
    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "0912345678" }),
    );

    // Execute second queued task
    const next2 = await service.executeNextQueuedTask(batch.batchId, mockRunner);
    expect(next2).toBeDefined();
    expect(next2?.task.status).toBe("NOT_FOUND");
    expect(mockRunner).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "0987654321" }),
    );

    // Batch summary
    const summary = service.getBatchSummary(batch.batchId);
    expect(summary.total).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.notFound).toBe(1);
    expect(summary.queued).toBe(0);
  });
});

