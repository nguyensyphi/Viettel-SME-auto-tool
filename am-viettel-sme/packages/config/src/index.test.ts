import { describe, expect, it } from "vitest";
import { loadEnvConfig } from "./index.js";

const validLocalEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://am:local@localhost:5432/am_sme",
  REDIS_URL: "redis://localhost:6379/0",
  PUBLIC_SIGNUP_ENABLED: "false",
  DATA_MODE: "synthetic",
  ZALO_SEND_MODE: "disabled",
};

describe("loadEnvConfig", () => {
  it("loads local synthetic-data config with sending disabled", () => {
    const config = loadEnvConfig(validLocalEnv);

    expect(config.appEnv).toBe("local");
    expect(config.publicSignupEnabled).toBe(false);
    expect(config.dataMode).toBe("synthetic");
    expect(config.zaloSendMode).toBe("disabled");
  });

  it("rejects public self-signup even if a deployment tries to enable it", () => {
    expect(() =>
      loadEnvConfig({ ...validLocalEnv, PUBLIC_SIGNUP_ENABLED: "true" }),
    ).toThrow(/PUBLIC_SIGNUP_ENABLED/);
  });

  it("requires an explicit retention period outside local development", () => {
    expect(() =>
      loadEnvConfig({ ...validLocalEnv, APP_ENV: "staging" }),
    ).toThrow(/DATA_RETENTION_DAYS/);
  });

  it("accepts staging only with an explicit bounded retention period", () => {
    const config = loadEnvConfig({
      ...validLocalEnv,
      APP_ENV: "staging",
      DATA_RETENTION_DAYS: "365",
    });

    expect(config.appEnv).toBe("staging");
    expect(config.dataRetentionDays).toBe(365);
  });

  it("rejects a retention period outside the supported bounds", () => {
    expect(() =>
      loadEnvConfig({
        ...validLocalEnv,
        APP_ENV: "staging",
        DATA_RETENTION_DAYS: "0",
      }),
    ).toThrow(/DATA_RETENTION_DAYS/);
  });

  it("requires an approval reference for an approved test dataset", () => {
    expect(() =>
      loadEnvConfig({ ...validLocalEnv, DATA_MODE: "approved_test" }),
    ).toThrow(/TEST_DATA_APPROVAL_ID/);
  });

  it("accepts an approved test dataset only with its recorded approval reference", () => {
    const config = loadEnvConfig({
      ...validLocalEnv,
      DATA_MODE: "approved_test",
      TEST_DATA_APPROVAL_ID: "pilot-approval-001",
    });

    expect(config.dataMode).toBe("approved_test");
    expect(config.testDataApprovalId).toBe("pilot-approval-001");
  });

  it("rejects real Zalo sending mode in every P0 environment", () => {
    expect(() =>
      loadEnvConfig({ ...validLocalEnv, ZALO_SEND_MODE: "live" }),
    ).toThrow(/ZALO_SEND_MODE/);
  });

  it("rejects production because P0 is local/staging only", () => {
    expect(() =>
      loadEnvConfig({ ...validLocalEnv, APP_ENV: "production" }),
    ).toThrow(/APP_ENV/);
  });
});
