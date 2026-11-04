import type { AuthPrincipal, AuthRepository, AuthRole } from "@am-sme/auth";
import type { Prisma, PrismaClient } from "../generated/client/index.js";

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createInvitation(
    input: Parameters<AuthRepository["createInvitation"]>[0],
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          workspaceId: input.workspaceId,
          emailNormalized: input.emailNormalized,
          status: "INVITED",
          invitationTokenHash: input.tokenHash,
          invitedAt: input.createdAt,
          invitationExpiresAt: input.expiresAt,
          invitedByUserId: input.actor.userId,
        },
      });
      const membership = await tx.teamMembership.create({
        data: {
          workspaceId: input.workspaceId,
          userId: user.id,
          teamId: input.teamId,
          role: input.role,
        },
      });
      await appendAudit(tx, {
        workspaceId: input.workspaceId,
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        action: "USER_INVITED",
        entityType: "User",
        entityId: user.id,
        changedFieldNames: ["status", "role", "teamId", "invitationExpiresAt"],
      });
      return membership.userId;
    });
  }

  async hasValidInvitation(
    input: Parameters<AuthRepository["hasValidInvitation"]>[0],
  ): Promise<boolean> {
    const invitation = await this.prisma.user.findFirst({
      where: {
        invitationTokenHash: input.tokenHash,
        status: "INVITED",
        invitationExpiresAt: { gt: input.now },
      },
      select: { id: true },
    });
    return invitation !== null;
  }

  async consumeInvitation(
    input: Parameters<AuthRepository["consumeInvitation"]>[0],
  ): Promise<AuthPrincipal | null> {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.user.findFirst({
        where: {
          invitationTokenHash: input.tokenHash,
          status: "INVITED",
          invitationExpiresAt: { gt: input.acceptedAt },
        },
        include: { membership: true },
      });
      if (!invitation?.membership) return null;

      const claimed = await tx.user.updateMany({
        where: {
          id: invitation.id,
          workspaceId: invitation.workspaceId,
          status: "INVITED",
          invitationTokenHash: input.tokenHash,
          invitationExpiresAt: { gt: input.acceptedAt },
        },
        data: {
          status: "ACTIVE",
          displayName: input.displayName,
          acceptedAt: input.acceptedAt,
          invitationTokenHash: null,
          invitationExpiresAt: null,
        },
      });
      if (claimed.count !== 1) return null;

      await tx.userPasswordCredential.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: invitation.id,
          passwordHash: input.passwordHash,
        },
      });
      await appendAudit(tx, {
        workspaceId: invitation.workspaceId,
        actorId: invitation.id,
        actorRole: invitation.membership.role,
        action: "INVITATION_ACCEPTED",
        entityType: "User",
        entityId: invitation.id,
        changedFieldNames: ["status", "displayName", "passwordCredential"],
      });
      return principalFromMembership(
        invitation.workspaceId,
        invitation.id,
        invitation.membership,
      );
    });
  }

  async findPasswordCredential(
    input: Parameters<AuthRepository["findPasswordCredential"]>[0],
  ): Promise<{ principal: AuthPrincipal; passwordHash: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        workspaceId_emailNormalized: {
          workspaceId: input.workspaceId,
          emailNormalized: input.emailNormalized,
        },
      },
      include: { membership: true, passwordCredential: true },
    });
    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.membership ||
      !user.passwordCredential
    ) {
      return null;
    }
    return {
      principal: principalFromMembership(
        user.workspaceId,
        user.id,
        user.membership,
      ),
      passwordHash: user.passwordCredential.passwordHash,
    };
  }

  async createSession(
    input: Parameters<AuthRepository["createSession"]>[0],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          id: input.principal.userId,
          workspaceId: input.principal.workspaceId,
          status: "ACTIVE",
        },
        include: { membership: true },
      });
      if (!user?.membership) throw new Error("USER_NOT_ACTIVE");
      await tx.authSession.create({
        data: {
          workspaceId: user.workspaceId,
          userId: user.id,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
        },
      });
      await appendAudit(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        actorRole: user.membership.role,
        action: "SESSION_CREATED",
        entityType: "User",
        entityId: user.id,
        changedFieldNames: [],
      });
    });
  }

  async findActiveSession(
    input: Parameters<AuthRepository["findActiveSession"]>[0],
  ): Promise<AuthPrincipal | null> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        tokenHash: input.tokenHash,
        expiresAt: { gt: input.now },
        revokedAt: null,
      },
      include: { user: { include: { membership: true } } },
    });
    if (
      !session ||
      session.user.status !== "ACTIVE" ||
      !session.user.membership
    ) {
      return null;
    }
    return principalFromMembership(
      session.workspaceId,
      session.userId,
      session.user.membership,
    );
  }

  async revokeSession(
    input: Parameters<AuthRepository["revokeSession"]>[0],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { tokenHash: input.tokenHash, revokedAt: null },
      });
      if (!session) return;
      await tx.authSession.update({
        where: { id: session.id },
        data: { revokedAt: input.revokedAt },
      });
      const user = await tx.user.findFirst({
        where: { id: session.userId, workspaceId: session.workspaceId },
        include: { membership: true },
      });
      await appendAudit(tx, {
        workspaceId: session.workspaceId,
        actorId: session.userId,
        actorRole: user?.membership?.role ?? null,
        action: "SESSION_REVOKED",
        entityType: "AuthSession",
        entityId: session.id,
        changedFieldNames: ["revokedAt"],
      });
    });
  }

  async changeRole(
    input: Parameters<AuthRepository["changeRole"]>[0],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.teamMembership.findFirst({
        where: {
          workspaceId: input.actor.workspaceId,
          userId: input.targetUserId,
          user: { status: "ACTIVE" },
        },
      });
      if (!membership) throw new Error("USER_NOT_FOUND");
      await tx.teamMembership.update({
        where: { id: membership.id },
        data: { role: input.role, teamId: input.teamId },
      });
      await appendAudit(tx, {
        workspaceId: input.actor.workspaceId,
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        action: "MEMBERSHIP_ROLE_CHANGED",
        entityType: "TeamMembership",
        entityId: membership.id,
        changedFieldNames: ["role", "teamId"],
      });
    });
  }
}

function principalFromMembership(
  workspaceId: string,
  userId: string,
  membership: { role: AuthRole; teamId: string | null },
): AuthPrincipal {
  return {
    workspaceId,
    userId,
    role: membership.role,
    teamId: membership.teamId,
  };
}

async function appendAudit(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    actorId: string | null;
    actorRole: AuthRole | null;
    action: string;
    entityType: string;
    entityId: string;
    changedFieldNames: string[];
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      changedFieldNames: input.changedFieldNames,
      outcome: "SUCCESS",
    },
  });
}
