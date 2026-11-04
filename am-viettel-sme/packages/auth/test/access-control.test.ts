import { describe, expect, it } from "vitest";
import {
  authorizeLeadAccess,
  canManageUsers,
  canReadAudit,
  type AuthPrincipal,
} from "../src/access-control.js";

const am: AuthPrincipal = {
  userId: "am-1",
  workspaceId: "ws-1",
  role: "AM",
  teamId: "team-1",
};
const manager: AuthPrincipal = {
  userId: "manager-1",
  workspaceId: "ws-1",
  role: "MANAGER",
  teamId: "team-1",
};
const admin: AuthPrincipal = {
  userId: "admin-1",
  workspaceId: "ws-1",
  role: "ADMIN",
  teamId: null,
};
const ownLead = {
  workspaceId: "ws-1",
  ownerUserId: "am-1",
  ownerTeamId: "team-1",
};
const anotherAmLead = {
  workspaceId: "ws-1",
  ownerUserId: "am-2",
  ownerTeamId: "team-1",
};

describe("server-side access control", () => {
  it("lets AM read and update only leads assigned to that AM", () => {
    expect(authorizeLeadAccess(am, ownLead, "read").allowed).toBe(true);
    expect(authorizeLeadAccess(am, ownLead, "update").allowed).toBe(true);
    expect(authorizeLeadAccess(am, anotherAmLead, "read")).toEqual({
      allowed: false,
      reason: "LEAD_OUT_OF_SCOPE",
    });
  });

  it("lets a manager access leads in the manager's team but not another team", () => {
    expect(authorizeLeadAccess(manager, anotherAmLead, "read").allowed).toBe(
      true,
    );
    expect(
      authorizeLeadAccess(
        manager,
        { ...anotherAmLead, ownerTeamId: "team-2" },
        "update",
      ),
    ).toEqual({ allowed: false, reason: "LEAD_OUT_OF_SCOPE" });
  });

  it("rejects cross-workspace IDs even for administrators", () => {
    expect(
      authorizeLeadAccess(admin, { ...ownLead, workspaceId: "ws-2" }, "read"),
    ).toEqual({ allowed: false, reason: "WORKSPACE_MISMATCH" });
  });

  it("grants user administration only to admins and audit read to managers/admins", () => {
    expect(canManageUsers(am)).toBe(false);
    expect(canManageUsers(manager)).toBe(false);
    expect(canManageUsers(admin)).toBe(true);
    expect(canReadAudit(am)).toBe(false);
    expect(canReadAudit(manager)).toBe(true);
    expect(canReadAudit(admin)).toBe(true);
    expect(canReadAudit(null)).toBe(false);
  });

  it("denies unauthenticated requests and prevents manager access without a team", () => {
    expect(authorizeLeadAccess(null, ownLead, "read")).toEqual({
      allowed: false,
      reason: "UNAUTHENTICATED",
    });
    expect(
      authorizeLeadAccess({ ...manager, teamId: null }, anotherAmLead, "read"),
    ).toEqual({ allowed: false, reason: "LEAD_OUT_OF_SCOPE" });
  });
});
