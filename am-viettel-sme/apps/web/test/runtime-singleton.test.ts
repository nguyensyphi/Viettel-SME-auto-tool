import { describe, expect, it } from "vitest";
import { getApiServices } from "../src/server/runtime.js";

describe("Task 1: Runtime session stability and global singleton", () => {
  it("persists authenticated sessions across multiple calls to getApiServices", async () => {
    process.env.DEMO_MODE = "true";
    const services1 = getApiServices();
    const loginResult = await services1.auth.authenticatePassword({
      workspaceId: "viettel-sme",
      email: "admin@viettel-sme.local",
      password: "admin",
    });
    expect(loginResult).not.toBeNull();
    const token = loginResult?.sessionToken ?? "";
    expect(token).toBeTruthy();

    // Verify session in services1
    const principal1 = await services1.auth.resolveSession(token);
    expect(principal1).not.toBeNull();

    // Re-acquire services (simulating another API route invocation or reload)
    const services2 = getApiServices();
    expect(services2).toBe(services1);

    const principal2 = await services2.auth.resolveSession(token);
    expect(principal2).not.toBeNull();
    expect(principal2?.userId).toBe(principal1?.userId);
  });
});
