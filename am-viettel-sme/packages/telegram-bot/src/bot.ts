import type { KillSwitchController } from "@am-sme/config";
import { assertSafeTelegramText, type TelegramTransport } from "./alerts.js";

export interface DashboardSnapshot {
  connectedAccounts: number;
  needsLoginAccounts: number;
  pendingReviewLeads: number;
  activeCampaigns: number;
}

export interface QueueJobsSnapshot {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  dlqCount: number;
}

export interface TelegramUpdateInput {
  operatorId: string;
  chatId: string;
  text: string;
}

export interface TelegramCommandResult {
  authorized: boolean;
  command: string;
  replyText: string;
}

export interface TelegramAdminBotOptions {
  allowedOperatorIds: readonly string[];
  killSwitch: KillSwitchController;
  transport: TelegramTransport;
  getDashboardSnapshot: () => Promise<DashboardSnapshot>;
  getQueueJobsSnapshot: () => Promise<QueueJobsSnapshot>;
}

export class TelegramAdminBot {
  private readonly allowedOperators: ReadonlySet<string>;
  private readonly killSwitch: KillSwitchController;
  private readonly transport: TelegramTransport;
  private readonly getDashboardSnapshot: () => Promise<DashboardSnapshot>;
  private readonly getQueueJobsSnapshot: () => Promise<QueueJobsSnapshot>;

  constructor(options: TelegramAdminBotOptions) {
    this.allowedOperators = new Set(
      options.allowedOperatorIds.map((id) => id.trim()).filter(Boolean),
    );
    this.killSwitch = options.killSwitch;
    this.transport = options.transport;
    this.getDashboardSnapshot = options.getDashboardSnapshot;
    this.getQueueJobsSnapshot = options.getQueueJobsSnapshot;
  }

  async handleUpdate(update: TelegramUpdateInput): Promise<TelegramCommandResult> {
    const operatorId = update.operatorId.trim();
    const rawText = update.text.trim();
    const parts = rawText.split(/\s+/u);
    const command = (parts[0] ?? "").toLowerCase();
    const argsText = parts.slice(1).join(" ").trim();

    if (!operatorId || !this.allowedOperators.has(operatorId)) {
      return {
        authorized: false,
        command,
        replyText: "UNAUTHORIZED_OPERATOR",
      };
    }

    let replyText: string;

    if (command === "/dashboard") {
      const snap = await this.getDashboardSnapshot();
      const ksActive = await this.killSwitch.isKillSwitchActive();
      replyText = [
        "=== AM-SME DASHBOARD ===",
        `Connected Accounts: ${snap.connectedAccounts}`,
        `NEEDS_LOGIN: ${snap.needsLoginAccounts}`,
        `Pending Review Leads: ${snap.pendingReviewLeads}`,
        `Active Campaigns: ${snap.activeCampaigns}`,
        `Kill Switch: ${ksActive ? "ACTIVE (PAUSED)" : "INACTIVE (RUNNING)"}`,
      ].join("\n");
    } else if (command === "/jobs") {
      const jobs = await this.getQueueJobsSnapshot();
      replyText = [
        "=== BULLMQ QUEUE JOBS ===",
        `Waiting: ${jobs.waiting} | Active: ${jobs.active}`,
        `Completed: ${jobs.completed} | Failed: ${jobs.failed}`,
        `DLQ: ${jobs.dlqCount}`,
      ].join("\n");
    } else if (command === "/pause") {
      const reason = argsText || "Paused via Telegram Admin Bot";
      assertSafeTelegramText(reason);
      await this.killSwitch.activateKillSwitch(reason, operatorId);
      replyText = `KILL SWITCH ACTIVATED by ${operatorId}. Reason: ${reason}`;
    } else if (command === "/resume") {
      await this.killSwitch.deactivateKillSwitch(operatorId);
      replyText = `KILL SWITCH DEACTIVATED by ${operatorId}. Workers resumed.`;
    } else {
      replyText = "Commands: /dashboard | /jobs | /pause <reason> | /resume";
    }

    assertSafeTelegramText(replyText);
    await this.transport.sendMessage(update.chatId, replyText);

    return {
      authorized: true,
      command,
      replyText,
    };
  }
}
