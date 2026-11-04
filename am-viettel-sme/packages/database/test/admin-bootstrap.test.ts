import { existsSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Argon2idPasswordHasher } from "@am-sme/auth";
import {
  assertInitialAdminBootstrapAllowed,
  bootstrapInitialAdmin,
  runBootstrapAdminCli,
  type AdminBootstrapDatabase,
  type AdminBootstrapExecutor,
} from "../src/admin-bootstrap.js";

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
const makeSyntheticPassword = () => `Synthetic-${id()}-${id()}!`;

class PGliteBootstrapDatabase implements AdminBootstrapDatabase {
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
    work: (transaction: AdminBootstrapExecutor) => Promise<T>,
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
let database: PGliteBootstrapDatabase;
const hasher = new Argon2idPasswordHasher({
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
});

async function createWorkspace(slug = `synthetic-${id()}`): Promise<string> {
  const workspaceId = id();
  await database.query(
    'INSERT INTO "Workspace" ("id", "slug", "displayName", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    [workspaceId, slug, "Synthetic workspace"],
  );
  return slug;
}

async function insertAdmin(workspaceSlug: string): Promise<string> {
  const workspace = await database.query<{ id: string }>(
    'SELECT "id" FROM "Workspace" WHERE "slug" = $1',
    [workspaceSlug],
  );
  const workspaceId = workspace[0]?.id;
  if (!workspaceId) throw new Error("TEST_WORKSPACE_MISSING");
  const userId = id();
  await database.query(
    'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', CURRENT_TIMESTAMP)',
    [userId, workspaceId, `existing-${userId}@example.invalid`],
  );
  await database.query(
    'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'ADMIN\')',
    [id(), workspaceId, userId],
  );
  return userId;
}

async function countRows(table: string): Promise<number> {
  const rows = await database.query<{ count: bigint }>(
    `SELECT count(*) AS "count" FROM "${table}"`,
  );
  return Number(rows[0]?.count ?? 0);
}

describe("P0.8 one-time first Admin bootstrap", () => {
  beforeEach(async () => {
    rawDatabase = new PGlite();
    database = new PGliteBootstrapDatabase(rawDatabase);
    if (!migrationSql) throw new Error("No SQL migrations found");
    await rawDatabase.exec(migrationSql);
  });

  afterEach(async () => {
    await rawDatabase.close();
  });

  it("creates one active Admin, Argon2id credential, audit event and durable marker", async () => {
    const workspaceSlug = await createWorkspace();
    const email = "First.Admin@example.invalid";
    const password = makeSyntheticPassword();
    const result = await bootstrapInitialAdmin(database, hasher, {
      workspaceSlug,
      email,
      password,
      now: new Date("2026-11-03T00:00:00.000Z"),
    });

    const user = await database.query<{
      id: string;
      emailNormalized: string;
      status: string;
    }>('SELECT "id", "emailNormalized", "status" FROM "User" WHERE "id" = $1', [
      result.userId,
    ]);
    const credential = await database.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "UserPasswordCredential" WHERE "userId" = $1',
      [result.userId],
    );
    const membership = await database.query<{ role: string }>(
      'SELECT "role" FROM "TeamMembership" WHERE "userId" = $1',
      [result.userId],
    );
    const marker = await database.query<{ adminUserId: string }>(
      'SELECT "adminUserId" FROM "AdminBootstrapState" WHERE "id" = 1',
    );
    const audit = await database.query<{
      action: string;
      actorId: string | null;
    }>('SELECT "action", "actorId" FROM "AuditEvent" WHERE "entityId" = $1', [
      result.userId,
    ]);

    expect(user[0]).toMatchObject({
      id: result.userId,
      emailNormalized: "first.admin@example.invalid",
      status: "ACTIVE",
    });
    expect(membership[0]?.role).toBe("ADMIN");
    expect(credential[0]?.passwordHash).toMatch(/^\$argon2id\$/u);
    expect(credential[0]?.passwordHash).not.toContain(password);
    expect(await hasher.verify(credential[0]!.passwordHash, password)).toBe(
      true,
    );
    expect(marker).toEqual([{ adminUserId: result.userId }]);
    await expect(
      database.query(
        'UPDATE "AdminBootstrapState" SET "completedAt" = CURRENT_TIMESTAMP WHERE "id" = 1',
      ),
    ).rejects.toThrow();
    await expect(
      database.query('DELETE FROM "AdminBootstrapState" WHERE "id" = 1'),
    ).rejects.toThrow();
    expect(audit).toEqual([
      { action: "INITIAL_ADMIN_BOOTSTRAPPED", actorId: null },
    ]);
    expect(await countRows("AdminBootstrapState")).toBe(1);
  });

  it("denies every second run, even after the first Admin is deactivated", async () => {
    const workspaceSlug = await createWorkspace();
    const first = await bootstrapInitialAdmin(database, hasher, {
      workspaceSlug,
      email: "first@example.invalid",
      password: makeSyntheticPassword(),
    });
    await database.query(
      'UPDATE "User" SET "status" = \'DEACTIVATED\', "deactivatedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1',
      [first.userId],
    );

    await expect(
      assertInitialAdminBootstrapAllowed(database, workspaceSlug),
    ).rejects.toThrow("ADMIN_BOOTSTRAP_ALREADY_COMPLETED");
    await expect(
      bootstrapInitialAdmin(database, hasher, {
        workspaceSlug,
        email: "second@example.invalid",
        password: makeSyntheticPassword(),
      }),
    ).rejects.toThrow("ADMIN_BOOTSTRAP_ALREADY_COMPLETED");
    expect(await countRows("User")).toBe(1);
    expect(await countRows("AdminBootstrapState")).toBe(1);
  });

  it("refuses pre-existing Admin state before requesting credentials", async () => {
    const workspaceSlug = await createWorkspace();
    await insertAdmin(workspaceSlug);
    const askEmail = vi.fn(async () => "unused@example.invalid");
    const askPassword = vi.fn(async () => makeSyntheticPassword());

    await expect(
      runBootstrapAdminCli({
        database,
        passwordHasher: hasher,
        env: { AUTH_BOOTSTRAP_WORKSPACE_SLUG: workspaceSlug },
        promptEmail: askEmail,
        promptPassword: askPassword,
        write: vi.fn(),
      }),
    ).rejects.toThrow("ADMIN_BOOTSTRAP_STATE_CONFLICT");
    expect(askEmail).not.toHaveBeenCalled();
    expect(askPassword).not.toHaveBeenCalled();
    expect(await countRows("AdminBootstrapState")).toBe(0);
  });

  it("writes no marker or partial user when audit append fails", async () => {
    const workspaceSlug = await createWorkspace();
    database.failOnAuditInsert = true;

    await expect(
      bootstrapInitialAdmin(database, hasher, {
        workspaceSlug,
        email: "rollback@example.invalid",
        password: makeSyntheticPassword(),
      }),
    ).rejects.toThrow("synthetic audit append failure");
    expect(await countRows("User")).toBe(0);
    expect(await countRows("TeamMembership")).toBe(0);
    expect(await countRows("UserPasswordCredential")).toBe(0);
    expect(await countRows("AdminBootstrapState")).toBe(0);
    expect(await countRows("AuditEvent")).toBe(0);
  });

  it("keeps environment credentials out of output and clears them after use", async () => {
    const workspaceSlug = await createWorkspace();
    const email = "private-admin@example.invalid";
    const password = makeSyntheticPassword();
    const output: string[] = [];
    const env = {
      AUTH_BOOTSTRAP_WORKSPACE_SLUG: workspaceSlug,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: email,
      AUTH_BOOTSTRAP_ADMIN_PASSWORD: password,
    };

    await runBootstrapAdminCli({
      database,
      passwordHasher: hasher,
      env,
      write: (message) => output.push(message),
    });
    expect(env.AUTH_BOOTSTRAP_ADMIN_EMAIL).toBeUndefined();
    expect(env.AUTH_BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
    expect(output.join("\n")).not.toContain(email);
    expect(output.join("\n")).not.toContain(password);
    expect(output.join("\n")).toMatch(/provisioned|created|initialized/i);

    await expect(
      runBootstrapAdminCli({
        database,
        passwordHasher: hasher,
        env: { AUTH_BOOTSTRAP_WORKSPACE_SLUG: workspaceSlug },
        write: vi.fn(),
      }),
    ).rejects.toThrow("ADMIN_BOOTSTRAP_ALREADY_COMPLETED");
  });

  it("fails closed without safe terminal prompts or environment credentials", async () => {
    const workspaceSlug = await createWorkspace();
    await expect(
      runBootstrapAdminCli({
        database,
        passwordHasher: hasher,
        env: { AUTH_BOOTSTRAP_WORKSPACE_SLUG: workspaceSlug },
        write: vi.fn(),
      }),
    ).rejects.toThrow("SAFE_TERMINAL_REQUIRED");
    expect(await countRows("User")).toBe(0);
    expect(await countRows("AdminBootstrapState")).toBe(0);
  });

  it("uses the exact approved TTLs and does not add a bootstrap HTTP endpoint", () => {
    const envExample = readFileSync(join(projectRoot, ".env.example"), "utf8");
    const apiSource = readFileSync(
      join(projectRoot, "apps", "web", "src", "server", "http-api.ts"),
      "utf8",
    );
    expect(envExample).toMatch(/^AUTH_SESSION_TTL_MS=28800000$/mu);
    expect(envExample).toMatch(/^AUTH_INVITATION_TTL_MS=86400000$/mu);
    expect(apiSource).not.toMatch(
      /auth.{0,20}bootstrap|bootstrap.{0,20}auth/iu,
    );
  });
});
