import type { KillSwitchController } from "@am-sme/config";
import type {
  PublishingJob,
  PublishingResult,
  PublishingWorker,
} from "./publishing-worker.js";

export interface DesktopJobQueuePort {
  fetchDueJobs(now?: Date): Promise<readonly PublishingJob[]>;
  markJobOutcome(jobId: string, result: PublishingResult): Promise<void>;
}

export interface DesktopNotificationEvent {
  readonly eventType:
    | "SESSION_EXPIRED"
    | "WAITING_CONFIRMATION"
    | "PUBLISHED"
    | "FAILED";
  readonly jobId: string;
  readonly accountId: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly contentId: string;
  readonly reason?: string | undefined;
}

export interface DesktopAgentRunnerOptions {
  readonly worker: Pick<PublishingWorker, "executePublishingJob">;
  readonly queuePort: DesktopJobQueuePort;
  readonly killSwitch?: KillSwitchController | undefined;
  readonly onNotification?:
    | ((event: DesktopNotificationEvent) => Promise<void>)
    | undefined;
}

export interface DesktopRunnerCycleSummary {
  readonly haltedByKillSwitch: boolean;
  readonly processedCount: number;
  readonly publishedCount: number;
  readonly awaitingConfirmationCount: number;
  readonly needsLoginCount: number;
  readonly failedCount: number;
}

export class DesktopAgentRunner {
  private readonly worker: Pick<PublishingWorker, "executePublishingJob">;
  private readonly queuePort: DesktopJobQueuePort;
  private readonly killSwitch?: KillSwitchController | undefined;
  private readonly onNotification?:
    | ((event: DesktopNotificationEvent) => Promise<void>)
    | undefined;

  constructor(options: DesktopAgentRunnerOptions) {
    this.worker = options.worker;
    this.queuePort = options.queuePort;
    this.killSwitch = options.killSwitch;
    this.onNotification = options.onNotification;
  }

  async runCycle(now: Date = new Date()): Promise<DesktopRunnerCycleSummary> {
    if (this.killSwitch && (await this.killSwitch.isKillSwitchActive())) {
      return {
        haltedByKillSwitch: true,
        processedCount: 0,
        publishedCount: 0,
        awaitingConfirmationCount: 0,
        needsLoginCount: 0,
        failedCount: 0,
      };
    }

    const dueJobs = await this.queuePort.fetchDueJobs(now);
    let processedCount = 0;
    let publishedCount = 0;
    let awaitingConfirmationCount = 0;
    let needsLoginCount = 0;
    let failedCount = 0;

    for (const job of dueJobs) {
      if (this.killSwitch && (await this.killSwitch.isKillSwitchActive())) {
        return {
          haltedByKillSwitch: true,
          processedCount,
          publishedCount,
          awaitingConfirmationCount,
          needsLoginCount,
          failedCount,
        };
      }

      const result = await this.worker.executePublishingJob(job);
      processedCount += 1;
      await this.queuePort.markJobOutcome(job.jobId, result);

      if (result.status === "PUBLISHED") {
        publishedCount += 1;
        await this.onNotification?.({
          eventType: "PUBLISHED",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          contentId: job.contentId,
        });
      } else if (result.status === "AWAITING_AM_CONFIRMATION") {
        awaitingConfirmationCount += 1;
        await this.onNotification?.({
          eventType: "WAITING_CONFIRMATION",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          contentId: job.contentId,
        });
      } else if (result.status === "NEEDS_LOGIN") {
        needsLoginCount += 1;
        await this.onNotification?.({
          eventType: "SESSION_EXPIRED",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          contentId: job.contentId,
          reason: result.reason,
        });
      } else if (result.status === "FAILED") {
        failedCount += 1;
        await this.onNotification?.({
          eventType: "FAILED",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          contentId: job.contentId,
          reason: result.reason,
        });
      }
    }

    return {
      haltedByKillSwitch: false,
      processedCount,
      publishedCount,
      awaitingConfirmationCount,
      needsLoginCount,
      failedCount,
    };
  }
}

