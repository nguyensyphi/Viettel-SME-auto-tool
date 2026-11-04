import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Argon2idPasswordHasher } from "@am-sme/auth";
import { PrismaClient } from "../generated/client/index.js";
import {
  createPrismaAdminBootstrapDatabase,
  runBootstrapAdminCli,
} from "../src/admin-bootstrap.js";
import {
  promptAdminEmailFromTty,
  promptAdminPasswordMaskedFromTty,
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
  "ADMIN_BOOTSTRAP_ALREADY_COMPLETED",
  "ADMIN_BOOTSTRAP_STATE_CONFLICT",
  "WORKSPACE_NOT_FOUND",
  "SAFE_TERMINAL_REQUIRED",
  "SAFE_TERMINAL_INPUT_ENDED",
  "SAFE_TERMINAL_INPUT_INTERRUPTED",
  "SAFE_TERMINAL_INPUT_INVALID",
  "INVALID_EMAIL",
  "PASSWORD_TOO_SHORT",
]);

function assertSafeEnvironment(): string {
  if (process.env.APP_ENV !== "local" && process.env.APP_ENV !== "staging") {
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
  if (
    process.env.APP_ENV === "local" &&
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  ) {
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
  if (error instanceof Error && safeCodes.has(error.message))
    return error.message;
  return "BOOTSTRAP_FAILED";
}

function loadProjectEnvironment(): void {
  const emailFromProcess = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
  let passwordFromProcess = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  if (emailFromProcess === undefined) {
    delete process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
  } else {
    process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL = emailFromProcess;
  }
  if (passwordFromProcess === undefined) {
    delete process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
  } else {
    process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD = passwordFromProcess;
  }
  passwordFromProcess = undefined;
}

async function main(): Promise<void> {
  loadProjectEnvironment();
  const databaseUrl = assertSafeEnvironment();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await runBootstrapAdminCli({
      database: createPrismaAdminBootstrapDatabase(
        prisma as unknown as Parameters<
          typeof createPrismaAdminBootstrapDatabase
        >[0],
      ),
      passwordHasher: new Argon2idPasswordHasher(),
      env: process.env,
      promptEmail: () => promptAdminEmailFromTty(),
      promptPassword: () => promptAdminPasswordMaskedFromTty(),
      write: (message) => process.stdout.write(message),
    });
  } finally {
    delete process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Initial Admin bootstrap failed (${safeErrorCode(error)}). Credentials were not logged.`,
  );
  process.exitCode = 1;
});
