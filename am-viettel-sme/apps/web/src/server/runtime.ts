import { PrismaPg } from "@prisma/adapter-pg";
import {
  Argon2idPasswordHasher,
  HttpAuthGuard,
  LocalAuthAdapter,
} from "@am-sme/auth";
import { loadEnvConfig } from "@am-sme/config";
import { PrismaAuthRepository } from "@am-sme/database/auth";
import { PrismaClient } from "@am-sme/database/client";
import {
  createPrismaImportDatabase,
  ImportCommitRepository,
} from "@am-sme/database/import-commit";
import { ImportPreviewService } from "@am-sme/database/import-workflow";
import {
  createPrismaLeadWorkspaceDatabase,
  LeadWorkspaceRepository,
} from "@am-sme/database/lead-workspace";
import { TaskRepository } from "@am-sme/database/tasks";
import { InMemoryImportApi } from "./import-api.js";
import { WorkspaceOperationsHub } from "./operations-hub.js";
import type { ApiServices } from "./http-api.js";

let singleton: ApiServices | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`CONFIG_${name}_REQUIRED`);
  return value;
}

function positiveIntegerEnv(name: string): number {
  const value = Number(requiredEnv(name));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`CONFIG_${name}_INVALID`);
  return value;
}

export function getApiServices(): ApiServices {
  if (singleton) return singleton;
  const environment = loadEnvConfig(process.env);
  const appEnv = environment.appEnv;
  const databaseUrl = environment.databaseUrl;
  const appOrigin = new URL(requiredEnv("APP_ORIGIN"));
  if (appEnv === "staging" && appOrigin.protocol !== "https:")
    throw new Error("STAGING_REQUIRES_HTTPS_ORIGIN");
  if (
    appEnv === "local" &&
    (appOrigin.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(appOrigin.hostname))
  )
    throw new Error("LOCAL_APP_ORIGIN_MUST_BE_HTTP_LOOPBACK");
  const invitationTtlMs = positiveIntegerEnv("AUTH_INVITATION_TTL_MS");
  const sessionTtlMs = positiveIntegerEnv("AUTH_SESSION_TTL_MS");
  if (sessionTtlMs < 1000)
    throw new Error("CONFIG_AUTH_SESSION_TTL_MS_INVALID");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  const auth = new LocalAuthAdapter({
    repository: new PrismaAuthRepository(prisma),
    passwordHasher: new Argon2idPasswordHasher(),
    invitationBaseUrl: new URL("/invite/accept", appOrigin).toString(),
    invitationTtlMs,
    sessionTtlMs,
  });
  const leadDb = createPrismaLeadWorkspaceDatabase(prisma);
  const commitRepo = new ImportCommitRepository(
    createPrismaImportDatabase(prisma),
  );
  const previewService = new ImportPreviewService(commitRepo);
  singleton = {
    auth,
    guard: new HttpAuthGuard(auth, { secure: appEnv === "staging" }),
    leads: new LeadWorkspaceRepository(leadDb),
    tasks: new TaskRepository(leadDb),
    imports: new InMemoryImportApi(previewService),
    db: leadDb,
    operations: new WorkspaceOperationsHub(),
    sessionCookie: {
      secure: appEnv === "staging",
      maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
    },
  };
  return singleton;
}

export function resetRuntimeForTests(): void {
  singleton?.imports.dispose();
  singleton = null;
}
