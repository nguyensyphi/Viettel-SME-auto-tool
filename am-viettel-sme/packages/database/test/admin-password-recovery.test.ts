import { existsSync, readFileSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Argon2idPasswordHasher } from "@am-sme/auth";
import {
  assertActiveAdminPasswordRecoveryAllowed,
  recoverAdminPassword,
  runAdminPasswordRecoveryCli,
  type AdminPasswordRecoveryDatabase,
  type AdminPasswordRecoveryExecutor,
} from "../src/admin-password-recovery.js";
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = join(packageRoot, "..", "..");
const migrationsPath = join(packageRoot, "prisma", "migrations");
const migrationSql = readdirSync(migrationsPath)
  .sort()
  .map((name) => join(migrationsPath, name, "migration.sql"))
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const id = () => randomUUID();
const makePassword = () =>
  `Synthetic-${randomBytes(24).toString("base64url")}!`;
class PGliteRecoveryDatabase implements AdminPasswordRecoveryDatabase {
  failOnAuditInsert = false;
  constructor(private readonly database: PGlite) {}
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<T[]> {
    if (this.failOnAuditInsert && /INSERT INTO "AuditEvent"/u.test(sql)) {
      this.failOnAuditInsert = false;
      throw new Error("synthetic audit append failure");
    }
    const result = await this.database.query<T>(sql, [...parameters]);
    return result.rows;
  }
  async transaction<T>(
    work: (transaction: AdminPasswordRecoveryExecutor) => Promise<T>,
  ): Promise<T> {
    await this.database.exec("BEGIN");
    try {
      const result = await work(this);
      await this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.database.exec("ROLLBACK");
      } catch {
        // Keep the original failure for the assertion.
      }
      throw error;
    }
  }
}
let rawDatabase: PGlite;
let database: PGliteRecoveryDatabase;
const hasher = new Argon2idPasswordHasher({
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
});
async function createAdmin(): Promise<{
  workspaceSlug: string;
  workspaceId: string;
  userId: string;
  sessionId: string;
  oldPassword: string;
}> {
  const workspaceId = id();
  const workspaceSlug = `synthetic-${id()}`;
  const userId = id();
  const oldPassword = makePassword();
  await database.query(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [workspaceId, workspaceSlug, "Synthetic workspace"],
  );
  await database.query(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [userId, workspaceId, "owner@example.invalid"],
  );
  await database.query(
    'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'ADMIN\')',
    [id(), workspaceId, userId],
  );
  await database.query(
    'INSERT INTO "UserPasswordCredential" ("id", "workspaceId", "userId", "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [id(), workspaceId, userId, await hasher.hash(oldPassword)],
  );
  const sessionId = id();
  await database.query(
    'INSERT INTO "AdminBootstrapState" ("id", "adminUserId", "completedAt") VALUES (1, $1, CURRENT_TIMESTAMP)',
    [userId],
  );
  await database.query(
    'INSERT INTO "AuthSession" ("id", "workspaceId", "userId", "tokenHash", "expiresAt", "revokedAt", "createdAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL \'1 hour\', NULL, CURRENT_TIMESTAMP)',
    [sessionId, workspaceId, userId, randomBytes(32).toString("hex")],
  );
  return { workspaceSlug, workspaceId, userId, sessionId, oldPassword };
}
async function countRows(table: string): Promise<number> {
  const rows = await database.query<{ count: bigint }>(
    `SELECT count(*) AS "count" FROM "${table}"`,
  );
  return Number(rows[0]?.count ?? 0);
}
describe("local Admin password recovery", () => {
  beforeEach(async () => {
    rawDatabase = new PGlite();
    database = new PGliteRecoveryDatabase(rawDatabase);
    if (!migrationSql) throw new Error("No SQL migrations found");
    await rawDatabase.exec(migrationSql);
  });
  afterEach(async () => {
    await rawDatabase.close();
  });
  it("replaces only the credential and appends an audit event atomically", async () => {
    const admin = await createAdmin();
    const priorPassword = admin.oldPassword;
    const newPassword = makePassword();
    const result = await recoverAdminPassword(database, hasher, {
      workspaceSlug: admin.workspaceSlug,
      email: "OWNER@EXAMPLE.INVALID",
      password: newPassword,
      now: new Date("2026-11-03T00:00:00.000Z"),
    });
    const credential = await database.query<{
      passwordHash: string;
      updatedAt: Date;
    }>(
      'SELECT "passwordHash", "updatedAt" FROM "UserPasswordCredential" WHERE "userId" = $1',
      [admin.userId],
    );
    expect(result).toEqual({ userId: admin.userId });
    expect(credential[0]?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(credential[0]?.passwordHash).not.toContain(newPassword);
    expect(await hasher.verify(credential[0]!.passwordHash, newPassword)).toBe(
      true,
    );
    expect(
      await hasher.verify(credential[0]!.passwordHash, priorPassword),
    ).toBe(false);
    const audit = await database.query<{
      action: string;
      entityType: string;
      entityId: string;
      actorId: string | null;
      changedFieldNames: string[];
      outcome: string;
    }>(
      'SELECT "action", "entityType", "entityId", "actorId", "changedFieldNames", "outcome" FROM "AuditEvent" WHERE "entityId" = $1',
      [admin.userId],
    );
    expect(audit).toEqual([
      {
        action: "ADMIN_PASSWORD_RECOVERED",
        entityType: "User",
        entityId: admin.userId,
        actorId: null,
        changedFieldNames: ["passwordCredential"],
        outcome: "SUCCESS",
      },
    ]);
    expect(await countRows("User")).toBe(1);
    expect(await countRows("TeamMembership")).toBe(1);
    expect(
      await database.query<{ id: string; revokedAt: Date | null }>(
        'SELECT "id", "revokedAt" FROM "AuthSession" WHERE "userId" = $1',
        [admin.userId],
      ),
    ).toEqual([{ id: admin.sessionId, revokedAt: null }]);
    expect(
      await database.query<{ adminUserId: string }>(
        'SELECT "adminUserId" FROM "AdminBootstrapState" WHERE "id" = 1',
      ),
    ).toEqual([{ adminUserId: admin.userId }]);
    expect(await countRows("AuthSession")).toBe(1);
    expect(await countRows("AdminBootstrapState")).toBe(1);
    expect(await countRows("Lead")).toBe(0);
  });
  it("refuses a non-Admin or inactive account before requesting a password", async () => {
    const admin = await createAdmin();
    await database.query(
      'UPDATE "TeamMembership" SET "role" = \'MANAGER\' WHERE "userId" = $1',
      [admin.userId],
    );
    const askPassword = vi.fn(async () => makePassword());
    await expect(
      runAdminPasswordRecoveryCli({
        database,
        passwordHasher: hasher,
        env: { AUTH_RECOVERY_WORKSPACE_SLUG: admin.workspaceSlug },
        promptEmail: async () => "owner@example.invalid",
        promptPassword: askPassword,
        write: vi.fn(),
      }),
    ).rejects.toThrow("ACTIVE_ADMIN_NOT_FOUND");
    expect(askPassword).not.toHaveBeenCalled();
    expect(await countRows("AuditEvent")).toBe(0);
  });
  it("rolls back the credential change if audit append fails", async () => {
    const admin = await createAdmin();
    const newPassword = makePassword();
    database.failOnAuditInsert = true;
    await expect(
      recoverAdminPassword(database, hasher, {
        workspaceSlug: admin.workspaceSlug,
        email: "owner@example.invalid",
        password: newPassword,
      }),
    ).rejects.toThrow("synthetic audit append failure");
    const credential = await database.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "UserPasswordCredential" WHERE "userId" = $1',
      [admin.userId],
    );
    expect(
      await hasher.verify(credential[0]!.passwordHash, admin.oldPassword),
    ).toBe(true);
    expect(await countRows("AuditEvent")).toBe(0);
    expect(await countRows("User")).toBe(1);
    expect(await countRows("TeamMembership")).toBe(1);
  });
  it("validates workspace/email/password and does not use environment password values", async () => {
    const admin = await createAdmin();
    const newPassword = makePassword();
    const output: string[] = [];
    const env = {
      AUTH_RECOVERY_WORKSPACE_SLUG: admin.workspaceSlug,
      AUTH_RECOVERY_ADMIN_PASSWORD: "must-not-be-used-or-logged",
    };
    await runAdminPasswordRecoveryCli({
      database,
      passwordHasher: hasher,
      env,
      promptEmail: async () => "owner@example.invalid",
      promptPassword: async () => newPassword,
      write: (message) => output.push(message),
    });
    expect(output.join("\n")).not.toContain(newPassword);
    expect(output.join("\n")).not.toContain("must-not-be-used-or-logged");
    expect(env.AUTH_RECOVERY_ADMIN_PASSWORD).toBe("must-not-be-used-or-logged");
    await expect(
      assertActiveAdminPasswordRecoveryAllowed(
        database,
        admin.workspaceSlug,
        "missing@example.invalid",
      ),
    ).rejects.toThrow("ACTIVE_ADMIN_NOT_FOUND");
    await expect(
      recoverAdminPassword(database, hasher, {
        workspaceSlug: admin.workspaceSlug,
        email: "owner@example.invalid",
        password: "short",
      }),
    ).rejects.toThrow("PASSWORD_TOO_SHORT");
    expect(await countRows("User")).toBe(1);
    expect(await countRows("TeamMembership")).toBe(1);
  });
  it("retains the one-time bootstrap marker and never adds an HTTP recovery route", () => {
    const apiSource = readFileSync(
      join(projectRoot, "apps", "web", "src", "server", "http-api.ts"),
      "utf8",
    );
    const recoverySource = readFileSync(
      join(packageRoot, "src", "admin-password-recovery.ts"),
      "utf8",
    );
    expect(apiSource).not.toMatch(
      /auth.{0,30}(?:recover|reset).{0,30}password|(?:recover|reset).{0,30}password.{0,30}auth/iu,
    );
    expect(recoverySource).not.toMatch(/DELETE\s+FROM/iu);
    expect(recoverySource).not.toMatch(/AdminBootstrapState/iu);
  });
});
