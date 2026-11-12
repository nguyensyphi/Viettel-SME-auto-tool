// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";
import { WorkspaceOperationsHub } from "../src/server/operations-hub.js";
import { AccountsView } from "../src/ui/accounts-view.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const am = {
  userId: "am-ops-01",
  workspaceId: "ws-mod-ops-004",
  role: "AM" as const,
  teamId: "team-ops-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("MOD-OPS-004 — Operations Control Center APIs & Kill Switch / Circuit Breaker UI", () => {
  it("exposes GET /api/v1/ops/status, POST /api/v1/ops/kill-switch, and POST /api/v1/social-accounts/:id/reset-circuit", async () => {
    const auth = {
      resolveSession: vi.fn(async (tok) => (tok === session ? am : null)),
      authenticatePassword: vi.fn() as any,
      acceptInvitation: vi.fn() as any,
      createInvitation: vi.fn() as any,
      changeMembershipRole: vi.fn() as any,
      revokeSession: vi.fn() as any,
    };

    const operations = new WorkspaceOperationsHub();
    const services: ApiServices = {
      auth,
      guard: new HttpAuthGuard(auth as any),
      leads: {} as any,
      tasks: {} as any,
      imports: new InMemoryImportApi({} as any),
      db: {} as any,
      sessionCookie: { secure: false, maxAgeSeconds: 3600 },
      operations,
    };

    // 1. Check initial ops status
    const statusRes1 = await handleApiRequest(
      new Request("http://localhost/api/v1/ops/status", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "ops", "status"],
      services,
    );
    expect(statusRes1.status).toBe(200);
    const statusBody1 = (await statusRes1.json()) as any;
    expect(statusBody1.killSwitch.active).toBe(false);

    // 2. Activate Kill Switch
    const activateRes = await handleApiRequest(
      new Request("http://localhost/api/v1/ops/kill-switch", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          active: true,
          reason: "Tạm dừng kiểm tra giao diện Zalo Web",
        }),
      }),
      ["api", "v1", "ops", "kill-switch"],
      services,
    );
    expect(activateRes.status).toBe(200);
    const activateBody = (await activateRes.json()) as any;
    expect(activateBody.killSwitch.active).toBe(true);
    expect(activateBody.killSwitch.reason).toBe(
      "Tạm dừng kiểm tra giao diện Zalo Web",
    );

    // 3. Deactivate Kill Switch
    const resumeRes = await handleApiRequest(
      new Request("http://localhost/api/v1/ops/kill-switch", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          active: false,
        }),
      }),
      ["api", "v1", "ops", "kill-switch"],
      services,
    );
    expect(resumeRes.status).toBe(200);
    const resumeBody = (await resumeRes.json()) as any;
    expect(resumeBody.killSwitch.active).toBe(false);

    // 4. Reset Circuit Breaker on an account
    const resetRes = await handleApiRequest(
      new Request(
        "http://localhost/api/v1/social-accounts/zalo-dian-am01/reset-circuit",
        {
          method: "POST",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ platform: "ZALO" }),
        },
      ),
      ["api", "v1", "social-accounts", "zalo-dian-am01", "reset-circuit"],
      services,
    );
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as any;
    expect(resetBody.circuitState).toBe("CLOSED");
  });

  it("renders Kill Switch & Circuit Breaker controls in AccountsView and triggers pause/resume/reset callbacks", async () => {
    const onToggleKillSwitch = vi.fn(async () => {});
    const onResetCircuit = vi.fn(async () => {});

    render(
      createElement(AccountsView, {
        data: {
          items: [
            {
              accountId: "zalo-dian-am01",
              platform: "ZALO",
              status: "CONNECTED",
              profileDir: "storage/browser_profiles/zalo-dian-am01",
              circuitState: "OPEN",
            },
          ],
          killSwitch: {
            active: false,
          },
        },
        onToggleKillSwitch,
        onResetCircuit,
      }),
    );

    // 1. Trigger Kill Switch activation
    fireEvent.click(
      screen.getByRole("button", { name: /Kích hoạt Dừng khẩn cấp/i }),
    );
    await vi.waitFor(() => {
      expect(onToggleKillSwitch).toHaveBeenCalledWith(
        true,
        expect.any(String),
      );
    });

    // 2. Trigger Circuit Breaker reset for OPEN account
    fireEvent.click(
      screen.getByRole("button", { name: /Khôi phục Circuit/i }),
    );
    await vi.waitFor(() => {
      expect(onResetCircuit).toHaveBeenCalledWith("zalo-dian-am01", "ZALO");
    });
  });
});

