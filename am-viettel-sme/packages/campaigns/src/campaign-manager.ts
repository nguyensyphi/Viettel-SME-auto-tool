import type {
  AccountCircuitBreaker,
  KillSwitchController,
  RateLimiter,
} from "@am-sme/config";
import type {
  GroupCategory,
  GroupManager,
  GroupPlatform,
} from "./group-manager.js";

export type CampaignType = "PARTNER_RECRUITMENT" | "SME_SOLUTION_SHARING";

export type CampaignStatus = "DRAFT" | "APPROVED" | "PAUSED" | "COMPLETED";

export interface CreateCampaignInput {
  campaignId: string;
  name: string;
  campaignType: CampaignType;
  targetCategories: readonly GroupCategory[];
  contentTemplate: string;
  mediaPaths?: readonly string[] | undefined;
}

export interface CampaignRecord {
  campaignId: string;
  name: string;
  campaignType: CampaignType;
  targetCategories: readonly GroupCategory[];
  contentTemplate: string;
  mediaPaths: readonly string[];
  status: CampaignStatus;
  approvedByAmId?: string | undefined;
  approvedAt?: string | undefined;
  createdAt: string;
}

export interface CampaignDispatchJob {
  campaignId: string;
  groupId: string;
  groupUrl: string;
  platform: GroupPlatform;
  accountId: string;
  content: string;
  mediaPaths: readonly string[];
  idempotencyKey: string;
  lockKey: string;
}

export interface SkippedGroupEntry {
  groupId: string;
  reason: string;
}

export interface BuildDispatchJobsInput {
  campaignId: string;
  accountId: string;
  dispatchDate: Date;
}

export interface BuildDispatchJobsResult {
  campaignId: string;
  jobs: CampaignDispatchJob[];
  skippedGroups: SkippedGroupEntry[];
}

export interface CampaignManagerOptions {
  groupManager: GroupManager;
  killSwitch?: KillSwitchController | undefined;
  circuitBreaker?: AccountCircuitBreaker | undefined;
  rateLimiter?: RateLimiter | undefined;
  maxGroupPostsPerDayPerAccount?: number | undefined;
}

const SENSITIVE_PII_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\r]{0,25}\b\d{9,12}\b|\b0\d{11}\b)/iu;

function assertNoSensitivePii(text: string): void {
  if (SENSITIVE_PII_PATTERN.test(text)) {
    throw new Error(
      "PII_DETECTED: Campaign content must never embed CCCD/CMND personal identifiers",
    );
  }
}

export class CampaignManager {
  private readonly campaigns = new Map<string, CampaignRecord>();
  private readonly groupManager: GroupManager;
  private readonly killSwitch?: KillSwitchController | undefined;
  private readonly circuitBreaker?: AccountCircuitBreaker | undefined;
  private readonly rateLimiter?: RateLimiter | undefined;
  private readonly maxGroupPostsPerDayPerAccount: number;

  constructor(options: CampaignManagerOptions) {
    this.groupManager = options.groupManager;
    this.killSwitch = options.killSwitch;
    this.circuitBreaker = options.circuitBreaker;
    this.rateLimiter = options.rateLimiter;
    this.maxGroupPostsPerDayPerAccount =
      options.maxGroupPostsPerDayPerAccount ?? 10;
  }

  createCampaign(input: CreateCampaignInput): CampaignRecord {
    const campaignId = input.campaignId.trim();
    const name = input.name.trim();
    const contentTemplate = input.contentTemplate.trim();

    if (!campaignId || !name || !contentTemplate) {
      throw new Error(
        "INVALID_CAMPAIGN_INPUT: campaignId, name, and contentTemplate are required",
      );
    }
    if (input.targetCategories.length === 0) {
      throw new Error(
        "INVALID_CAMPAIGN_INPUT: at least one target group category is required",
      );
    }

    assertNoSensitivePii(contentTemplate);

    const record: CampaignRecord = {
      campaignId,
      name,
      campaignType: input.campaignType,
      targetCategories: [...input.targetCategories],
      contentTemplate,
      mediaPaths: input.mediaPaths ? [...input.mediaPaths] : [],
      status: "DRAFT",
      createdAt: new Date().toISOString(),
    };

    this.campaigns.set(campaignId, record);
    return { ...record };
  }

  approveCampaign(campaignId: string, approvedByAmId: string): CampaignRecord {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error(`CAMPAIGN_NOT_FOUND:${campaignId}`);
    }
    const reviewer = approvedByAmId.trim();
    if (!reviewer) {
      throw new Error("AM_REVIEWER_REQUIRED");
    }

    const updated: CampaignRecord = {
      ...campaign,
      status: "APPROVED",
      approvedByAmId: reviewer,
      approvedAt: new Date().toISOString(),
    };
    this.campaigns.set(campaignId, updated);
    return { ...updated };
  }

  getCampaign(campaignId: string): CampaignRecord | null {
    const found = this.campaigns.get(campaignId);
    return found ? { ...found } : null;
  }

  listCampaigns(): CampaignRecord[] {
    return Array.from(this.campaigns.values(), (c) => ({ ...c }));
  }

  async buildDispatchJobs(
    input: BuildDispatchJobsInput,
  ): Promise<BuildDispatchJobsResult> {
    if (this.killSwitch && (await this.killSwitch.isKillSwitchActive())) {
      throw new Error("KILL_SWITCH_ACTIVE: System kill switch halted campaign dispatch");
    }

    if (this.circuitBreaker) {
      const check = await this.circuitBreaker.canExecute(input.accountId);
      if (!check.allowed) {
        throw new Error(
          `CIRCUIT_BREAKER_OPEN: Account ${input.accountId} circuit breaker is OPEN`,
        );
      }
    }

    const campaign = this.campaigns.get(input.campaignId);
    if (!campaign) {
      throw new Error(`CAMPAIGN_NOT_FOUND:${input.campaignId}`);
    }
    if (campaign.status !== "APPROVED") {
      throw new Error(
        `CAMPAIGN_NOT_APPROVED: Campaign ${input.campaignId} is in status ${campaign.status}`,
      );
    }

    const candidateGroups = this.groupManager.listGroups({
      categories: campaign.targetCategories,
    });

    const dateBucket = input.dispatchDate.toISOString().slice(0, 10);
    const jobs: CampaignDispatchJob[] = [];
    const skippedGroups: SkippedGroupEntry[] = [];

    for (const group of candidateGroups) {
      const eligibility = this.groupManager.canPostToGroup(
        group.groupId,
        input.dispatchDate,
      );
      if (!eligibility.eligible) {
        skippedGroups.push({
          groupId: group.groupId,
          reason: eligibility.reason ?? "INELIGIBLE",
        });
        continue;
      }

      if (this.rateLimiter) {
        const rl = await this.rateLimiter.checkRateLimit(
          `campaign_group_post:${input.accountId}:${dateBucket}`,
          this.maxGroupPostsPerDayPerAccount,
          86_400_000,
        );
        if (!rl.allowed) {
          skippedGroups.push({
            groupId: group.groupId,
            reason: "ACCOUNT_DAILY_RATE_LIMIT_REACHED",
          });
          continue;
        }
      }

      jobs.push({
        campaignId: campaign.campaignId,
        groupId: group.groupId,
        groupUrl: group.url,
        platform: group.platform,
        accountId: input.accountId,
        content: campaign.contentTemplate,
        mediaPaths: [...campaign.mediaPaths],
        idempotencyKey: `campaign:${campaign.campaignId}:group:${group.groupId}:date:${dateBucket}`,
        lockKey: `account:${input.accountId}`,
      });
    }

    return {
      campaignId: campaign.campaignId,
      jobs,
      skippedGroups,
    };
  }
}

