import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PartnerCampaignsRepository,
  type PartnerCampaignsDatabase,
} from "../src/partner-campaigns-repository.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");

class PGliteDb implements PartnerCampaignsDatabase {
  constructor(private readonly database: PGlite) {}

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    const result = await this.database.query<T>(sql, [...values]);
    return result.rows;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
    await this.query(sql, values);
  }
}

describe("Partner & Group Campaigns Repository (MOD-PC-003: PC-P01, PC-P02, PC-P03)", () => {
  let pglite: PGlite;
  let repo: PartnerCampaignsRepository;
  const workspaceId = "88888888-8888-4888-8888-888888888888";

  beforeAll(async () => {
    const migrationFiles = readdirSync(migrationsPath)
      .sort()
      .map((name) => join(migrationsPath, name, "migration.sql"))
      .filter((path) => existsSync(path));

    pglite = new PGlite();
    for (const file of migrationFiles) {
      await pglite.exec(readFileSync(file, "utf8"));
    }
    await pglite.query(
      `INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES
       ($1, 'ws-pc-test', 'Partner Campaign Test Workspace', CURRENT_TIMESTAMP)`,
      [workspaceId],
    );
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(() => {
    repo = new PartnerCampaignsRepository(new PGliteDb(pglite));
  });

  it("persists CommunityGroup, GroupCampaign, and idempotent GroupPostJob records (PC-P01)", async () => {
    const grp = await repo.upsertCommunityGroup({
      workspaceId,
      groupCode: "zalo_grp_ketoan_bd",
      platform: "ZALO",
      name: "Hội Kế toán Thuế Bình Dương",
      url: "https://zalo.me/g/ketoanbd",
      category: "ACCOUNTING_TAX",
      postingPermission: "ALLOWED",
      minHoursBetweenPosts: 24,
      active: true,
    });
    expect(grp.groupCode).toBe("zalo_grp_ketoan_bd");
    expect(grp.category).toBe("ACCOUNTING_TAX");

    const groups = await repo.listCommunityGroups(workspaceId, {
      category: "ACCOUNTING_TAX",
    });
    expect(groups).toHaveLength(1);

    const camp = await repo.createGroupCampaign({
      workspaceId,
      campaignCode: "camp_ctv_q4",
      name: "Tuyển CTV Kế toán - Hóa đơn điện tử S-Invoice Q4",
      campaignType: "PARTNER_RECRUITMENT",
      targetCategories: ["ACCOUNTING_TAX", "BANKING_FINANCE"],
      contentTemplate: "Hợp tác CTV giới thiệu Chữ ký số Viettel-CA & S-Invoice",
      mediaPaths: ["storage/media/banner-ctv.png"],
    });
    expect(camp.status).toBe("DRAFT");

    const approved = await repo.approveGroupCampaign(
      workspaceId,
      "camp_ctv_q4",
      "user-am-01",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByAmId).toBe("user-am-01");

    const job1 = await repo.enqueueGroupPostJob({
      workspaceId,
      campaignId: approved.id,
      groupId: grp.id,
      accountCode: "zalo-dian-am01",
      idempotencyKey: "camp:camp_ctv_q4:grp:zalo_grp_ketoan_bd:2026-11-11",
      lockKey: "account:zalo-dian-am01",
    });
    const job1Dup = await repo.enqueueGroupPostJob({
      workspaceId,
      campaignId: approved.id,
      groupId: grp.id,
      accountCode: "zalo-dian-am01",
      idempotencyKey: "camp:camp_ctv_q4:grp:zalo_grp_ketoan_bd:2026-11-11",
      lockKey: "account:zalo-dian-am01",
    });
    expect(job1Dup.id).toBe(job1.id);

    const completedJob = await repo.completeGroupPostJob({
      jobId: job1.id,
      status: "PUBLISHED",
      postUrl: "https://zalo.me/g/ketoanbd/post/123",
      screenshotPath: "storage/evidence/grp-post-123.png",
    });
    expect(completedJob.status).toBe("PUBLISHED");
    expect(completedJob.postUrl).toBe("https://zalo.me/g/ketoanbd/post/123");
  });

  it("persists PartnerLead, PartnerReferral with unique taxCode per workspace, PartnerConversion & Payout reconciliation (PC-P02 & PC-P03)", async () => {
    const partner = await repo.createPartnerLead({
      workspaceId,
      partnerCode: "ctv_db_01",
      fullName: "Nguyễn Thị Hồng (Kế toán trưởng)",
      phoneMasked: "0912***678",
      phoneHash: "hash_phone_0912345678",
      profession: "ACCOUNTANT",
      notes: "Chuyên dịch vụ thành lập DN Dĩ An",
    });
    expect(partner.stage).toBe("NEW");

    const activePartner = await repo.updatePartnerStage(
      workspaceId,
      "ctv_db_01",
      "ACTIVE_PARTNER",
      "user-am-01",
    );
    expect(activePartner.stage).toBe("ACTIVE_PARTNER");

    const ref = await repo.createPartnerReferral({
      workspaceId,
      referralCode: "ref_db_01",
      partnerId: partner.id,
      companyName: "CÔNG TY TNHH CƠ KHÍ BÌNH DƯƠNG",
      normalizedTaxCode: "3702468135",
      productCodes: ["CA", "SINVOICE"],
    });
    expect(ref.status).toBe("REFERRED");

    // Duplicate normalizedTaxCode in same workspace must fail
    await expect(
      repo.createPartnerReferral({
        workspaceId,
        referralCode: "ref_db_02",
        partnerId: partner.id,
        companyName: "CÔNG TY TNHH CƠ KHÍ BÌNH DƯƠNG",
        normalizedTaxCode: "3702468135",
        productCodes: ["CA"],
      }),
    ).rejects.toThrow(/DUPLICATE_REFERRAL_TAX_CODE/);

    const conv = await repo.createPartnerConversion({
      workspaceId,
      conversionCode: "conv_db_01",
      referralId: ref.id,
      partnerId: partner.id,
      contractRevenueVnd: 4_500_000,
      commissionRatePercent: 10,
      commissionAmountVnd: 450_000,
      commissionPolicyConfirmedByAmId: "user-am-01",
      policyReferenceNote: "Chính sách CTV SME Q4/2026",
    });
    expect(conv.payoutStatus).toBe("APPROVED_PENDING_PAYOUT");

    const reconBefore = await repo.getPartnerReconciliation(
      workspaceId,
      partner.id,
    );
    expect(reconBefore).toEqual({
      partnerId: partner.id,
      totalReferrals: 1,
      convertedCount: 1,
      totalRevenueVnd: 4_500_000,
      approvedPendingCommissionVnd: 450_000,
      paidCommissionVnd: 0,
    });

    const paid = await repo.markConversionPaid({
      workspaceId,
      conversionCode: "conv_db_01",
      payoutReference: "UNC-20261111-888",
      paidByOperatorId: "user-finance-01",
    });
    expect(paid.payoutStatus).toBe("PAID");
    expect(paid.payoutReference).toBe("UNC-20261111-888");

    const reconAfter = await repo.getPartnerReconciliation(
      workspaceId,
      partner.id,
    );
    expect(reconAfter.approvedPendingCommissionVnd).toBe(0);
    expect(reconAfter.paidCommissionVnd).toBe(450_000);
  });
});
