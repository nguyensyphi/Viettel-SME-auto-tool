import { z } from "zod";

const envSchema = z
  .object({
    APP_ENV: z.enum(["local", "staging"]),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    PUBLIC_SIGNUP_ENABLED: z.literal("false"),
    DATA_MODE: z.enum(["synthetic", "approved_test"]),
    TEST_DATA_APPROVAL_ID: z.string().trim().min(1).optional(),
    DATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
    ZALO_SEND_MODE: z.enum(["disabled", "sandbox"]),
  })
  .superRefine((env, context) => {
    if (env.APP_ENV === "staging" && env.DATA_RETENTION_DAYS === undefined) {
      context.addIssue({
        code: "custom",
        path: ["DATA_RETENTION_DAYS"],
        message: "must be explicitly configured in staging",
      });
    }

    if (env.DATA_MODE === "approved_test" && !env.TEST_DATA_APPROVAL_ID) {
      context.addIssue({
        code: "custom",
        path: ["TEST_DATA_APPROVAL_ID"],
        message: "is required for an approved test dataset",
      });
    }
  });

export interface AppEnvConfig {
  appEnv: "local" | "staging";
  databaseUrl: string;
  redisUrl: string;
  publicSignupEnabled: false;
  dataMode: "synthetic" | "approved_test";
  testDataApprovalId?: string;
  dataRetentionDays?: number;
  zaloSendMode: "disabled" | "sandbox";
}

export function loadEnvConfig(
  input: Record<string, string | undefined>,
): AppEnvConfig {
  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${fieldErrors}`);
  }

  const env = parsed.data;
  return {
    appEnv: env.APP_ENV,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    publicSignupEnabled: false,
    dataMode: env.DATA_MODE,
    ...(env.TEST_DATA_APPROVAL_ID === undefined
      ? {}
      : { testDataApprovalId: env.TEST_DATA_APPROVAL_ID }),
    ...(env.DATA_RETENTION_DAYS === undefined
      ? {}
      : { dataRetentionDays: env.DATA_RETENTION_DAYS }),
    zaloSendMode: env.ZALO_SEND_MODE,
  };
}

export * from "./kill-switch.js";
export * from "./circuit-breaker.js";
export * from "./rate-limiter.js";

