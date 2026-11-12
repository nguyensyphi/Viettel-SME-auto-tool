import { randomUUID } from "node:crypto";
import { renderZaloOutreachMessage } from "@am-sme/domain";

export type ZaloOutreachAction =
  | "SEARCH_ONLY"
  | "ADD_FRIEND"
  | "SEND_MESSAGE"
  | "ADD_FRIEND_AND_SEND_MESSAGE";

export type OutreachTaskStatus =
  | "PENDING"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "FRIEND_REQUEST_SENT"
  | "NOT_FOUND"
  | "FAILED"
  | "SKIPPED";

export interface OutreachLeadInput {
  id: string;
  companyName: string;
  phone: string;
  contactName?: string | undefined;
  industry?: string | undefined;
  province?: string | undefined;
  contactabilityStatus?: string | undefined;
}

export interface OutreachTask {
  id: string;
  batchId: string;
  leadId: string;
  companyName: string;
  phone: string;
  friendGreeting: string;
  messageContent: string;
  action: ZaloOutreachAction;
  status: OutreachTaskStatus;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  resultDetails?: string | undefined;
}

export interface OutreachBatch {
  batchId: string;
  batchName: string;
  accountId: string;
  templateCode: string;
  tasks: OutreachTask[];
  createdAt: string;
}

export interface CreateOutreachBatchInput {
  batchName: string;
  leads: readonly OutreachLeadInput[];
  templateCode: string;
  amProfile: { name: string; phone: string };
  accountId: string;
  action: ZaloOutreachAction;
}

export interface BatchSummary {
  batchId: string;
  total: number;
  queued: number;
  sent: number;
  friendRequested: number;
  notFound: number;
  failed: number;
  skipped: number;
}

export type OutreachRunnerFn = (input: {
  phone: string;
  friendGreeting?: string | undefined;
  messageContent?: string | undefined;
  action: ZaloOutreachAction;
}) => Promise<{
  status:
    | "SUCCESS"
    | "ZALO_ACCOUNT_NOT_FOUND"
    | "NEEDS_LOGIN"
    | "FRIEND_REQUEST_SENT"
    | "MESSAGE_SENT"
    | "FAILED";
  phone: string;
  details?: string | undefined;
}>;

export class ZaloOutreachService {
  private readonly batches = new Map<string, OutreachBatch>();
  private readonly tasks = new Map<string, OutreachTask>();
  private readonly leadStatuses = new Map<string, string>();

  createOutreachBatch(input: CreateOutreachBatchInput): OutreachBatch {
    const batchId = `batch-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const batchTasks: OutreachTask[] = [];

    for (const lead of input.leads) {
      if (lead.contactabilityStatus) {
        this.leadStatuses.set(lead.id, lead.contactabilityStatus);
      }

      const rendered = renderZaloOutreachMessage({
        templateCode: input.templateCode,
        variables: {
          companyName: lead.companyName,
          representativeName: lead.contactName,
          amName: input.amProfile.name,
          amPhone: input.amProfile.phone,
          province: lead.province,
        },
      });

      const greeting = lead.contactName
        ? `Chào ${lead.contactName}, em là ${input.amProfile.name} từ Viettel muốn kết nối hỗ trợ doanh nghiệp.`
        : `Em chào anh/chị, em là ${input.amProfile.name} từ Viettel muốn kết nối hỗ trợ doanh nghiệp.`;

      const taskId = `task-${randomUUID().slice(0, 8)}`;
      const task: OutreachTask = {
        id: taskId,
        batchId,
        leadId: lead.id,
        companyName: lead.companyName,
        phone: lead.phone,
        friendGreeting: greeting,
        messageContent: rendered.content,
        action: input.action,
        status: "QUEUED",
        accountId: input.accountId,
        createdAt: now,
        updatedAt: now,
      };

      this.tasks.set(taskId, task);
      batchTasks.push(task);
    }

    const batch: OutreachBatch = {
      batchId,
      batchName: input.batchName,
      accountId: input.accountId,
      templateCode: input.templateCode,
      tasks: batchTasks,
      createdAt: now,
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  getBatch(batchId: string): OutreachBatch | undefined {
    return this.batches.get(batchId);
  }

  getBatchSummary(batchId: string): BatchSummary {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return {
        batchId,
        total: 0,
        queued: 0,
        sent: 0,
        friendRequested: 0,
        notFound: 0,
        failed: 0,
        skipped: 0,
      };
    }

    let queued = 0;
    let sent = 0;
    let friendRequested = 0;
    let notFound = 0;
    let failed = 0;
    let skipped = 0;

    for (const task of batch.tasks) {
      if (task.status === "QUEUED" || task.status === "PENDING") queued++;
      else if (task.status === "SENT") sent++;
      else if (task.status === "FRIEND_REQUEST_SENT") friendRequested++;
      else if (task.status === "NOT_FOUND") notFound++;
      else if (task.status === "FAILED") failed++;
      else if (task.status === "SKIPPED") skipped++;
    }

    return {
      batchId,
      total: batch.tasks.length,
      queued,
      sent,
      friendRequested,
      notFound,
      failed,
      skipped,
    };
  }

  async executeTask(
    taskId: string,
    runner: OutreachRunnerFn,
  ): Promise<{ status: OutreachTaskStatus; reason?: string | undefined }> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { status: "FAILED", reason: "TASK_NOT_FOUND" };
    }

    // Fail-closed contactability check
    const contactability = this.leadStatuses.get(task.leadId);
    if (contactability === "OPTED_OUT" || contactability === "SUPPRESSED") {
      task.status = "SKIPPED";
      task.resultDetails = "Khách hàng nằm trong danh sách từ chối tiếp cận (OPTED_OUT)";
      task.updatedAt = new Date().toISOString();
      return { status: "SKIPPED", reason: "OPTED_OUT" };
    }

    task.status = "PROCESSING";
    task.updatedAt = new Date().toISOString();

    try {
      const result = await runner({
        phone: task.phone,
        friendGreeting: task.friendGreeting,
        messageContent: task.messageContent,
        action: task.action,
      });

      task.updatedAt = new Date().toISOString();
      task.resultDetails = result.details;

      if (result.status === "MESSAGE_SENT" || result.status === "SUCCESS") {
        task.status = "SENT";
        return { status: "SENT" };
      }
      if (result.status === "FRIEND_REQUEST_SENT") {
        task.status = "FRIEND_REQUEST_SENT";
        return { status: "FRIEND_REQUEST_SENT" };
      }
      if (result.status === "ZALO_ACCOUNT_NOT_FOUND") {
        task.status = "NOT_FOUND";
        return { status: "NOT_FOUND", reason: "ACCOUNT_NOT_FOUND" };
      }

      task.status = "FAILED";
      return { status: "FAILED", reason: result.status };
    } catch (err) {
      task.status = "FAILED";
      task.resultDetails = (err as Error).message;
      task.updatedAt = new Date().toISOString();
      return { status: "FAILED", reason: (err as Error).message };
    }
  }

  async executeNextQueuedTask(
    batchId: string,
    runner: OutreachRunnerFn,
  ): Promise<{ task: OutreachTask; status: OutreachTaskStatus } | null> {
    const batch = this.batches.get(batchId);
    if (!batch) return null;

    const nextTask = batch.tasks.find((t) => t.status === "QUEUED");
    if (!nextTask) return null;

    const result = await this.executeTask(nextTask.id, runner);
    return { task: nextTask, status: result.status };
  }
}

