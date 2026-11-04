import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Argon2idPasswordHasher } from "@am-sme/auth";
import { PrismaClient } from "../generated/client/index.js";
import {
  createPrismaAdminPasswordRecoveryDatabase,
  runAdminPasswordRecoveryCli,
} from "../src/admin-password-recovery.js";
import {
  promptRecoveryAdminEmailFromTty,
  promptRecoveryAdminPasswordMaskedFromTty,
} from "../src/admin-bootstrap-terminal.js";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(packageRoot, "../..");
const envPath = resolve(projectRoot, ".env");
const safeCodes = new Set([
  "APP_ENV_NOT_ALLOWED",
  "DATABASE_URL_REQUIRED",
  "LOCAL_DATABASE_MUST_USE_LOOPBACK",
  "PUBLIC_SIGNUP_MUST_REMAIN_DISABLED",
  "DATA_MODE_NOT_ALLOWED",
  "TEST_DATA_APPROVAL_REQUIRED",
  "ZALO_SENDING_MUST_REMAIN_DISABLED",
  "WORKSPACE_SLUG_REQUIRED",
  "ACTIVE_ADMIN_NOT_FOUND",
  "SAFE_TERMINAL_REQUIRED",
  "SAFE_TERMINAL_INPUT_ENDED",
  "SAFE_TERMINAL_INPUT_INTERRUPTED",
  "SAFE_TERMINAL_INPUT_INVALID",
  "INVALID_EMAIL",
  "PASSWORD_TOO_SHORT",
]);
function assertSafeEnvironment(): string {
  if (process.env.APP_ENV !== "local") {
    throw new Error("APP_ENV_NOT_ALLOWED");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("LOCAL_DATABASE_MUST_USE_LOOPBACK");
  }
  if (process.env.PUBLIC_SIGNUP_ENABLED !== "false") {
    throw new Error("PUBLIC_SIGNUP_MUST_REMAIN_DISABLED");
  }
  if (!["synthetic", "approved_test"].includes(process.env.DATA_MODE ?? "")) {
    throw new Error("DATA_MODE_NOT_ALLOWED");
  }
  if (
    process.env.DATA_MODE === "approved_test" &&
    !process.env.TEST_DATA_APPROVAL_ID?.trim()
  ) {
    throw new Error("TEST_DATA_APPROVAL_REQUIRED");
  }
  if (process.env.ZALO_SEND_MODE !== "disabled") {
    throw new Error("ZALO_SENDING_MUST_REMAIN_DISABLED");
  }
  return databaseUrl;
}
function safeErrorCode(error: unknown): string {
  if (error instanceof Error && safeCodes.has(error.message)) {
    return error.message;
  }
  return "ADMIN_PASSWORD_RECOVERY_FAILED";
}
function loadProjectEnvironment(): void {
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
async function main(): Promise<void> {
  loadProjectEnvironment();
  const databaseUrl = assertSafeEnvironment();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await runAdminPasswordRecoveryCli({
      database: createPrismaAdminPasswordRecoveryDatabase(
        prisma as unknown as Parameters<
          typeof createPrismaAdminPasswordRecoveryDatabase
        >[0],
      ),
      passwordHasher: new Argon2idPasswordHasher(),
      env: process.env,
      promptEmail: () => promptRecoveryAdminEmailFromTty(),
      promptPassword: () => promptRecoveryAdminPasswordMaskedFromTty(),
      write: (message) => process.stdout.write(message),
    });
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(
    `Admin password recovery stopped (${safeErrorCode(error)}). No credential values were logged.`,
  );
  process.exitCode = 1;
});
