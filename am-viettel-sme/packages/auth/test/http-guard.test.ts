import { describe, expect, it } from "vitest";
import {
  ApiAuthError,
  clearSessionCookie,
  formatSessionCookie,
  HttpAuthGuard,
  requireLeadAccess,
  requireRole,
} from "../src/http-guard.js";
import type { AuthPrincipal } from "../src/access-control.js";
import type { AuthAdapter } from "../src/index.js";

const principal: AuthPrincipal = {
  userId: "am-1",
  workspaceId: "ws-1",
  role: "AM",
  teamId: "team-1",
};
const token = "a-opaque-session-token-with-32-bytes-minimum";

function makeGuard(
  resolveSession: (token: string) => Promise<AuthPrincipal | null>,
) {
  return new HttpAuthGuard({ resolveSession });
}

describe("HTTP/API authentication guard", () => {
  it("accepts the provider-neutral adapter contract without local password methods", async () => {
    const oidcLikeAdapter: AuthAdapter = {
      resolveSession: async () => principal,
      revokeSession: async () => undefined,
    };
    expect("authenticatePassword" in oidcLikeAdapter).toBe(false);
    const guard = new HttpAuthGuard(oidcLikeAdapter);
    await expect(
      guard.authenticate({ headers: { cookie: `am_sme_session=${token}` } }),
    ).resolves.toEqual(principal);
  });

  it("resolves only the HttpOnly session cookie through the AuthAdapter boundary", async () => {
    const seen: string[] = [];
    const guard = makeGuard(async (sessionToken) => {
      seen.push(sessionToken);
      return principal;
    });
    const resolved = await guard.authenticate({
      headers: { cookie: `theme=light; am_sme_session=${token}` },
    });
    expect(resolved).toEqual(principal);
    expect(seen).toEqual([token]);
    const stagingGuard = new HttpAuthGuard(
      { resolveSession: async () => principal },
      { secure: true },
    );
    await expect(
      stagingGuard.authenticate({
        headers: { cookie: `__Host-am_sme_session=${token}` },
      }),
    ).resolves.toEqual(principal);
  });

  it("rejects missing, duplicate, malformed, invalid or deactivated-user sessions with 401", async () => {
    const guard = makeGuard(async () => null);
    await expect(guard.authenticate({ headers: {} })).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHENTICATED",
    });
    await expect(
      guard.authenticate({ headers: { authorization: `Bearer ${token}` } }),
    ).rejects.toBeInstanceOf(ApiAuthError);
    await expect(
      guard.authenticate({
        headers: { cookie: `am_sme_session=${token}; am_sme_session=${token}` },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      guard.authenticate({ headers: { cookie: `am_sme_session=${token}` } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("enforces role checks and returns 404 for cross-workspace lead IDs", () => {
    expect(() => requireRole(principal, ["ADMIN"])).toThrow("FORBIDDEN");
    expect(() =>
      requireRole({ ...principal, role: "ADMIN" }, ["ADMIN"]),
    ).not.toThrow();
    expect(() =>
      requireLeadAccess(
        principal,
        { workspaceId: "ws-2", ownerUserId: "am-1", ownerTeamId: "team-1" },
        "read",
      ),
    ).toThrow("NOT_FOUND");
  });

  it("formats HttpOnly, SameSite cookies and enforces Secure in staging mode", () => {
    const localCookie = formatSessionCookie(token, {
      secure: false,
      maxAgeSeconds: 3600,
    });
    expect(localCookie).toContain("HttpOnly");
    expect(localCookie).toContain("SameSite=Lax");
    expect(localCookie).not.toContain("Secure");
    expect(localCookie).not.toContain("Domain=");

    const stagingCookie = formatSessionCookie(token, {
      secure: true,
      maxAgeSeconds: 3600,
    });
    expect(stagingCookie).toMatch(/^__Host-am_sme_session=/);
    expect(stagingCookie).toContain("; Secure");
    expect(stagingCookie).toContain("Path=/");
    expect(clearSessionCookie(true)).toContain("Max-Age=0; Secure");
  });
});
