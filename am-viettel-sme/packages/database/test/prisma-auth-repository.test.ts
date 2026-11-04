import { describe, expect, it } from "vitest";
import type { AuthPrincipal } from "@am-sme/auth";
import type { PrismaClient } from "../generated/client/index.js";
import { PrismaAuthRepository } from "../src/prisma-auth-repository.js";

const admin: AuthPrincipal = {
  userId: "admin-1",
  workspaceId: "ws-1",
  role: "ADMIN",
  teamId: null,
};

function createHarness() {
  const auditEvents: Record<string, unknown>[] = [];
  const state: {
    userResult: Record<string, unknown> | null;
    membershipResult: Record<string, unknown> | null;
    sessionResult: Record<string, unknown> | null;
    claimedCount: number;
    transactions: number;
    credentialCreates: number;
  } = {
    userResult: null,
    membershipResult: {
      id: "membership-1",
      role: "AM",
      teamId: "team-1",
    },
    sessionResult: {
      id: "session-1",
      userId: "user-1",
      workspaceId: "ws-1",
    },
    claimedCount: 1,
    transactions: 0,
    credentialCreates: 0,
  };

  const tx = {
    user: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "user-1",
        ...data,
      }),
      findFirst: async () => state.userResult,
      updateMany: async () => ({ count: state.claimedCount }),
    },
    teamMembership: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "membership-1",
        ...data,
      }),
      findFirst: async () => state.membershipResult,
      update: async () => ({}),
    },
    userPasswordCredential: {
      create: async () => {
        state.credentialCreates += 1;
        return {};
      },
    },
    authSession: {
      create: async () => ({}),
      findFirst: async () => state.sessionResult,
      update: async () => ({}),
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        return data;
      },
    },
  };
  const client = {
    authSession: {
      findFirst: async () => state.sessionResult,
    },
    $transaction: async <T>(
      callback: (transaction: typeof tx) => Promise<T>,
    ) => {
      state.transactions += 1;
      return callback(tx);
    },
  } as unknown as PrismaClient;

  return { repository: new PrismaAuthRepository(client), auditEvents, state };
}

describe("PrismaAuthRepository audit transactions", () => {
  it("audits an invitation under the creating admin in the same transaction", async () => {
    const { repository, auditEvents, state } = createHarness();
    await repository.createInvitation({
      workspaceId: admin.workspaceId,
      emailNormalized: "am@example.invalid",
      role: "AM",
      teamId: "team-1",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-11-03T00:00:00Z"),
      actor: admin,
      createdAt: new Date("2026-11-02T00:00:00Z"),
    });

    expect(state.transactions).toBe(1);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      workspaceId: "ws-1",
      actorId: "admin-1",
      actorRole: "ADMIN",
      action: "USER_INVITED",
      entityType: "User",
      entityId: "user-1",
      outcome: "SUCCESS",
    });
    expect(auditEvents[0]?.changedFieldNames).not.toContain("emailNormalized");
  });

  it("audits accepted invitations as the now-active invited user", async () => {
    const { repository, auditEvents, state } = createHarness();
    state.userResult = {
      id: "user-1",
      workspaceId: "ws-1",
      membership: { role: "AM", teamId: "team-1" },
    };
    const principal = await repository.consumeInvitation({
      tokenHash: "b".repeat(64),
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$salt$hash",
      displayName: "Synthetic AM",
      acceptedAt: new Date("2026-11-02T00:00:00Z"),
    });

    expect(principal).toEqual({
      userId: "user-1",
      workspaceId: "ws-1",
      role: "AM",
      teamId: "team-1",
    });
    expect(auditEvents[0]).toMatchObject({
      actorId: "user-1",
      actorRole: "AM",
      action: "INVITATION_ACCEPTED",
      entityType: "User",
    });
  });

  it("does not create credential or audit when the atomic invitation claim loses a replay race", async () => {
    const { repository, auditEvents, state } = createHarness();
    state.userResult = {
      id: "user-1",
      workspaceId: "ws-1",
      membership: { role: "AM", teamId: "team-1" },
    };
    state.claimedCount = 0;

    const result = await repository.consumeInvitation({
      tokenHash: "d".repeat(64),
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$salt$hash",
      displayName: "Synthetic AM",
      acceptedAt: new Date("2026-11-02T00:00:00Z"),
    });
    expect(result).toBeNull();
    expect(state.credentialCreates).toBe(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("does not resolve a session whose user was deactivated", async () => {
    const { repository, state } = createHarness();
    state.sessionResult = {
      id: "session-1",
      userId: "user-1",
      workspaceId: "ws-1",
      user: {
        status: "DEACTIVATED",
        membership: { role: "AM", teamId: "team-1" },
      },
    };
    await expect(
      repository.findActiveSession({
        tokenHash: "e".repeat(64),
        now: new Date("2026-11-02T00:00:00Z"),
      }),
    ).resolves.toBeNull();
  });

  it("audits session create and revoke, and admin role changes", async () => {
    const { repository, auditEvents, state } = createHarness();
    state.userResult = {
      id: "user-1",
      workspaceId: "ws-1",
      status: "ACTIVE",
      membership: { role: "AM", teamId: "team-1" },
    };
    await repository.createSession({
      principal: {
        userId: "user-1",
        workspaceId: "ws-1",
        role: "AM",
        teamId: "team-1",
      },
      tokenHash: "c".repeat(64),
      expiresAt: new Date("2026-11-03T00:00:00Z"),
      createdAt: new Date("2026-11-02T00:00:00Z"),
    });
    expect(auditEvents.at(-1)).toMatchObject({
      action: "SESSION_CREATED",
      actorId: "user-1",
    });

    await repository.revokeSession({
      tokenHash: "c".repeat(64),
      revokedAt: new Date("2026-11-02T01:00:00Z"),
    });
    expect(auditEvents.at(-1)).toMatchObject({
      action: "SESSION_REVOKED",
      actorId: "user-1",
    });

    await repository.changeRole({
      actor: admin,
      targetUserId: "user-1",
      role: "MANAGER",
      teamId: "team-1",
      changedAt: new Date("2026-11-02T02:00:00Z"),
    });
    expect(auditEvents.at(-1)).toMatchObject({
      action: "MEMBERSHIP_ROLE_CHANGED",
      actorId: "admin-1",
      actorRole: "ADMIN",
      entityType: "TeamMembership",
    });
    expect(state.transactions).toBe(3);
  });
});
