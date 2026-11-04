import { randomUUID } from "node:crypto";
import type { PasswordHasher } from "@am-sme/auth";

export interface AdminBootstrapExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]>;
}

export interface AdminBootstrapDatabase extends AdminBootstrapExecutor {
  transaction<T>(
    work: (transaction: AdminBootstrapExecutor) => Promise<T>,
  ): Promise<T>;
}

interface PrismaRawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

interface PrismaAdminBootstrapClient extends PrismaRawQueryClient {
  $transaction<T>(
    work: (transaction: PrismaRawQueryClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export interface BootstrapInitialAdminInput {
  workspaceSlug: string;
  email: string;
  password: string;
  now?: Date;
}

export interface BootstrapCliOptions {
  database: AdminBootstrapDatabase;
  passwordHasher: PasswordHasher;
  env: Record<string, string | undefined>;
  promptEmail?: () => Promise<string>;
  promptPassword?: () => Promise<string>;
  write: (message: string) => void;
}

const EMAIL_ENV = "AUTH_BOOTSTRAP_ADMIN_EMAIL";
const PASSWORD_ENV = "AUTH_BOOTSTRAP_ADMIN_PASSWORD";
const WORKSPACE_ENV = "AUTH_BOOTSTRAP_WORKSPACE_SLUG";

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  ) {
    throw new Error("INVALID_EMAIL");
  }
  return normalized;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === "23505" ||
    candidate.code === "P2002" ||
    candidate.meta?.code === "23505"
  );
}

async function assertNoCompletedBootstrap(
  database: AdminBootstrapExecutor,
): Promise<boolean> {
  const marker = await database.query<{ id: number }>(
    'SELECT "id" FROM "AdminBootstrapState" WHERE "id" = 1',
  );
  const admins = await database.query<{ present: number }>(
    'SELECT 1 AS "present" FROM "TeamMembership" WHERE "role" = \'ADMIN\' LIMIT 1',
  );

  if (marker.length > 0) {
    if (admins.length === 0) {
      throw new Error("ADMIN_BOOTSTRAP_STATE_CONFLICT");
    }
    throw new Error("ADMIN_BOOTSTRAP_ALREADY_COMPLETED");
  }
  if (admins.length > 0) throw new Error("ADMIN_BOOTSTRAP_STATE_CONFLICT");
  return true;
}

export async function assertInitialAdminBootstrapAllowed(
  database: AdminBootstrapDatabase,
  workspaceSlug: string,
): Promise<void> {
  const slug = workspaceSlug.trim();
  if (!slug) throw new Error("WORKSPACE_SLUG_REQUIRED");

  await assertNoCompletedBootstrap(database);
  const workspace = await database.query<{ id: string }>(
    'SELECT "id" FROM "Workspace" WHERE "slug" = $1',
    [slug],
  );
  if (workspace.length !== 1) throw new Error("WORKSPACE_NOT_FOUND");
}

export async function bootstrapInitialAdmin(
  database: AdminBootstrapDatabase,
  passwordHasher: PasswordHasher,
  input: BootstrapInitialAdminInput,
): Promise<{ userId: string; completedAt: Date }> {
  const emailNormalized = normalizeEmail(input.email);
  if (input.password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
  const workspaceSlug = input.workspaceSlug.trim();
  if (!workspaceSlug) throw new Error("WORKSPACE_SLUG_REQUIRED");

  await assertInitialAdminBootstrapAllowed(database, workspaceSlug);
  const passwordHash = await passwordHasher.hash(input.password);
  const userId = randomUUID();
  const membershipId = randomUUID();
  const credentialId = randomUUID();
  const auditId = randomUUID();
  const completedAt = input.now ?? new Date();

  try {
    await database.transaction(async (transaction) => {
      // Recheck inside the serializable transaction; the singleton primary key
      // also serializes concurrent invocations of this CLI.
      await assertNoCompletedBootstrap(transaction);
      const workspace = await transaction.query<{ id: string }>(
        'SELECT "id" FROM "Workspace" WHERE "slug" = $1',
        [workspaceSlug],
      );
      if (workspace.length !== 1) throw new Error("WORKSPACE_NOT_FOUND");
      const workspaceId = workspace[0]!.id;

      await transaction.query(
        'INSERT INTO "AdminBootstrapState" ("id", "adminUserId", "completedAt") VALUES (1, $1, $2)',
        [userId, completedAt],
      );
      await transaction.query(
        'INSERT INTO "User" ("id", "workspaceId", "emailNormalized", "status", "updatedAt") VALUES ($1, $2, $3, \'ACTIVE\', $4)',
        [userId, workspaceId, emailNormalized, completedAt],
      );
      await transaction.query(
        'INSERT INTO "TeamMembership" ("id", "workspaceId", "userId", "role") VALUES ($1, $2, $3, \'ADMIN\')',
        [membershipId, workspaceId, userId],
      );
      await transaction.query(
        'INSERT INTO "UserPasswordCredential" ("id", "workspaceId", "userId", "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $5)',
        [credentialId, workspaceId, userId, passwordHash, completedAt],
      );
      await transaction.query(
        'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "changedFieldNames", "outcome", "createdAt") VALUES ($1, $2, NULL, NULL, \'INITIAL_ADMIN_BOOTSTRAPPED\', \'User\', $3, ARRAY[\'status\', \'role\', \'passwordCredential\']::text[], \'SUCCESS\', $4)',
        [auditId, workspaceId, userId, completedAt],
      );
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new Error("ADMIN_BOOTSTRAP_ALREADY_COMPLETED");
    }
    throw error;
  }

  return { userId, completedAt };
}

export async function runBootstrapAdminCli(
  options: BootstrapCliOptions,
): Promise<{ userId: string; completedAt: Date }> {
  const emailFromEnvironment = options.env[EMAIL_ENV];
  let passwordFromEnvironment = options.env[PASSWORD_ENV];
  delete options.env[EMAIL_ENV];
  delete options.env[PASSWORD_ENV];

  const workspaceSlug = options.env[WORKSPACE_ENV]?.trim();
  if (!workspaceSlug) throw new Error("WORKSPACE_SLUG_REQUIRED");

  // Refuse to ask for or read credentials if an Admin or a completion marker
  // already exists. This is repeated again immediately before the transaction.
  await assertInitialAdminBootstrapAllowed(options.database, workspaceSlug);

  const email =
    emailFromEnvironment ??
    (options.promptEmail
      ? await options.promptEmail()
      : (() => {
          throw new Error("SAFE_TERMINAL_REQUIRED");
        })());
  normalizeEmail(email);
  let password =
    passwordFromEnvironment ??
    (options.promptPassword
      ? await options.promptPassword()
      : (() => {
          throw new Error("SAFE_TERMINAL_REQUIRED");
        })());

  try {
    const result = await bootstrapInitialAdmin(
      options.database,
      options.passwordHasher,
      { workspaceSlug, email, password },
    );
    options.write(
      "Initial Admin provisioned. First-admin bootstrap is now permanently disabled for this database.\n",
    );
    return result;
  } finally {
    password = "";
    passwordFromEnvironment = undefined;
  }
}

export function createPrismaAdminBootstrapDatabase(
  prisma: PrismaAdminBootstrapClient,
): AdminBootstrapDatabase {
  const executor = (client: PrismaRawQueryClient): AdminBootstrapExecutor => ({
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<T[]> {
      return client.$queryRawUnsafe<T[]>(sql, ...parameters);
    },
  });

  return {
    ...executor(prisma),
    transaction<T>(
      work: (transaction: AdminBootstrapExecutor) => Promise<T>,
    ): Promise<T> {
      return prisma.$transaction((transaction) => work(executor(transaction)), {
        isolationLevel: "Serializable",
      });
    },
  };
}
