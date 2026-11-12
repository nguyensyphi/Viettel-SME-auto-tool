import fs from "node:fs";
import path from "node:path";
import type {
  AccountCircuitBreaker,
  KillSwitchController,
  RateLimiter,
} from "@am-sme/config";
import type { SessionExpiredAlert } from "./health-monitor.js";
import {
  isPageAuthenticated,
  PLATFORM_ENTRY_URL,
  type AccountSessionStore,
} from "./login-flow.js";
import type { BrowserProfileManager } from "./profile-manager.js";
import { publishToFacebook } from "./publishers/facebook-publisher.js";
import {
  publishToFacebookGroup,
  type FacebookGroupPublishResult,
} from "./publishers/facebook-group-publisher.js";
import { publishToZalo } from "./publishers/zalo-publisher.js";
import type { SocialPlatform } from "./types.js";

export type PublishingExecutionMode =
  | "FULL_AUTO"
  | "SEMI_AUTO"
  | "AUTO_PUBLISH"
  | "ASSISTED_PUBLISH"
  | "PREPARE_ONLY";

export interface PublishingStepEvent {
  readonly jobId: string;
  readonly stepName:
    | "CHECK_SESSION"
    | "PREPARE_COMPOSER"
    | "SUBMIT_POST"
    | "CAPTURE_EVIDENCE";
  readonly status: "SUCCESS" | "FAILED";
  readonly details?: string | undefined;
}

export type PublishingStatus =
  | "PUBLISHED"
  | "PENDING_APPROVAL"
  | "AWAITING_AM_CONFIRMATION"
  | "NEEDS_LOGIN"
  | "HALTED_KILL_SWITCH"
  | "HALTED_CIRCUIT_OPEN"
  | "RATE_LIMITED"
  | "FAILED";

export interface PublishingJob {
  jobId: string;
  accountId: string;
  platform: SocialPlatform;
  contentId: string;
  content: string;
  mediaPaths?: readonly string[] | undefined;
  mode: PublishingExecutionMode;
  amApprovedSubmission?: boolean | undefined;
  keepBrowserOpenForAmReview?: boolean | undefined;
  targetGroupUrl?: string | undefined;
  targetType?: "FEED" | "GROUP" | undefined;
}

export interface PublishingResult {
  status: PublishingStatus;
  jobId: string;
  accountId: string;
  platform: SocialPlatform;
  screenshotPath?: string | undefined;
  publishedUrl?: string | undefined;
  reason?: string | undefined;
  releaseDraftSession?: (() => Promise<void>) | undefined;
  completedAt: string;
}

export interface PublishingWorkerOptions {
  profileManager: BrowserProfileManager;
  sessionStore: AccountSessionStore;
  evidenceDir: string;
  killSwitch?: KillSwitchController | undefined;
  circuitBreaker?: AccountCircuitBreaker | undefined;
  rateLimiter?: RateLimiter | undefined;
  maxPostsPerHourPerAccount?: number | undefined;
  onSessionExpired?: ((alert: SessionExpiredAlert) => Promise<void>) | undefined;
  onStep?: ((step: PublishingStepEvent) => Promise<void>) | undefined;
}

function sanitizeFileSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

export class PublishingWorker {
  private readonly profileManager: BrowserProfileManager;
  private readonly sessionStore: AccountSessionStore;
  private readonly evidenceDir: string;
  private readonly killSwitch?: KillSwitchController | undefined;
  private readonly circuitBreaker?: AccountCircuitBreaker | undefined;
  private readonly rateLimiter?: RateLimiter | undefined;
  private readonly maxPostsPerHourPerAccount: number;
  private readonly onSessionExpired?:
    | ((alert: SessionExpiredAlert) => Promise<void>)
    | undefined;
  private readonly onStep?:
    | ((step: PublishingStepEvent) => Promise<void>)
    | undefined;

  constructor(options: PublishingWorkerOptions) {
    this.profileManager = options.profileManager;
    this.sessionStore = options.sessionStore;
    this.evidenceDir = path.resolve(options.evidenceDir);
    this.killSwitch = options.killSwitch;
    this.circuitBreaker = options.circuitBreaker;
    this.rateLimiter = options.rateLimiter;
    this.maxPostsPerHourPerAccount = options.maxPostsPerHourPerAccount ?? 5;
    this.onSessionExpired = options.onSessionExpired;
    this.onStep = options.onStep;
  }

  async executePublishingJob(job: PublishingJob): Promise<PublishingResult> {
    if (this.killSwitch && (await this.killSwitch.isKillSwitchActive())) {
      return {
        status: "HALTED_KILL_SWITCH",
        jobId: job.jobId,
        accountId: job.accountId,
        platform: job.platform,
        reason: "SYSTEM_KILL_SWITCH_ACTIVE",
        completedAt: new Date().toISOString(),
      };
    }

    if (this.circuitBreaker) {
      const circuitCheck = await this.circuitBreaker.canExecute(job.accountId);
      if (!circuitCheck.allowed) {
        return {
          status: "HALTED_CIRCUIT_OPEN",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          reason: "ACCOUNT_CIRCUIT_BREAKER_OPEN",
          completedAt: new Date().toISOString(),
        };
      }
    }

    const knownSession = await this.sessionStore.getStatus(
      job.accountId,
      job.platform,
    );
    if (
      knownSession &&
      (knownSession.status === "NEEDS_LOGIN" ||
        knownSession.status === "SUSPENDED")
    ) {
      return {
        status: "NEEDS_LOGIN",
        jobId: job.jobId,
        accountId: job.accountId,
        platform: job.platform,
        reason: knownSession.reason ?? knownSession.status,
        completedAt: new Date().toISOString(),
      };
    }

    if (this.rateLimiter) {
      const rl = await this.rateLimiter.checkRateLimit(
        `publish:${job.platform}:${job.accountId}`,
        this.maxPostsPerHourPerAccount,
        3_600_000,
      );
      if (!rl.allowed) {
        return {
          status: "RATE_LIMITED",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          reason: `RATE_LIMIT_EXCEEDED:${rl.current}/${this.maxPostsPerHourPerAccount}`,
          completedAt: new Date().toISOString(),
        };
      }
    }

    const isAutoMode = job.mode === "FULL_AUTO" || job.mode === "AUTO_PUBLISH";
    const isAssistedOrPrepareMode =
      job.mode === "SEMI_AUTO" ||
      job.mode === "ASSISTED_PUBLISH" ||
      job.mode === "PREPARE_ONLY";

    const shouldSubmit =
      job.mode === "PREPARE_ONLY"
        ? false
        : isAutoMode || job.amApprovedSubmission === true;
    const keepOpenRequested =
      isAssistedOrPrepareMode &&
      !shouldSubmit &&
      job.keepBrowserOpenForAmReview === true;
    const headless = !keepOpenRequested;

    const context = await this.profileManager.launchAccountBrowser(
      job.accountId,
      job.platform,
      { headless },
    );
    let keepOpenForCaller = false;

    try {
      const existingPages = context.pages();
      const page = existingPages[0] ?? (await context.newPage());

      await page.goto(PLATFORM_ENTRY_URL[job.platform], {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const authCheck = await isPageAuthenticated(page, job.platform);
      if (!authCheck.authenticated) {
        const reason = authCheck.reason ?? "SESSION_EXPIRED";
        if (this.onStep) {
          await this.onStep({
            jobId: job.jobId,
            stepName: "CHECK_SESSION",
            status: "FAILED",
            details: reason,
          });
        }
        await this.sessionStore.setStatus(
          job.accountId,
          job.platform,
          "NEEDS_LOGIN",
          reason,
        );
        if (this.onSessionExpired) {
          await this.onSessionExpired({
            accountId: job.accountId,
            platform: job.platform,
            reason,
            detectedAt: new Date().toISOString(),
          });
        }
        return {
          status: "NEEDS_LOGIN",
          jobId: job.jobId,
          accountId: job.accountId,
          platform: job.platform,
          reason,
          completedAt: new Date().toISOString(),
        };
      }

      if (this.onStep) {
        await this.onStep({
          jobId: job.jobId,
          stepName: "CHECK_SESSION",
          status: "SUCCESS",
          details: `Authenticated session on ${job.platform}`,
        });
      }

      let groupResult: FacebookGroupPublishResult | undefined;
      if (job.platform === "FACEBOOK" && job.targetGroupUrl) {
        groupResult = await publishToFacebookGroup({
          page,
          groupUrl: job.targetGroupUrl,
          content: job.content,
          mediaPaths: job.mediaPaths,
          submit: shouldSubmit,
        });
      } else if (job.platform === "FACEBOOK") {
        await publishToFacebook({
          page,
          content: job.content,
          mediaPaths: job.mediaPaths,
          submit: shouldSubmit,
        });
      } else {
        await publishToZalo({
          page,
          content: job.content,
          mediaPaths: job.mediaPaths,
          submit: shouldSubmit,
        });
      }

      if (this.onStep) {
        await this.onStep({
          jobId: job.jobId,
          stepName: "PREPARE_COMPOSER",
          status: "SUCCESS",
          details: `Filled content and ${job.mediaPaths?.length ?? 0} media file(s).`,
        });
        if (shouldSubmit) {
          await this.onStep({
            jobId: job.jobId,
            stepName: "SUBMIT_POST",
            status: "SUCCESS",
            details: `Submitted post on ${job.platform}.`,
          });
        }
      }

      fs.mkdirSync(this.evidenceDir, { recursive: true });
      const stageLabel = shouldSubmit ? "published" : "draft";
      const screenshotPath = path.join(
        this.evidenceDir,
        `${sanitizeFileSegment(job.accountId)}_${sanitizeFileSegment(job.jobId)}_${stageLabel}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });

      if (this.onStep) {
        await this.onStep({
          jobId: job.jobId,
          stepName: "CAPTURE_EVIDENCE",
          status: "SUCCESS",
          details: screenshotPath,
        });
      }

      if (this.circuitBreaker) {
        await this.circuitBreaker.recordSuccess(job.accountId);
      }

      if (keepOpenRequested) {
        keepOpenForCaller = true;
      }

      let finalStatus: PublishingStatus = shouldSubmit
        ? "PUBLISHED"
        : "AWAITING_AM_CONFIRMATION";
      if (groupResult?.status === "PENDING_APPROVAL") {
        finalStatus = "PENDING_APPROVAL";
      }

      return {
        status: finalStatus,
        jobId: job.jobId,
        accountId: job.accountId,
        platform: job.platform,
        screenshotPath,
        ...(groupResult?.postUrl ? { publishedUrl: groupResult.postUrl } : {}),
        ...(groupResult?.details ? { reason: groupResult.details } : {}),
        ...(keepOpenForCaller
          ? { releaseDraftSession: () => context.close() }
          : {}),
        completedAt: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.circuitBreaker) {
        await this.circuitBreaker.recordFailure(job.accountId, msg);
      }
      return {
        status: "FAILED",
        jobId: job.jobId,
        accountId: job.accountId,
        platform: job.platform,
        reason: msg,
        completedAt: new Date().toISOString(),
      };
    } finally {
      if (!keepOpenForCaller) {
        await context.close();
      }
    }
  }
}
