import { randomUUID } from "node:crypto";
import type { PasswordHasher } from "@am-sme/auth";
export interface AdminPasswordRecoveryExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]>;
}
export interface AdminPasswordRecoveryDatabase extends AdminPasswordRecoveryExecutor {
  transaction<T>(
    work: (transaction: AdminPasswordRecoveryExecutor) => Promise<T>,
  ): Promise<T>;
}
interface PrismaRawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}
interface PrismaAdminPasswordRecoveryClient extends PrismaRawQueryClient {
  $transaction<T>(
    work: (transaction: PrismaRawQueryClient) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}
export interface RecoverAdminPasswordInput {
  workspaceSlug: string;
  email: string;
  password: string;
  now?: Date;
}
export interface AdminPasswordRecoveryCliOptions {
  database: AdminPasswordRecoveryDatabase;
  passwordHasher: PasswordHasher;
  env: Record<string, string | undefined>;
  promptEmail?: () => Promise<string>;
  promptPassword?: () => Promise<string>;
  write: (message: string) => void;
}
const WORKSPACE_ENV = "AUTH_RECOVERY_WORKSPACE_SLUG";
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
function normalizeWorkspaceSlug(workspaceSlug: string): string {
  const normalized = workspaceSlug.trim();
  if (!normalized) throw new Error("WORKSPACE_SLUG_REQUIRED");
  return normalized;
}
async function findActiveAdminTarget(
  database: AdminPasswordRecoveryExecutor,
  workspaceSlug: string,
  emailNormalized: string,
): Promise<{ userId: string; workspaceId: string }> {
  const matches = await database.query<{
    userId: string;
    workspaceId: string;
  }>(
    'SELECT u."id" AS "userId", u."workspaceId" AS "workspaceId" FROM "Workspace" w JOIN "User" u ON u."workspaceId" = w."id" JOIN "TeamMembership" m ON m."workspaceId" = u."workspaceId" AND m."userId" = u."id" JOIN "UserPasswordCredential" c ON c."workspaceId" = u."workspaceId" AND c."userId" = u."id" WHERE w."slug" = $1 AND u."emailNormalized" = $2 AND u."status" = \'ACTIVE\' AND m."role" = \'ADMIN\' LIMIT 2',
    [workspaceSlug, emailNormalized],
  );
  if (matches.length !== 1) throw new Error("ACTIVE_ADMIN_NOT_FOUND");
  return matches[0]!;
}
export async function assertActiveAdminPasswordRecoveryAllowed(
  database: AdminPasswordRecoveryDatabase,
  workspaceSlug: string,
  email: string,
): Promise<void> {
  await findActiveAdminTarget(
    database,
    normalizeWorkspaceSlug(workspaceSlug),
    normalizeEmail(email),
  );
}
export async function recoverAdminPassword(
  database: AdminPasswordRecoveryDatabase,
  passwordHasher: PasswordHasher,
  input: RecoverAdminPasswordInput,
): Promise<{ userId: string }> {
  const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
  const emailNormalized = normalizeEmail(input.email);
  if (input.password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
  await findActiveAdminTarget(database, workspaceSlug, emailNormalized);
  const passwordHash = await passwordHasher.hash(input.password);
  const completedAt = input.now ?? new Date();
  const auditId = randomUUID();
  return database.transaction(async (transaction) => {
    const target = await findActiveAdminTarget(
      transaction,
      workspaceSlug,
      emailNormalized,
    );
    const updated = await transaction.query<{ userId: string }>(
      'UPDATE "UserPasswordCredential" SET "passwordHash" = $1, "updatedAt" = $2 WHERE "workspaceId" = $3 AND "userId" = $4 RETURNING "userId"',
      [passwordHash, completedAt, target.workspaceId, target.userId],
    );
    if (updated.length !== 1) throw new Error("ACTIVE_ADMIN_NOT_FOUND");
    await transaction.query(
      'INSERT INTO "AuditEvent" ("id", "workspaceId", "actorId", "actorRole", "action", "entityType", "entityId", "changedFieldNames", "outcome", "createdAt") VALUES ($1, $2, NULL, NULL, \'ADMIN_PASSWORD_RECOVERED\', \'User\', $3, ARRAY[\'passwordCredential\']::text[], \'SUCCESS\', $4)',
      [auditId, target.workspaceId, target.userId, completedAt],
    );
    return { userId: target.userId };
  });
}
export async function runAdminPasswordRecoveryCli(
  options: AdminPasswordRecoveryCliOptions,
): Promise<{ userId: string }> {
  const workspaceSlug = normalizeWorkspaceSlug(
    options.env[WORKSPACE_ENV] ?? "",
  );
  const email = options.promptEmail
    ? await options.promptEmail()
    : (() => {
        throw new Error("SAFE_TERMINAL_REQUIRED");
      })();
  const emailNormalized = normalizeEmail(email);
  await assertActiveAdminPasswordRecoveryAllowed(
    options.database,
    workspaceSlug,
    emailNormalized,
  );
  let password = options.promptPassword
    ? await options.promptPassword()
    : (() => {
        throw new Error("SAFE_TERMINAL_REQUIRED");
      })();
  try {
    const result = await recoverAdminPassword(
      options.database,
      options.passwordHasher,
      {
        workspaceSlug,
        email: emailNormalized,
        password,
      },
    );
    options.write(
      "Admin password recovery completed and audit event recorded. No other records were deleted.\n",
    );
    return result;
  } finally {
    password = "";
  }
}
export function createPrismaAdminPasswordRecoveryDatabase(
  prisma: PrismaAdminPasswordRecoveryClient,
): AdminPasswordRecoveryDatabase {
  const executor = (
    client: PrismaRawQueryClient,
  ): AdminPasswordRecoveryExecutor => ({
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
      work: (transaction: AdminPasswordRecoveryExecutor) => Promise<T>,
    ): Promise<T> {
      return prisma.$transaction((transaction) => work(executor(transaction)), {
        isolationLevel: "Serializable",
      });
    },
  };
}
