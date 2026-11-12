import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ContentLibraryRepository,
  type ContentLibraryDatabase,
  type UpsertPostInput,
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

describe("Content Library Repository (PB-P02, PB-P03)", () => {
  let pglite: PGlite;
  let repo: ContentLibraryRepository;
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  const connectionId = "44444444-4444-4444-8444-444444444444";

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migrationSql);
    await pglite.query(
      `INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES
       ($1, 'ws-content-test', 'Content Test Workspace', CURRENT_TIMESTAMP)`,
      [workspaceId],
    );
    await pglite.query(
      `INSERT INTO "GoogleConnection" ("id", "workspaceId", "provider", "accountEmail", "scopes", "status") VALUES
       ($1, $2, 'GOOGLE', 'test@viettel.vn', ARRAY[]::TEXT[], 'CONNECTED')`,
      [connectionId, workspaceId],
    );
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(() => {
    repo = new ContentLibraryRepository(new PGliteDb(pglite));
  });

  it("records a Google Document and upserts posts with content hashing", async () => {
    const doc = await repo.upsertGoogleDocument({
      connectionId,
      documentId: "gdoc_12345",
      name: "Viettel_AM_Branding_Posts",
      revisionId: "rev_001",
      contentHash: "hash-doc-1",
      postCount: 1,
    });

    expect(doc.id).toBeDefined();
    expect(doc.name).toBe("Viettel_AM_Branding_Posts");

    const postInput: UpsertPostInput = {
      workspaceId,
      documentId: doc.id,
      postCode: "PB001",
      title: "Vì sao nên dùng chữ ký số Viettel?",
      body: "Nội dung bài viết về chữ ký số.",
      topicCode: "CHU_KY_SO",
      targetAudience: "BUSINESS_OWNER",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      priority: "HIGH",
      mediaHint: "AUTO",
      hashtags: ["#Viettel", "#ChuKySo"],
      contentHash: "hash-post-001",
    };

    const saved = await repo.upsertPost(postInput);
    expect(saved.id).toBeDefined();
    expect(saved.postCode).toBe("PB001");
    expect(saved.version).toBe(1);
    expect(saved.status).toBe("APPROVED");

    const versions = await repo.listPostVersions(saved.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);
    expect(versions[0]!.title).toBe("Vì sao nên dùng chữ ký số Viettel?");
  });

  it("creates a new version record when post content changes (Never overwrite without history)", async () => {
    const original = await repo.getPostByCode(workspaceId, "PB001");
    expect(original).not.toBeNull();

    // Update with modified body and new contentHash
    const updated = await repo.upsertPost({
      workspaceId,
      documentId: original!.documentId!,
      postCode: "PB001",
      title: "Vì sao nên dùng chữ ký số Viettel? (Bản cập nhật)",
      body: "Nội dung bài viết đã được sửa đổi và cập nhật chính sách mới.",
      topicCode: "CHU_KY_SO",
      targetAudience: "BUSINESS_OWNER",
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      priority: "HIGH",
      mediaHint: "AUTO",
      hashtags: ["#Viettel", "#ChuKySo", "#CapNhat"],
      contentHash: "hash-post-001-v2",
    });

    expect(updated.version).toBe(2);
    expect(updated.title).toContain("(Bản cập nhật)");

    const versions = await repo.listPostVersions(updated.id);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("does not bump version if contentHash is identical", async () => {
    const current = await repo.getPostByCode(workspaceId, "PB001");
    const same = await repo.upsertPost({
      workspaceId,
      documentId: current!.documentId!,
      postCode: "PB001",
      title: current!.title,
      body: current!.body,
      topicCode: current!.topicCode,
      targetAudience: current!.targetAudience,
      platforms: current!.platforms,
      status: current!.status,
      priority: current!.priority,
      mediaHint: current!.mediaHint,
      hashtags: current!.hashtags,
      contentHash: "hash-post-001-v2", // same hash
    });

    expect(same.version).toBe(2); // no version bump
  });

  it("lists posts with topic and status filters", async () => {
    // Add another post in a different topic
    await repo.upsertPost({
      workspaceId,
      documentId: null,
      postCode: "PB002",
      title: "Hóa đơn điện tử S-Invoice",
      body: "Nội dung hóa đơn điện tử",
      topicCode: "HOA_DON_DIEN_TU",
      targetAudience: "BUSINESS_OWNER",
      platforms: ["ZALO"],
      status: "DRAFT",
      priority: "NORMAL",
      mediaHint: null,
      hashtags: ["#SInvoice"],
      contentHash: "hash-pb-002",
    });

    const all = await repo.listPosts(workspaceId);
    expect(all).toHaveLength(2);

    const cksOnly = await repo.listPosts(workspaceId, { topicCode: "CHU_KY_SO" });
    expect(cksOnly).toHaveLength(1);
    expect(cksOnly[0]!.postCode).toBe("PB001");

    const draftOnly = await repo.listPosts(workspaceId, { status: "DRAFT" });
    expect(draftOnly).toHaveLength(1);
    expect(draftOnly[0]!.postCode).toBe("PB002");
  });

  it("approves and rejects posts", async () => {
    const post = await repo.getPostByCode(workspaceId, "PB002");
    expect(post?.status).toBe("DRAFT");

    await repo.updatePostStatus(workspaceId, post!.id, "APPROVED");
    const approved = await repo.getPostById(workspaceId, post!.id);
    expect(approved?.status).toBe("APPROVED");

    await repo.updatePostStatus(workspaceId, post!.id, "REJECTED");
    const rejected = await repo.getPostById(workspaceId, post!.id);
    expect(rejected?.status).toBe("REJECTED");
  });
});

