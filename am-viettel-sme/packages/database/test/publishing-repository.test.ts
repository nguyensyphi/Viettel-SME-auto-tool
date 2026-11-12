import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ContentLibraryRepository,
  type ContentLibraryDatabase,
} from "../src/content-library-repository.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

class PGliteDb implements ContentLibraryDatabase {
  constructor(private readonly database: PGlite) {}

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    const result = await this.database.query<T>(sql, [...values]);
    return result.rows;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
    await this.query(sql, values);
  }
}

describe("Social Accounts, Publishing Campaigns, Schedules & Jobs Repository (PB-P06, PB-P07)", () => {
  let pglite: PGlite;
  let repo: ContentLibraryRepository;
  const workspaceId = "77777777-7777-4777-8777-777777777777";
  let contentId: string;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migrationSql);
    await pglite.query(
      `INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES
       ($1, 'ws-pub-test', 'Publishing Test Workspace', CURRENT_TIMESTAMP)`,
      [workspaceId],
    );

    const tempRepo = new ContentLibraryRepository(new PGliteDb(pglite));
    const post = await tempRepo.upsertPost({
      workspaceId,
      postCode: "PB_PUB_01",
      title: "Chữ ký số Viettel-CA cho Doanh nghiệp SME",
      body: "Nội dung bài đăng Chữ ký số Viettel-CA",
      topicCode: "CHU_KY_SO",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      contentHash: "hash-pub-01",
    });
    contentId = post.id;
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(() => {
    repo = new ContentLibraryRepository(new PGliteDb(pglite));
  });

  it("creates and updates SocialAccount with isolated profileDir, rate limits, and session status transitions", async () => {
    const account = await repo.upsertSocialAccount({
      workspaceId,
      accountCode: "zalo-am-dian-01",
      platform: "ZALO",
      displayName: "Zalo Lê Văn AM - Viettel Dĩ An",
      ownerUserId: "user-am-1",
      assignedTopics: ["CHU_KY_SO", "HOA_DON_DIEN_TU"],
      maxPostsPerDay: 2,
      minIntervalMinutes: 180,
      preferredWindows: ["08:00-10:00", "13:30-15:30"],
      status: "ACTIVE",
    });

    expect(account.id).toBeDefined();
    expect(account.accountCode).toBe("zalo-am-dian-01");
    expect(account.profileDir).toBe("storage/browser_profiles/zalo-am-dian-01");
    expect(account.maxPostsPerDay).toBe(2);
    expect(account.minIntervalMinutes).toBe(180);
    expect(account.status).toBe("ACTIVE");

    // Pause account
    const paused = await repo.updateSocialAccount(workspaceId, account.id, {
      status: "PAUSED",
    });
    expect(paused?.status).toBe("PAUSED");

    // Resume / update session check
    const checkedAt = new Date("2026-11-11T09:00:00.000Z");
    const resumed = await repo.updateSocialAccount(workspaceId, account.id, {
      status: "ACTIVE",
      lastSessionCheckAt: checkedAt,
    });
    expect(resumed?.status).toBe("ACTIVE");
    expect(resumed?.lastSessionCheckAt).toBeDefined();
  });

  it("creates PublishingCampaign and PublishingSchedule", async () => {
    const account = await repo.upsertSocialAccount({
      workspaceId,
      accountCode: "fb-am-dian-01",
      platform: "FACEBOOK",
      displayName: "Facebook Lê Văn AM",
      ownerUserId: "user-am-1",
      status: "ACTIVE",
    });

    const campaign = await repo.createPublishingCampaign({
      workspaceId,
      name: "Chiến dịch Thương hiệu Cá nhân T11/2026",
      topicCodes: ["CHU_KY_SO", "HOA_DON_DIEN_TU"],
      accountIds: [account.id],
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-30T23:59:59.000Z",
      status: "ACTIVE",
    });

    expect(campaign.id).toBeDefined();
    expect(campaign.name).toContain("T11/2026");

    const schedule = await repo.createPublishingSchedule({
      workspaceId,
      campaignId: campaign.id,
      contentId,
      accountId: account.id,
      platform: "FACEBOOK",
      scheduledAt: "2026-11-15T08:30:00.000Z",
      publishMode: "ASSISTED_PUBLISH",
      status: "SCHEDULED",
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.publishMode).toBe("ASSISTED_PUBLISH");

    const listed = await repo.listPublishingSchedules(workspaceId, {
      accountId: account.id,
    });
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed[0]?.id).toBe(schedule.id);
  });

  it("creates PublishingJob with idempotencyKey, tracks PublishingJobStep, and records PublishingResult without rotating accounts on failure (PB-SC-009)", async () => {
    const zaloA = await repo.upsertSocialAccount({
      workspaceId,
      accountCode: "zalo-am-a",
      platform: "ZALO",
      displayName: "Zalo AM A",
      ownerUserId: "user-am-1",
      status: "ACTIVE",
    });
    const zaloB = await repo.upsertSocialAccount({
      workspaceId,
      accountCode: "zalo-am-b",
      platform: "ZALO",
      displayName: "Zalo AM B",
      ownerUserId: "user-am-1",
      status: "ACTIVE",
    });

    const job = await repo.createPublishingJob({
      workspaceId,
      contentId,
      accountId: zaloA.id,
      platform: "ZALO",
      publishMode: "ASSISTED_PUBLISH",
      scheduledAt: "2026-11-16T09:00:00.000Z",
      idempotencyKey: `pub:${contentId}:${zaloA.id}:2026-11-16`,
      status: "QUEUED",
    });

    expect(job.id).toBeDefined();
    expect(job.status).toBe("QUEUED");

    // Append job steps
    const step1 = await repo.appendPublishingJobStep({
      jobId: job.id,
      stepName: "VALIDATE_CONTENT",
      status: "SUCCESS",
      details: "Content and media validated.",
    });
    expect(step1.stepName).toBe("VALIDATE_CONTENT");

    const step2 = await repo.appendPublishingJobStep({
      jobId: job.id,
      stepName: "PREPARE_COMPOSER",
      status: "SUCCESS",
      details: "Filled composer text and image; awaiting AM confirmation.",
    });
    expect(step2.stepName).toBe("PREPARE_COMPOSER");

    // Transition job to WAITING_CONFIRMATION
    const waitingJob = await repo.updatePublishingJobStatus(workspaceId, job.id, {
      status: "WAITING_CONFIRMATION",
    });
    expect(waitingJob?.status).toBe("WAITING_CONFIRMATION");

    // Confirm assisted publish and record result
    const publishedJob = await repo.updatePublishingJobStatus(workspaceId, job.id, {
      status: "PUBLISHED",
    });
    expect(publishedJob?.status).toBe("PUBLISHED");

    const result = await repo.recordPublishingResult({
      jobId: job.id,
      workspaceId,
      contentId,
      accountId: zaloA.id,
      platform: "ZALO",
      status: "PUBLISHED",
      publishedUrl: "https://zalo.me/post/demo-123",
      screenshotPath: "storage/evidence/job-123.png",
      confirmedBy: "user-am-1",
    });
    expect(result.status).toBe("PUBLISHED");

    // PB-SC-009: If a job fails on zaloA, it must NOT create or reassign any job on zaloB
    const failedJob = await repo.createPublishingJob({
      workspaceId,
      contentId,
      accountId: zaloA.id,
      platform: "ZALO",
      publishMode: "AUTO_PUBLISH",
      scheduledAt: "2026-11-17T09:00:00.000Z",
      idempotencyKey: `pub:${contentId}:${zaloA.id}:2026-11-17`,
      status: "QUEUED",
    });
    await repo.updatePublishingJobStatus(workspaceId, failedJob.id, {
      status: "FAILED",
      errorCode: "SESSION_EXPIRED",
      errorMessage: "Zalo QR session expired",
    });

    const jobsOnB = await repo.listPublishingJobs(workspaceId, { accountId: zaloB.id });
    expect(jobsOnB).toHaveLength(0);
  });
});

