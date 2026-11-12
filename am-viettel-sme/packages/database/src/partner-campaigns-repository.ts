import crypto from "node:crypto";

export interface PartnerCampaignsDatabase {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, values?: readonly unknown[]): Promise<void>;
}

export interface CommunityGroupRecord {
  id: string;
  workspaceId: string;
  groupCode: string;
  platform: string;
  name: string;
  url: string;
  category: string;
  postingPermission: string;
  minHoursBetweenPosts: number;
  active: boolean;
  lastPostedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCommunityGroupInput {
  workspaceId: string;
  groupCode: string;
  platform: string;
  name: string;
  url: string;
  category: string;
  postingPermission?: string | undefined;
  minHoursBetweenPosts?: number | undefined;
  active?: boolean | undefined;
}

export interface GroupCampaignDbRecord {
  id: string;
  workspaceId: string;
  campaignCode: string;
  name: string;
  campaignType: string;
  targetCategories: string[];
  contentTemplate: string;
  mediaPaths: string[];
  status: string;
  approvedByAmId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGroupCampaignInput {
  workspaceId: string;
  campaignCode: string;
  name: string;
  campaignType: string;
  targetCategories: readonly string[];
  contentTemplate: string;
  mediaPaths?: readonly string[] | undefined;
}

export interface GroupPostJobDbRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  groupId: string;
  accountCode: string;
  idempotencyKey: string;
  lockKey: string;
  status: string;
  postUrl: string | null;
  screenshotPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueGroupPostJobInput {
  workspaceId: string;
  campaignId: string;
  groupId: string;
  accountCode: string;
  idempotencyKey: string;
  lockKey: string;
}

export interface CompleteGroupPostJobInput {
  jobId: string;
  status: "PUBLISHED" | "FAILED" | "AWAITING_AM_CONFIRMATION";
  postUrl?: string | undefined;
  screenshotPath?: string | undefined;
  errorMessage?: string | undefined;
}

export interface PartnerLeadDbRecord {
  id: string;
  workspaceId: string;
  partnerCode: string;
  fullName: string;
  phoneMasked: string;
  phoneHash: string;
  profession: string;
  stage: string;
  sourceGroupId: string | null;
  notes: string | null;
  updatedByAmId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartnerLeadInput {
  workspaceId: string;
  partnerCode: string;
  fullName: string;
  phoneMasked: string;
  phoneHash: string;
  profession: string;
  sourceGroupId?: string | undefined;
  notes?: string | undefined;
}

export interface PartnerReferralDbRecord {
  id: string;
  workspaceId: string;
  referralCode: string;
  partnerId: string;
  companyName: string;
  normalizedTaxCode: string;
  productCodes: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartnerReferralInput {
  workspaceId: string;
  referralCode: string;
  partnerId: string;
  companyName: string;
  normalizedTaxCode: string;
  productCodes: readonly string[];
}

export interface PartnerConversionDbRecord {
  id: string;
  workspaceId: string;
  conversionCode: string;
  referralId: string;
  partnerId: string;
  contractRevenueVnd: number;
  commissionRatePercent: number;
  commissionAmountVnd: number;
  commissionPolicyConfirmedByAmId: string;
  policyReferenceNote: string | null;
  payoutStatus: string;
  payoutReference: string | null;
  paidByOperatorId: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartnerConversionInput {
  workspaceId: string;
  conversionCode: string;
  referralId: string;
  partnerId: string;
  contractRevenueVnd: number;
  commissionRatePercent: number;
  commissionAmountVnd: number;
  commissionPolicyConfirmedByAmId: string;
  policyReferenceNote?: string | undefined;
}

export interface MarkConversionPaidInput {
  workspaceId: string;
  conversionCode: string;
  payoutReference: string;
  paidByOperatorId: string;
}

export interface PartnerReconciliationDbSummary {
  partnerId: string;
  totalReferrals: number;
  convertedCount: number;
  totalRevenueVnd: number;
  approvedPendingCommissionVnd: number;
  paidCommissionVnd: number;
}

function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return String(val ?? "");
}

function toNullableIsoString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return toIsoString(val);
}

export class PartnerCampaignsRepository {
  constructor(private readonly db: PartnerCampaignsDatabase) {}

  async upsertCommunityGroup(
    input: UpsertCommunityGroupInput,
  ): Promise<CommunityGroupRecord> {
    const id = crypto.randomUUID();
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO "CommunityGroup" (
        "id", "workspaceId", "groupCode", "platform", "name", "url",
        "category", "postingPermission", "minHoursBetweenPosts", "active", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT ("workspaceId", "groupCode") DO UPDATE SET
        "name" = EXCLUDED."name",
        "url" = EXCLUDED."url",
        "category" = EXCLUDED."category",
        "postingPermission" = EXCLUDED."postingPermission",
        "minHoursBetweenPosts" = EXCLUDED."minHoursBetweenPosts",
        "active" = EXCLUDED."active",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.groupCode,
        input.platform,
        input.name,
        input.url,
        input.category,
        input.postingPermission ?? "ALLOWED",
        input.minHoursBetweenPosts ?? 24,
        input.active ?? true,
      ],
    );
    return this.mapGroupRow(rows[0]!);
  }

  async listCommunityGroups(
    workspaceId: string,
    filter?: { category?: string | undefined; platform?: string | undefined },
  ): Promise<CommunityGroupRecord[]> {
    const clauses = [`"workspaceId" = $1`];
    const params: unknown[] = [workspaceId];
    if (filter?.category) {
      params.push(filter.category);
      clauses.push(`"category" = $${params.length}`);
    }
    if (filter?.platform) {
      params.push(filter.platform);
      clauses.push(`"platform" = $${params.length}`);
    }
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM "CommunityGroup" WHERE ${clauses.join(" AND ")} ORDER BY "createdAt" ASC`,
      params,
    );
    return rows.map((r) => this.mapGroupRow(r));
  }

  async createGroupCampaign(
    input: CreateGroupCampaignInput,
  ): Promise<GroupCampaignDbRecord> {
    const id = crypto.randomUUID();
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO "GroupCampaign" (
        "id", "workspaceId", "campaignCode", "name", "campaignType",
        "targetCategories", "contentTemplate", "mediaPaths", "status", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.campaignCode,
        input.name,
        input.campaignType,
        [...input.targetCategories],
        input.contentTemplate,
        input.mediaPaths ? [...input.mediaPaths] : [],
      ],
    );
    return this.mapCampaignRow(rows[0]!);
  }

  async approveGroupCampaign(
    workspaceId: string,
    campaignCode: string,
    approvedByAmId: string,
  ): Promise<GroupCampaignDbRecord> {
    const rows = await this.db.query<Record<string, unknown>>(
      `UPDATE "GroupCampaign"
       SET "status" = 'APPROVED',
           "approvedByAmId" = $3,
           "approvedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $1 AND "campaignCode" = $2
       RETURNING *`,
      [workspaceId, campaignCode, approvedByAmId],
    );
    if (!rows[0]) {
      throw new Error(`CAMPAIGN_NOT_FOUND:${campaignCode}`);
    }
    return this.mapCampaignRow(rows[0]);
  }

  async enqueueGroupPostJob(
    input: EnqueueGroupPostJobInput,
  ): Promise<GroupPostJobDbRecord> {
    const id = crypto.randomUUID();
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO "GroupPostJob" (
        "id", "workspaceId", "campaignId", "groupId", "accountCode",
        "idempotencyKey", "lockKey", "status", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED', CURRENT_TIMESTAMP)
      ON CONFLICT ("workspaceId", "idempotencyKey") DO UPDATE SET
        "updatedAt" = "GroupPostJob"."updatedAt"
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.campaignId,
        input.groupId,
        input.accountCode,
        input.idempotencyKey,
        input.lockKey,
      ],
    );
    return this.mapJobRow(rows[0]!);
  }

  async completeGroupPostJob(
    input: CompleteGroupPostJobInput,
  ): Promise<GroupPostJobDbRecord> {
    const rows = await this.db.query<Record<string, unknown>>(
      `UPDATE "GroupPostJob"
       SET "status" = $2,
           "postUrl" = $3,
           "screenshotPath" = $4,
           "errorMessage" = $5,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1
       RETURNING *`,
      [
        input.jobId,
        input.status,
        input.postUrl ?? null,
        input.screenshotPath ?? null,
        input.errorMessage ?? null,
      ],
    );
    if (!rows[0]) {
      throw new Error(`GROUP_POST_JOB_NOT_FOUND:${input.jobId}`);
    }
    if (input.status === "PUBLISHED") {
      await this.db.execute(
        `UPDATE "CommunityGroup" SET "lastPostedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        [rows[0].groupId],
      );
    }
    return this.mapJobRow(rows[0]);
  }

  async createPartnerLead(
    input: CreatePartnerLeadInput,
  ): Promise<PartnerLeadDbRecord> {
    const id = crypto.randomUUID();
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO "PartnerLead" (
        "id", "workspaceId", "partnerCode", "fullName", "phoneMasked",
        "phoneHash", "profession", "stage", "sourceGroupId", "notes", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'NEW', $8, $9, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.partnerCode,
        input.fullName,
        input.phoneMasked,
        input.phoneHash,
        input.profession,
        input.sourceGroupId ?? null,
        input.notes ?? null,
      ],
    );
    return this.mapPartnerRow(rows[0]!);
  }

  async updatePartnerStage(
    workspaceId: string,
    partnerCode: string,
    stage: string,
    updatedByAmId: string,
  ): Promise<PartnerLeadDbRecord> {
    const rows = await this.db.query<Record<string, unknown>>(
      `UPDATE "PartnerLead"
       SET "stage" = $3,
           "updatedByAmId" = $4,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $1 AND "partnerCode" = $2
       RETURNING *`,
      [workspaceId, partnerCode, stage, updatedByAmId],
    );
    if (!rows[0]) {
      throw new Error(`PARTNER_NOT_FOUND:${partnerCode}`);
    }
    return this.mapPartnerRow(rows[0]);
  }

  async createPartnerReferral(
    input: CreatePartnerReferralInput,
  ): Promise<PartnerReferralDbRecord> {
    const existing = await this.db.query<{ id: string }>(
      `SELECT "id" FROM "PartnerReferral" WHERE "workspaceId" = $1 AND "normalizedTaxCode" = $2`,
      [input.workspaceId, input.normalizedTaxCode],
    );
    if (existing.length > 0) {
      throw new Error(`DUPLICATE_REFERRAL_TAX_CODE:${input.normalizedTaxCode}`);
    }

    const id = crypto.randomUUID();
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO "PartnerReferral" (
        "id", "workspaceId", "referralCode", "partnerId", "companyName",
        "normalizedTaxCode", "productCodes", "status", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'REFERRED', CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.referralCode,
        input.partnerId,
        input.companyName,
        input.normalizedTaxCode,
        [...input.productCodes],
      ],
    );
    return this.mapReferralRow(rows[0]!);
  }

  async createPartnerConversion(
    input: CreatePartnerConversionInput,
  ): Promise<PartnerConversionDbRecord> {
    const id = crypto.randomUUID();
    await this.db.execute(
      `UPDATE "PartnerReferral" SET "status" = 'CONVERTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1 AND "workspaceId" = $2`,
      [input.referralId, input.workspaceId],
    );
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO "PartnerConversion" (
        "id", "workspaceId", "conversionCode", "referralId", "partnerId",
        "contractRevenueVnd", "commissionRatePercent", "commissionAmountVnd",
        "commissionPolicyConfirmedByAmId", "policyReferenceNote", "payoutStatus", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'APPROVED_PENDING_PAYOUT', CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        id,
        input.workspaceId,
        input.conversionCode,
        input.referralId,
        input.partnerId,
        input.contractRevenueVnd,
        input.commissionRatePercent,
        input.commissionAmountVnd,
        input.commissionPolicyConfirmedByAmId,
        input.policyReferenceNote ?? null,
      ],
    );
    return this.mapConversionRow(rows[0]!);
  }

  async markConversionPaid(
    input: MarkConversionPaidInput,
  ): Promise<PartnerConversionDbRecord> {
    const rows = await this.db.query<Record<string, unknown>>(
      `UPDATE "PartnerConversion"
       SET "payoutStatus" = 'PAID',
           "payoutReference" = $3,
           "paidByOperatorId" = $4,
           "paidAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "workspaceId" = $1 AND "conversionCode" = $2
       RETURNING *`,
      [
        input.workspaceId,
        input.conversionCode,
        input.payoutReference,
        input.paidByOperatorId,
      ],
    );
    if (!rows[0]) {
      throw new Error(`CONVERSION_NOT_FOUND:${input.conversionCode}`);
    }
    return this.mapConversionRow(rows[0]);
  }

  async getPartnerReconciliation(
    workspaceId: string,
    partnerId: string,
  ): Promise<PartnerReconciliationDbSummary> {
    const refs = await this.db.query<{ status: string }>(
      `SELECT "status" FROM "PartnerReferral" WHERE "workspaceId" = $1 AND "partnerId" = $2`,
      [workspaceId, partnerId],
    );
    const convs = await this.db.query<{
      contractRevenueVnd: number;
      commissionAmountVnd: number;
      payoutStatus: string;
    }>(
      `SELECT "contractRevenueVnd", "commissionAmountVnd", "payoutStatus"
       FROM "PartnerConversion"
       WHERE "workspaceId" = $1 AND "partnerId" = $2`,
      [workspaceId, partnerId],
    );

    const totalReferrals = refs.length;
    const convertedCount = refs.filter((r) => r.status === "CONVERTED").length;
    let totalRevenueVnd = 0;
    let approvedPendingCommissionVnd = 0;
    let paidCommissionVnd = 0;

    for (const c of convs) {
      totalRevenueVnd += Number(c.contractRevenueVnd);
      if (c.payoutStatus === "PAID") {
        paidCommissionVnd += Number(c.commissionAmountVnd);
      } else {
        approvedPendingCommissionVnd += Number(c.commissionAmountVnd);
      }
    }

    return {
      partnerId,
      totalReferrals,
      convertedCount,
      totalRevenueVnd,
      approvedPendingCommissionVnd,
      paidCommissionVnd,
    };
  }

  private mapGroupRow(row: Record<string, unknown>): CommunityGroupRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      groupCode: String(row.groupCode),
      platform: String(row.platform),
      name: String(row.name),
      url: String(row.url),
      category: String(row.category),
      postingPermission: String(row.postingPermission),
      minHoursBetweenPosts: Number(row.minHoursBetweenPosts),
      active: Boolean(row.active),
      lastPostedAt: toNullableIsoString(row.lastPostedAt),
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  private mapCampaignRow(row: Record<string, unknown>): GroupCampaignDbRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      campaignCode: String(row.campaignCode),
      name: String(row.name),
      campaignType: String(row.campaignType),
      targetCategories: Array.isArray(row.targetCategories)
        ? row.targetCategories.map(String)
        : [],
      contentTemplate: String(row.contentTemplate),
      mediaPaths: Array.isArray(row.mediaPaths)
        ? row.mediaPaths.map(String)
        : [],
      status: String(row.status),
      approvedByAmId: row.approvedByAmId ? String(row.approvedByAmId) : null,
      approvedAt: toNullableIsoString(row.approvedAt),
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  private mapJobRow(row: Record<string, unknown>): GroupPostJobDbRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      campaignId: String(row.campaignId),
      groupId: String(row.groupId),
      accountCode: String(row.accountCode),
      idempotencyKey: String(row.idempotencyKey),
      lockKey: String(row.lockKey),
      status: String(row.status),
      postUrl: row.postUrl ? String(row.postUrl) : null,
      screenshotPath: row.screenshotPath ? String(row.screenshotPath) : null,
      errorMessage: row.errorMessage ? String(row.errorMessage) : null,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  private mapPartnerRow(row: Record<string, unknown>): PartnerLeadDbRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      partnerCode: String(row.partnerCode),
      fullName: String(row.fullName),
      phoneMasked: String(row.phoneMasked),
      phoneHash: String(row.phoneHash),
      profession: String(row.profession),
      stage: String(row.stage),
      sourceGroupId: row.sourceGroupId ? String(row.sourceGroupId) : null,
      notes: row.notes ? String(row.notes) : null,
      updatedByAmId: row.updatedByAmId ? String(row.updatedByAmId) : null,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  private mapReferralRow(
    row: Record<string, unknown>,
  ): PartnerReferralDbRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      referralCode: String(row.referralCode),
      partnerId: String(row.partnerId),
      companyName: String(row.companyName),
      normalizedTaxCode: String(row.normalizedTaxCode),
      productCodes: Array.isArray(row.productCodes)
        ? row.productCodes.map(String)
        : [],
      status: String(row.status),
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  private mapConversionRow(
    row: Record<string, unknown>,
  ): PartnerConversionDbRecord {
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      conversionCode: String(row.conversionCode),
      referralId: String(row.referralId),
      partnerId: String(row.partnerId),
      contractRevenueVnd: Number(row.contractRevenueVnd),
      commissionRatePercent: Number(row.commissionRatePercent),
      commissionAmountVnd: Number(row.commissionAmountVnd),
      commissionPolicyConfirmedByAmId: String(
        row.commissionPolicyConfirmedByAmId,
      ),
      policyReferenceNote: row.policyReferenceNote
        ? String(row.policyReferenceNote)
        : null,
      payoutStatus: String(row.payoutStatus),
      payoutReference: row.payoutReference ? String(row.payoutReference) : null,
      paidByOperatorId: row.paidByOperatorId
        ? String(row.paidByOperatorId)
        : null,
      paidAt: toNullableIsoString(row.paidAt),
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }
}

