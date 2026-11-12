import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GoogleConnectionRepository,
  type GoogleConnectionRow,
  type GoogleDriveFolderRow,
  type GoogleConnectionDatabase,
} from "../src/google-connections.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

class PGliteTestDb implements GoogleConnectionDatabase {
  constructor(private readonly database: PGlite) {}

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    const result = await this.database.query<T>(sql, [...values]);
    return result.rows;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<void> {
    await this.query(sql, values);
  }
}

describe("Google Connections & Drive Folders Repository (PB-P01)", () => {
  let pglite: PGlite;
  let repo: GoogleConnectionRepository;
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migrationSql);
    await pglite.query(
      `INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES
       ($1, 'ws-test-1', 'Test Workspace 1', CURRENT_TIMESTAMP),
       ($2, 'ws-test-2', 'Test Workspace 2', CURRENT_TIMESTAMP)`,
      [workspaceId, otherWorkspaceId],
    );
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(() => {
    repo = new GoogleConnectionRepository(new PGliteTestDb(pglite));
  });

  it("creates and retrieves a Google Connection partitioned by workspace", async () => {
    const created = await repo.createConnection({
      workspaceId,
      accountEmail: "am.viettel@gmail.com",
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
      ],
      encryptedRefreshToken: "enc:mock-refresh-token",
    });

    expect(created.id).toBeDefined();
    expect(created.workspaceId).toBe(workspaceId);
    expect(created.accountEmail).toBe("am.viettel@gmail.com");
    expect(created.status).toBe("CONNECTED");

    const retrieved = await repo.getConnectionById(workspaceId, created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.accountEmail).toBe("am.viettel@gmail.com");

    // Fail closed: cannot retrieve from different workspace
    const fromOther = await repo.getConnectionById(otherWorkspaceId, created.id);
    expect(fromOther).toBeNull();
  });

  it("updates connection status and revokes tokens safely", async () => {
    const conn = await repo.createConnection({
      workspaceId,
      accountEmail: "am.viettel.2@gmail.com",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      encryptedRefreshToken: "enc:token-2",
    });

    const revoked = await repo.revokeConnection(workspaceId, conn.id);
    expect(revoked).toBe(true);

    const check = await repo.getConnectionById(workspaceId, conn.id);
    expect(check?.status).toBe("REVOKED");
    expect(check?.encryptedRefreshToken).toBeNull();
  });

  it("registers and lists Google Drive folders under a connection", async () => {
    const conn = await repo.createConnection({
      workspaceId,
      accountEmail: "am.viettel.3@gmail.com",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      encryptedRefreshToken: "enc:token-3",
    });

    const rootFolder = await repo.registerFolder({
      connectionId: conn.id,
      driveFolderId: "folder_root_123",
      folderName: "VIETTEL_AM",
      folderType: "ROOT",
      pathHint: "/VIETTEL_AM",
    });

    const contentFolder = await repo.registerFolder({
      connectionId: conn.id,
      driveFolderId: "folder_content_456",
      folderName: "CONTENT",
      folderType: "CONTENT",
      pathHint: "/VIETTEL_AM/PERSONAL_BRANDING/CONTENT",
    });

    expect(rootFolder.id).toBeDefined();
    expect(contentFolder.folderType).toBe("CONTENT");

    const folders = await repo.listFolders(workspaceId, conn.id);
    expect(folders).toHaveLength(2);
    expect(folders.map((f) => f.folderName).sort()).toEqual(["CONTENT", "VIETTEL_AM"]);
  });

  it("appends and fetches sync logs for auditability", async () => {
    const conn = await repo.createConnection({
      workspaceId,
      accountEmail: "am.viettel.sync@gmail.com",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      encryptedRefreshToken: "enc:token-sync",
    });

    await repo.appendSyncLog({
      connectionId: conn.id,
      entityId: "folder_root_123",
      syncType: "FOLDER",
      syncStatus: "SUCCESS",
      itemsSynced: 12,
      errorMessage: null,
    });

    const logs = await repo.listSyncLogs(conn.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.itemsSynced).toBe(12);
    expect(logs[0]?.syncStatus).toBe("SUCCESS");
  });
});
