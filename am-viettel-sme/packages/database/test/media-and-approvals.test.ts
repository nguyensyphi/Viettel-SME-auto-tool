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

describe("Media Assets, Content-Media Links & Approvals Repository (PB-P04, PB-P05)", () => {
  let pglite: PGlite;
  let repo: ContentLibraryRepository;
  const workspaceId = "55555555-5555-4555-8555-555555555555";
  const connectionId = "66666666-6666-4666-8666-666666666666";

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migrationSql);
    await pglite.query(
      `INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES
       ($1, 'ws-media-test', 'Media Test Workspace', CURRENT_TIMESTAMP)`,
      [workspaceId],
    );
    await pglite.query(
      `INSERT INTO "GoogleConnection" ("id", "workspaceId", "provider", "accountEmail", "scopes", "status") VALUES
       ($1, $2, 'GOOGLE', 'media@viettel.vn', ARRAY[]::TEXT[], 'CONNECTED')`,
      [connectionId, workspaceId],
    );
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(() => {
    repo = new ContentLibraryRepository(new PGliteDb(pglite));
  });

  it("PB-MT-009: upserts MediaAsset and increments version when checksum changes", async () => {
    const mediaV1 = await repo.upsertMediaAsset({
      workspaceId,
      connectionId,
      driveFileId: "drive_img_001",
      fileName: "chu_ky_so_01.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 450_000,
      checksum: "sha256-v1",
      topicCode: "CHU_KY_SO",
      postCodeHint: "PB001",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      isSharedMedia: false,
    });

    expect(mediaV1.id).toBeDefined();
    expect(mediaV1.version).toBe(1);
    expect(mediaV1.status).toBe("APPROVED");

    // Re-sync with identical checksum -> version stays 1
    const sameVersion = await repo.upsertMediaAsset({
      workspaceId,
      connectionId,
      driveFileId: "drive_img_001",
      fileName: "chu_ky_so_01.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 450_000,
      checksum: "sha256-v1",
      topicCode: "CHU_KY_SO",
      postCodeHint: "PB001",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
    });
    expect(sameVersion.version).toBe(1);

    // Update image content (new checksum) -> version bumps to 2
    const mediaV2 = await repo.upsertMediaAsset({
      workspaceId,
      connectionId,
      driveFileId: "drive_img_001",
      fileName: "chu_ky_so_01_updated.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 510_000,
      checksum: "sha256-v2",
      topicCode: "CHU_KY_SO",
      postCodeHint: "PB001",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
    });
    expect(mediaV2.version).toBe(2);

    const versions = await repo.listMediaVersions(mediaV2.id);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("PB-MT-005: finds media by checksum to detect duplicate files", async () => {
    const found = await repo.findMediaByChecksum(workspaceId, "sha256-v2");
    expect(found).not.toBeNull();
    expect(found?.driveFileId).toBe("drive_img_001");
  });

  it("links matched media to content post and retrieves linked media", async () => {
    const post = await repo.upsertPost({
      workspaceId,
      postCode: "PB001",
      title: "Chữ ký số Viettel-CA",
      body: "Nội dung bài viết CKS",
      topicCode: "CHU_KY_SO",
      platforms: ["ZALO", "FACEBOOK"],
      status: "DRAFT",
      contentHash: "hash-post-cks-1",
    });

    const mediaList = await repo.listMediaAssets(workspaceId, { topicCode: "CHU_KY_SO" });
    expect(mediaList).toHaveLength(1);
    const media = mediaList[0]!;

    const link = await repo.linkMediaToContent({
      contentId: post.id,
      mediaId: media.id,
      position: 0,
      matchMethod: "POST_ID",
      matchScore: 1.0,
    });
    expect(link.contentId).toBe(post.id);
    expect(link.mediaId).toBe(media.id);
    expect(link.matchMethod).toBe("POST_ID");

    const linked = await repo.listMediaForContent(post.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.id).toBe(media.id);
    expect(linked[0]!.matchMethod).toBe("POST_ID");
  });

  it("records ContentApproval audit history and updates post status (Section 7.4)", async () => {
    const post = await repo.getPostByCode(workspaceId, "PB001");
    expect(post).not.toBeNull();

    const approval1 = await repo.recordContentApproval({
      workspaceId,
      contentId: post!.id,
      contentVersion: post!.version,
      mediaVersion: 2,
      approvedBy: "user-am-dian-01",
      status: "REVISION_REQUIRED",
      approvedPlatforms: ["ZALO"],
      notes: "Cần bổ sung thêm hashtag #ViettelCA",
    });
    expect(approval1.status).toBe("REVISION_REQUIRED");

    const afterRevReq = await repo.getPostById(workspaceId, post!.id);
    expect(afterRevReq?.status).toBe("REVISION_REQUIRED");

    const approval2 = await repo.recordContentApproval({
      workspaceId,
      contentId: post!.id,
      contentVersion: post!.version,
      mediaVersion: 2,
      approvedBy: "user-am-dian-01",
      status: "APPROVED",
      approvedPlatforms: ["ZALO", "FACEBOOK"],
      notes: "Đã kiểm tra nội dung và hình ảnh đạt chuẩn",
    });
    expect(approval2.status).toBe("APPROVED");

    const afterApprove = await repo.getPostById(workspaceId, post!.id);
    expect(afterApprove?.status).toBe("APPROVED");

    const history = await repo.listContentApprovals(post!.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.status)).toEqual(["REVISION_REQUIRED", "APPROVED"]);
  });
});

