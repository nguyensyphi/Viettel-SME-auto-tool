import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LocalAuthAdapter,
  type AuthPrincipal,
  type AuthRepository,
  type PasswordHasher,
} from "../src/index.js";

const now = new Date("2026-11-02T10:00:00.000Z");
const admin: AuthPrincipal = {
  userId: "admin-1",
  workspaceId: "ws-1",
  role: "ADMIN",
  teamId: null,
};
const rawInviteToken = "invite-token-one-time-test-value";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

class FakePasswordHasher implements PasswordHasher {
  hashCalls = 0;

  async hash(password: string): Promise<string> {
    this.hashCalls += 1;
    return `test-hash:${password}`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return hash === `test-hash:${password}`;
  }
}

class MemoryAuthRepository implements AuthRepository {
  invitation: {
    userId: string;
    workspaceId: string;
    emailNormalized: string;
    role: "AM" | "MANAGER" | "ADMIN";
    teamId: string | null;
    tokenHash: string;
    expiresAt: Date;
    invitedByUserId: string;
    status: "INVITED" | "ACTIVE" | "DEACTIVATED";
    passwordHash?: string;
  } | null = null;
  readonly audit: Array<{ action: string; actorId: string | null }> = [];
  session: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null = null;

  async createInvitation(
    input: Parameters<AuthRepository["createInvitation"]>[0],
  ) {
    this.invitation = {
      userId: "user-1",
      workspaceId: input.workspaceId,
      emailNormalized: input.emailNormalized,
      role: input.role,
      teamId: input.teamId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      invitedByUserId: input.actor.userId,
      status: "INVITED",
    };
    this.audit.push({ action: "USER_INVITED", actorId: input.actor.userId });
    return "user-1";
  }

  async hasValidInvitation(input: { tokenHash: string; now: Date }) {
    return Boolean(
      this.invitation &&
      this.invitation.status === "INVITED" &&
      this.invitation.tokenHash === input.tokenHash &&
      this.invitation.expiresAt > input.now,
    );
  }

  async consumeInvitation(
    input: Parameters<AuthRepository["consumeInvitation"]>[0],
  ) {
    const invite = this.invitation;
    if (
      !invite ||
      invite.status !== "INVITED" ||
      invite.tokenHash !== input.tokenHash ||
      invite.expiresAt <= input.acceptedAt
    ) {
      return null;
    }
    invite.status = "ACTIVE";
    invite.passwordHash = input.passwordHash;
    this.audit.push({ action: "INVITATION_ACCEPTED", actorId: invite.userId });
    return {
      userId: invite.userId,
      workspaceId: invite.workspaceId,
      role: invite.role,
      teamId: invite.teamId,
    } satisfies AuthPrincipal;
  }

  async findPasswordCredential(
    input: Parameters<AuthRepository["findPasswordCredential"]>[0],
  ) {
    const invite = this.invitation;
    if (
      !invite ||
      invite.workspaceId !== input.workspaceId ||
      invite.emailNormalized !== input.emailNormalized ||
      invite.status !== "ACTIVE" ||
      !invite.passwordHash
    ) {
      return null;
    }
    return {
      principal: {
        userId: invite.userId,
        workspaceId: invite.workspaceId,
        role: invite.role,
        teamId: invite.teamId,
      } satisfies AuthPrincipal,
      passwordHash: invite.passwordHash,
    };
  }

  async createSession(input: Parameters<AuthRepository["createSession"]>[0]) {
    this.session = {
      tokenHash: input.tokenHash,
      userId: input.principal.userId,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
  }

  async findActiveSession(
    input: Parameters<AuthRepository["findActiveSession"]>[0],
  ) {
    const session = this.session;
    const invite = this.invitation;
    if (
      !session ||
      !invite ||
      invite.status !== "ACTIVE" ||
      session.userId !== invite.userId ||
      session.tokenHash !== input.tokenHash ||
      session.expiresAt <= input.now ||
      session.revokedAt !== null
    ) {
      return null;
    }
    return {
      userId: invite.userId,
      workspaceId: invite.workspaceId,
      role: invite.role,
      teamId: invite.teamId,
    } satisfies AuthPrincipal;
  }

  async revokeSession(input: Parameters<AuthRepository["revokeSession"]>[0]) {
    if (this.session?.tokenHash === input.tokenHash) {
      this.session.revokedAt = input.revokedAt;
    }
  }

  async changeRole(input: Parameters<AuthRepository["changeRole"]>[0]) {
    if (!this.invitation || this.invitation.userId !== input.targetUserId) {
      throw new Error("USER_NOT_FOUND");
    }
    this.invitation.role = input.role;
    this.invitation.teamId = input.teamId;
    this.audit.push({
      action: "MEMBERSHIP_ROLE_CHANGED",
      actorId: input.actor.userId,
    });
  }

  deactivateUser(): void {
    if (this.invitation) this.invitation.status = "DEACTIVATED";
  }
}

function createSubject(repository = new MemoryAuthRepository()) {
  const passwordHasher = new FakePasswordHasher();
  const adapter = new LocalAuthAdapter({
    repository,
    passwordHasher,
    invitationBaseUrl: "http://localhost:3000/accept-invitation",
    invitationTtlMs: 60 * 60 * 1000,
    sessionTtlMs: 60 * 60 * 1000,
    tokenFactory: () => rawInviteToken,
  });
  return { adapter, repository, passwordHasher };
}

describe("LocalAuthAdapter", () => {
  it("allows only an admin to issue an expiring, one-time invite and stores only its hash", async () => {
    const { adapter, repository } = createSubject();
    const invite = await adapter.createInvitation(
      admin,
      {
        email: "  AM.User@Example.invalid ",
        role: "AM",
        teamId: "team-1",
      },
      now,
    );

    expect(invite.url).toBe(
      `http://localhost:3000/accept-invitation?token=${rawInviteToken}`,
    );
    expect(invite.expiresAt).toEqual(new Date(now.getTime() + 60 * 60 * 1000));
    expect(repository.invitation?.emailNormalized).toBe(
      "am.user@example.invalid",
    );
    expect(repository.invitation?.tokenHash).toBe(sha256(rawInviteToken));
    expect(repository.invitation?.tokenHash).not.toBe(rawInviteToken);
    expect(repository.audit).toContainEqual({
      action: "USER_INVITED",
      actorId: admin.userId,
    });
  });

  it("rejects invitation creation by a non-admin", async () => {
    const { adapter } = createSubject();
    await expect(
      adapter.createInvitation(
        { ...admin, role: "MANAGER" },
        { email: "new@example.invalid", role: "AM", teamId: null },
        now,
      ),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("accepts a valid invite once and rejects replay", async () => {
    const { adapter, repository } = createSubject();
    await adapter.createInvitation(
      admin,
      { email: "new@example.invalid", role: "AM", teamId: "team-1" },
      now,
    );

    const principal = await adapter.acceptInvitation(
      {
        token: rawInviteToken,
        password: "correct horse battery",
        displayName: "AM User",
      },
      now,
    );
    expect(principal).toEqual({
      userId: "user-1",
      workspaceId: "ws-1",
      role: "AM",
      teamId: "team-1",
    });
    expect(repository.invitation?.status).toBe("ACTIVE");
    await expect(
      adapter.acceptInvitation(
        {
          token: rawInviteToken,
          password: "correct horse battery",
          displayName: "AM User",
        },
        now,
      ),
    ).rejects.toThrow("INVITATION_INVALID_OR_EXPIRED");
  });

  it("rejects an expired invitation", async () => {
    const { adapter, passwordHasher } = createSubject();
    await adapter.createInvitation(
      admin,
      { email: "expired@example.invalid", role: "AM", teamId: null },
      now,
    );
    await expect(
      adapter.acceptInvitation(
        {
          token: rawInviteToken,
          password: "correct horse battery",
          displayName: "AM User",
        },
        new Date(now.getTime() + 60 * 60 * 1000),
      ),
    ).rejects.toThrow("INVITATION_INVALID_OR_EXPIRED");
    expect(passwordHasher.hashCalls).toBe(0);
  });

  it("rejects unknown and replayed links before hashing the submitted password", async () => {
    const { adapter, passwordHasher } = createSubject();
    await expect(
      adapter.acceptInvitation(
        {
          token: rawInviteToken,
          password: "correct horse battery",
          displayName: "AM User",
        },
        now,
      ),
    ).rejects.toThrow("INVITATION_INVALID_OR_EXPIRED");
    expect(passwordHasher.hashCalls).toBe(0);

    await adapter.createInvitation(
      admin,
      { email: "once@example.invalid", role: "AM", teamId: "team-1" },
      now,
    );
    await adapter.acceptInvitation(
      {
        token: rawInviteToken,
        password: "correct horse battery",
        displayName: "AM User",
      },
      now,
    );
    expect(passwordHasher.hashCalls).toBe(1);
    await expect(
      adapter.acceptInvitation(
        {
          token: rawInviteToken,
          password: "correct horse battery",
          displayName: "AM User",
        },
        now,
      ),
    ).rejects.toThrow("INVITATION_INVALID_OR_EXPIRED");
    expect(passwordHasher.hashCalls).toBe(1);
  });

  it("authenticates active invited users and immediately denies a deactivated user/session", async () => {
    const { adapter, repository } = createSubject();
    await adapter.createInvitation(
      admin,
      { email: "active@example.invalid", role: "AM", teamId: "team-1" },
      now,
    );
    await adapter.acceptInvitation(
      {
        token: rawInviteToken,
        password: "correct horse battery",
        displayName: "AM User",
      },
      now,
    );
    const login = await adapter.authenticatePassword(
      {
        workspaceId: "ws-1",
        email: "ACTIVE@example.invalid",
        password: "correct horse battery",
      },
      now,
    );
    expect(login?.principal.userId).toBe("user-1");
    expect(await adapter.resolveSession(login!.sessionToken, now)).toEqual(
      login!.principal,
    );
    expect(
      await adapter.resolveSession(
        login!.sessionToken,
        new Date(now.getTime() + 60 * 60 * 1000),
      ),
    ).toBeNull();

    repository.deactivateUser();
    expect(
      await adapter.authenticatePassword(
        {
          workspaceId: "ws-1",
          email: "active@example.invalid",
          password: "correct horse battery",
        },
        now,
      ),
    ).toBeNull();
    expect(await adapter.resolveSession(login!.sessionToken, now)).toBeNull();
  });

  it("records admin role changes through the adapter repository", async () => {
    const { adapter, repository } = createSubject();
    await adapter.createInvitation(
      admin,
      { email: "role@example.invalid", role: "AM", teamId: "team-1" },
      now,
    );
    await adapter.changeMembershipRole(
      admin,
      { targetUserId: "user-1", role: "MANAGER", teamId: "team-1" },
      now,
    );
    expect(repository.invitation?.role).toBe("MANAGER");
    expect(repository.audit.at(-1)).toEqual({
      action: "MEMBERSHIP_ROLE_CHANGED",
      actorId: admin.userId,
    });
  });

  it("does not expose a self-signup operation", () => {
    const { adapter } = createSubject();
    expect("signUp" in adapter).toBe(false);
    expect("register" in adapter).toBe(false);
  });
});
