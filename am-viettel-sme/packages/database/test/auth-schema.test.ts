import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(packageRoot, "prisma", "schema.prisma");
const migrationsPath = join(packageRoot, "prisma", "migrations");
const schema = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : "";
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const id = () => randomUUID();
let database: PGlite;

function model(name: string): string {
  return (
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ??
    ""
  );
}

async function createWorkspace(slug: string): Promise<string> {
  const workspaceId = id();
  await database.query(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [workspaceId, slug, `Synthetic ${slug}`],
  );
  return workspaceId;
}

async function createAdmin(workspaceId: string): Promise<string> {
  const adminId = id();
  await database.query(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [adminId, workspaceId, `admin-${adminId}@example.invalid`],
  );
  await database.query(
    'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'ADMIN\')',
    [id(), workspaceId, adminId],
  );
  return adminId;
}

describe("P0.2 auth schema and database contract", () => {
  beforeAll(async () => {
    database = new PGlite();
    if (!migrationSql) throw new Error("No SQL migrations found");
    await database.exec(migrationSql);
  });

  afterAll(async () => {
    await database.close();
  });

  it("keeps password credential/session material separate and stores only hashes", () => {
    expect(model("User")).not.toMatch(/passwordHash/);
    expect(model("UserPasswordCredential")).toMatch(/passwordHash\s+String/);
    expect(model("UserPasswordCredential")).toMatch(
      /@@unique\(\[workspaceId,\s*userId\]\)/,
    );
    expect(model("AuthSession")).toMatch(/tokenHash\s+String/);
    expect(model("AuthSession")).toMatch(/expiresAt\s+DateTime/);
    expect(model("AuthSession")).toMatch(/revokedAt\s+DateTime\?/);
    expect(migrationSql).toMatch(/CREATE TABLE "UserPasswordCredential"/);
    expect(migrationSql).toMatch(/CREATE TABLE "AuthSession"/);
    expect(migrationSql).toMatch(/AuthSession_workspaceId_userId_fkey/);
    expect(migrationSql).toMatch(
      /UserPasswordCredential_workspaceId_userId_fkey/,
    );
    expect(migrationSql).toMatch(/User_invitationTokenHash_sha256_check/);
    expect(migrationSql).toMatch(/UserPasswordCredential_argon2id_hash_check/);
    expect(migrationSql).toMatch(/AuthSession_tokenHash_sha256_check/);
  });

  it("atomically consumes a one-time invite only while unexpired", async () => {
    const workspaceId = await createWorkspace(`invite-${id()}`);
    const adminId = await createAdmin(workspaceId);
    const inviteId = id();
    const rawToken = `synthetic-invite-${id()}`;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await database.query(
      'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "invitationTokenHash", "invitedAt", "invitationExpiresAt", "invitedByUserId", "updatedAt") VALUES ($1, $2, $3, \'INVITED\', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL \'1 hour\', $5, CURRENT_TIMESTAMP)',
      [
        inviteId,
        workspaceId,
        `invited-${inviteId}@example.invalid`,
        tokenHash,
        adminId,
      ],
    );
    await database.query(
      'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'AM\')',
      [id(), workspaceId, inviteId],
    );

    const consumeSql =
      'UPDATE "User" SET "status" = \'ACTIVE\', "acceptedAt" = CURRENT_TIMESTAMP, "invitationTokenHash" = NULL, "invitationExpiresAt" = NULL, "displayName" = \'Synthetic User\', "updatedAt" = CURRENT_TIMESTAMP WHERE "invitationTokenHash" = $1 AND "status" = \'INVITED\' AND "invitationExpiresAt" > CURRENT_TIMESTAMP RETURNING "id"';
    const first = await database.query<{ id: string }>(consumeSql, [tokenHash]);
    const replay = await database.query<{ id: string }>(consumeSql, [
      tokenHash,
    ]);
    expect(first.rows).toHaveLength(1);
    expect(replay.rows).toHaveLength(0);

    const expiredId = id();
    const expiredHash = createHash("sha256")
      .update(`expired-${id()}`)
      .digest("hex");
    await database.query(
      'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "invitationTokenHash", "invitationExpiresAt", "updatedAt") VALUES ($1, $2, $3, \'INVITED\', $4, CURRENT_TIMESTAMP - INTERVAL \'1 second\', CURRENT_TIMESTAMP)',
      [
        expiredId,
        workspaceId,
        `expired-${expiredId}@example.invalid`,
        expiredHash,
      ],
    );
    const expired = await database.query<{ id: string }>(consumeSql, [
      expiredHash,
    ]);
    expect(expired.rows).toHaveLength(0);
    const stored = await database.query<{ invitationTokenHash: string | null }>(
      'SELECT "invitationTokenHash" FROM "User" WHERE "id" = $1',
      [inviteId],
    );
    expect(stored.rows[0]?.invitationTokenHash).toBeNull();
  });

  it("prevents cross-workspace credentials/sessions and makes deactivated users' sessions inactive", async () => {
    const workspaceId = await createWorkspace(`session-${id()}`);
    const otherWorkspaceId = await createWorkspace(`session-other-${id()}`);
    const userId = id();
    await database.query(
      'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
      [userId, workspaceId, `user-${userId}@example.invalid`],
    );
    await database.query(
      'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'AM\')',
      [id(), workspaceId, userId],
    );
    await database.query(
      'INSERT INTO "UserPasswordCredential" ("id", "workspaceId", "userId", "passwordHash", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
      [id(), workspaceId, userId, "$argon2id$synthetic-hash"],
    );
    const invalidHashUserId = id();
    await database.query(
      'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
      [
        invalidHashUserId,
        workspaceId,
        `hash-check-${invalidHashUserId}@example.invalid`,
      ],
    );
    await expect(
      database.query(
        'INSERT INTO "UserPasswordCredential" ("id", "workspaceId", "userId", "passwordHash", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
        [id(), workspaceId, invalidHashUserId, "plain-password-not-a-hash"],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        'UPDATE "User" SET "invitationTokenHash" = $1 WHERE "id" = $2',
        ["raw-invitation-token", userId],
      ),
    ).rejects.toThrow();

    const sessionId = id();
    const tokenHash = "a".repeat(64);
    await database.query(
      'INSERT INTO "AuthSession" ("id", "workspaceId", "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL \'1 hour\')',
      [sessionId, workspaceId, userId, tokenHash],
    );
    await expect(
      database.query(
        'INSERT INTO "AuthSession" ("id", "workspaceId", "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL \'1 hour\')',
        [id(), workspaceId, userId, "raw-session-token"],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        'INSERT INTO "AuthSession" ("id", "workspaceId", "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL \'1 hour\')',
        [id(), otherWorkspaceId, userId, "b".repeat(64)],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        'INSERT INTO "UserPasswordCredential" ("id", "workspaceId", "userId", "passwordHash", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
        [id(), otherWorkspaceId, userId, "$argon2id$synthetic-cross-workspace"],
      ),
    ).rejects.toThrow();

    await database.query(
      'UPDATE "User" SET "status" = \'DEACTIVATED\', "deactivatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1',
      [userId],
    );
    const active = await database.query<{ count: number }>(
      'SELECT count(*)::int AS "count" FROM "AuthSession" AS session JOIN "User" AS account ON account."workspaceId" = session."workspaceId" AND account."id" = session."userId" WHERE session."id" = $1 AND session."revokedAt" IS NULL AND session."expiresAt" > CURRENT_TIMESTAMP AND account."status" = \'ACTIVE\'',
      [sessionId],
    );
    expect(active.rows[0]?.count).toBe(0);
  });
});
