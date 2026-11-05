import {
  CampaignManager,
  GroupManager,
  PartnerCrmService,
} from "@am-sme/campaigns";
import {
  parseStructuredPosts,
  PublishingScheduler,
  type PublishPlatform,
} from "@am-sme/content-library";

export interface SocialAccountRecordDto {
  readonly accountId: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status: "CONNECTED" | "NEEDS_LOGIN" | "SUSPENDED";
  readonly profileDir: string;
  readonly circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  readonly qrLoginRequested?: boolean | undefined;
  readonly updatedByUserId?: string | undefined;
  readonly updatedAt: string;
}

export interface PublishingCalendarRecordDto {
  readonly contentId: string;
  readonly topic: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly status:
    | "DRAFT"
    | "APPROVED"
    | "SCHEDULED"
    | "PUBLISHED"
    | "FAILED"
    | "AWAITING_AM_CONFIRMATION"
    | "NEEDS_LOGIN";
  readonly mode: "FULL_AUTO" | "SEMI_AUTO";
  readonly publishTime: string;
  readonly mediaCount: number;
  readonly approvedBy?: string | undefined;
}

export interface CreateCalendarDraftInput {
  readonly contentId: string;
  readonly topic: string;
  readonly platform: "ZALO" | "FACEBOOK";
  readonly mode: "FULL_AUTO" | "SEMI_AUTO";
  readonly publishTime: string;
  readonly content: string;
}

interface WorkspaceOperationsState {
  readonly accounts: Map<string, SocialAccountRecordDto>;
  readonly scheduler: PublishingScheduler;
  readonly calendarMeta: Map<
    string,
    {
      platform: "ZALO" | "FACEBOOK";
      mode: "FULL_AUTO" | "SEMI_AUTO";
      publishTime: string;
    }
  >;
  readonly groupManager: GroupManager;
  readonly campaignManager: CampaignManager;
  readonly partnerCrm: PartnerCrmService;
}

const SAFE_ACCOUNT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/u;

export class WorkspaceOperationsHub {
  private readonly workspaces = new Map<string, WorkspaceOperationsState>();

  private stateFor(workspaceId: string): WorkspaceOperationsState {
    let existing = this.workspaces.get(workspaceId);
    if (!existing) {
      const groupManager = new GroupManager();
      existing = {
        accounts: new Map(),
        scheduler: new PublishingScheduler(),
        calendarMeta: new Map(),
        groupManager,
        campaignManager: new CampaignManager({ groupManager }),
        partnerCrm: new PartnerCrmService(),
      };
      this.workspaces.set(workspaceId, existing);
    }
    return existing;
  }

  listSocialAccounts(workspaceId: string): readonly SocialAccountRecordDto[] {
    const state = this.stateFor(workspaceId);
    return Array.from(state.accounts.values(), (a) => ({ ...a }));
  }

  requestQrLogin(
    workspaceId: string,
    accountId: string,
    platform: "ZALO" | "FACEBOOK",
    actorUserId: string,
  ): SocialAccountRecordDto {
    const cleanId = accountId.trim();
    if (!SAFE_ACCOUNT_ID_RE.test(cleanId)) {
      throw new Error("INVALID_ACCOUNT_ID");
    }
    const state = this.stateFor(workspaceId);
    const key = `${platform}:${cleanId}`;
    const existing = state.accounts.get(key);
    const record: SocialAccountRecordDto = {
      accountId: cleanId,
      platform,
      status: "NEEDS_LOGIN",
      profileDir: `storage/browser_profiles/${cleanId}`,
      circuitState: existing?.circuitState ?? "CLOSED",
      qrLoginRequested: true,
      updatedByUserId: actorUserId,
      updatedAt: new Date().toISOString(),
    };
    state.accounts.set(key, record);
    return { ...record };
  }

  createCalendarDraft(
    workspaceId: string,
    input: CreateCalendarDraftInput,
  ): PublishingCalendarRecordDto {
    const publishDate = new Date(input.publishTime);
    if (!Number.isFinite(publishDate.getTime())) {
      throw new Error("INVALID_DATE");
    }

    // Run through structured parser to enforce PII & mandatory field validation
    const rawBlock = [
      `CONTENT_ID: ${input.contentId.trim()}`,
      `TOPIC: ${input.topic.trim()}`,
      `PLATFORMS: ${input.platform}`,
      `CONTENT:`,
      input.content.trim(),
    ].join("\n");

    let parsed;
    try {
      parsed = parseStructuredPosts(rawBlock)[0];
    } catch (err) {
      if (err instanceof Error && err.message.includes("PII_DETECTED")) {
        throw new Error("PII_DETECTED");
      }
      throw new Error("INVALID_CALENDAR_POST");
    }
    if (!parsed) {
      throw new Error("INVALID_CALENDAR_POST");
    }

    const state = this.stateFor(workspaceId);
    const managed = state.scheduler.registerDraft(parsed, []);
    const publishIso = publishDate.toISOString();
    state.calendarMeta.set(managed.contentId, {
      platform: input.platform,
      mode: input.mode,
      publishTime: publishIso,
    });

    return {
      contentId: managed.contentId,
      topic: managed.topic,
      platform: input.platform,
      status: managed.lifecycleStatus,
      mode: input.mode,
      publishTime: publishIso,
      mediaCount: managed.matchedMedia.length,
    };
  }

  approveCalendarPost(
    workspaceId: string,
    contentId: string,
    actorUserId: string,
  ): PublishingCalendarRecordDto {
    const state = this.stateFor(workspaceId);
    const meta = state.calendarMeta.get(contentId);
    if (!meta) {
      throw new Error("CALENDAR_POST_NOT_FOUND");
    }
    const approved = state.scheduler.approvePost(contentId, actorUserId);
    return {
      contentId: approved.contentId,
      topic: approved.topic,
      platform: meta.platform as PublishPlatform,
      status: approved.lifecycleStatus,
      mode: meta.mode,
      publishTime: meta.publishTime,
      mediaCount: approved.matchedMedia.length,
      ...(approved.approvedBy ? { approvedBy: approved.approvedBy } : {}),
    };
  }

  listCalendarPosts(workspaceId: string): readonly PublishingCalendarRecordDto[] {
    const state = this.stateFor(workspaceId);
    const items: PublishingCalendarRecordDto[] = [];
    for (const [contentId, meta] of state.calendarMeta.entries()) {
      const post = state.scheduler.getPost(contentId);
      if (!post) continue;
      items.push({
        contentId: post.contentId,
        topic: post.topic,
        platform: meta.platform,
        status: post.lifecycleStatus,
        mode: meta.mode,
        publishTime: meta.publishTime,
        mediaCount: post.matchedMedia.length,
        ...(post.approvedBy ? { approvedBy: post.approvedBy } : {}),
      });
    }
    return items;
  }

  getCampaignsOverview(workspaceId: string): {
    readonly campaigns: readonly {
      readonly campaignId: string;
      readonly name: string;
      readonly status: "DRAFT" | "APPROVED" | "PAUSED" | "COMPLETED";
      readonly targetCategories: readonly string[];
    }[];
    readonly partners: readonly {
      readonly partnerId: string;
      readonly fullName: string;
      readonly phoneMasked: string;
      readonly profession: string;
      readonly stage: "NEW" | "CONTACTED" | "ACTIVE_PARTNER" | "INACTIVE";
      readonly totalReferrals: number;
      readonly approvedPendingCommissionVnd: number;
    }[];
  } {
    const state = this.stateFor(workspaceId);
    const campaigns = state.campaignManager.listCampaigns().map((c) => ({
      campaignId: c.campaignId,
      name: c.name,
      status: c.status,
      targetCategories: [...c.targetCategories],
    }));

    const partners = state.partnerCrm.listPartners().map((p) => {
      const recon = state.partnerCrm.getPartnerReconciliationSummary(p.partnerId);
      return {
        partnerId: p.partnerId,
        fullName: p.fullName,
        phoneMasked: p.phoneMasked,
        profession: p.profession,
        stage: p.stage,
        totalReferrals: recon.totalReferrals,
        approvedPendingCommissionVnd: recon.approvedPendingCommissionVnd,
      };
    });

    return { campaigns, partners };
  }
}

