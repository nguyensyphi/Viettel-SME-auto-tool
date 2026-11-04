import { createHash, randomBytes } from "node:crypto";
import {
  canManageUsers,
  type AuthPrincipal,
  type AuthRole,
} from "./access-control.js";

export { Argon2idPasswordHasher } from "./argon2id-password-hasher.js";
export {
  authorizeLeadAccess,
  canManageUsers,
  canReadAudit,
} from "./access-control.js";
export type {
  AccessDecision,
  AuthPrincipal,
  AuthRole,
  LeadAccessAction,
  LeadAccessScope,
} from "./access-control.js";
export {
  ApiAuthError,
  clearSessionCookie,
  formatSessionCookie,
  HttpAuthGuard,
  requireLeadAccess,
  requireRole,
} from "./http-guard.js";
export type { HttpAuthGuardOptions, HttpRequestLike } from "./http-guard.js";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface AuthRepository {
  createInvitation(input: {
    workspaceId: string;
    emailNormalized: string;
    role: AuthRole;
    teamId: string | null;
    tokenHash: string;
    expiresAt: Date;
    actor: AuthPrincipal;
    createdAt: Date;
  }): Promise<string>;
  hasValidInvitation(input: { tokenHash: string; now: Date }): Promise<boolean>;
  consumeInvitation(input: {
    tokenHash: string;
    passwordHash: string;
    displayName: string;
    acceptedAt: Date;
  }): Promise<AuthPrincipal | null>;
  findPasswordCredential(input: {
    workspaceId: string;
    emailNormalized: string;
  }): Promise<{ principal: AuthPrincipal; passwordHash: string } | null>;
  createSession(input: {
    principal: AuthPrincipal;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<void>;
  findActiveSession(input: {
    tokenHash: string;
    now: Date;
  }): Promise<AuthPrincipal | null>;
  revokeSession(input: { tokenHash: string; revokedAt: Date }): Promise<void>;
  changeRole(input: {
    actor: AuthPrincipal;
    targetUserId: string;
    role: AuthRole;
    teamId: string | null;
    changedAt: Date;
  }): Promise<void>;
}

/** Stable provider-neutral identity/session boundary consumed by protected APIs. */
export interface AuthAdapter {
  resolveSession(token: string, now?: Date): Promise<AuthPrincipal | null>;
  revokeSession(token: string, now?: Date): Promise<void>;
}

/** Local/staging invitation + password acceptance port; OIDC uses its own onboarding flow. */
export interface LocalInvitationPort {
  createInvitation(
    actor: AuthPrincipal,
    input: { email: string; role: AuthRole; teamId: string | null },
    now?: Date,
  ): Promise<{ userId: string; url: string; expiresAt: Date }>;
  acceptInvitation(
    input: { token: string; password: string; displayName: string },
    now?: Date,
  ): Promise<AuthPrincipal>;
}

/** Credential-specific port; OIDC/SSO adapters do not implement password login. */
export interface LocalPasswordPort {
  authenticatePassword(
    input: { workspaceId: string; email: string; password: string },
    now?: Date,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null>;
}

export interface MembershipAdministrationPort {
  changeMembershipRole(
    actor: AuthPrincipal,
    input: { targetUserId: string; role: AuthRole; teamId: string | null },
    now?: Date,
  ): Promise<void>;
}

export interface LocalAuthService
  extends
    AuthAdapter,
    LocalInvitationPort,
    LocalPasswordPort,
    MembershipAdministrationPort {}

export interface LocalAuthAdapterOptions {
  repository: AuthRepository;
  passwordHasher: PasswordHasher;
  invitationBaseUrl: string;
  invitationTtlMs: number;
  sessionTtlMs: number;
  tokenFactory?: () => string;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error("INVALID_EMAIL");
  }
  return normalized;
}

export class LocalAuthAdapter implements LocalAuthService {
  private readonly tokenFactory: () => string;
  private readonly baseUrl: URL;

  constructor(private readonly options: LocalAuthAdapterOptions) {
    if (
      !Number.isSafeInteger(options.invitationTtlMs) ||
      options.invitationTtlMs <= 0
    ) {
      throw new Error("INVITATION_TTL_MUST_BE_POSITIVE");
    }
    if (
      !Number.isSafeInteger(options.sessionTtlMs) ||
      options.sessionTtlMs <= 0
    ) {
      throw new Error("SESSION_TTL_MUST_BE_POSITIVE");
    }
    this.baseUrl = new URL(options.invitationBaseUrl);
    this.tokenFactory =
      options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  async createInvitation(
    actor: AuthPrincipal,
    input: { email: string; role: AuthRole; teamId: string | null },
    now = new Date(),
  ): Promise<{ userId: string; url: string; expiresAt: Date }> {
    if (!canManageUsers(actor)) throw new Error("FORBIDDEN");
    const emailNormalized = normalizeEmail(input.email);
    const token = this.tokenFactory();
    if (token.length < 32) throw new Error("TOKEN_ENTROPY_INSUFFICIENT");
    const expiresAt = new Date(now.getTime() + this.options.invitationTtlMs);
    const userId = await this.options.repository.createInvitation({
      workspaceId: actor.workspaceId,
      emailNormalized,
      role: input.role,
      teamId: input.teamId,
      tokenHash: sha256(token),
      expiresAt,
      actor,
      createdAt: now,
    });
    const url = new URL(this.baseUrl);
    url.searchParams.set("token", token);
    return { userId, url: url.toString(), expiresAt };
  }

  async acceptInvitation(
    input: { token: string; password: string; displayName: string },
    now = new Date(),
  ): Promise<AuthPrincipal> {
    if (input.token.length < 32)
      throw new Error("INVITATION_INVALID_OR_EXPIRED");
    if (input.password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120)
      throw new Error("INVALID_DISPLAY_NAME");
    const tokenHash = sha256(input.token);
    if (
      !(await this.options.repository.hasValidInvitation({ tokenHash, now }))
    ) {
      throw new Error("INVITATION_INVALID_OR_EXPIRED");
    }
    const passwordHash = await this.options.passwordHasher.hash(input.password);
    const principal = await this.options.repository.consumeInvitation({
      tokenHash,
      passwordHash,
      displayName,
      acceptedAt: now,
    });
    if (!principal) throw new Error("INVITATION_INVALID_OR_EXPIRED");
    return principal;
  }

  async authenticatePassword(
    input: { workspaceId: string; email: string; password: string },
    now = new Date(),
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
    let emailNormalized: string;
    try {
      emailNormalized = normalizeEmail(input.email);
    } catch {
      return null;
    }
    const credential = await this.options.repository.findPasswordCredential({
      workspaceId: input.workspaceId,
      emailNormalized,
    });
    if (
      !credential ||
      !(await this.options.passwordHasher.verify(
        credential.passwordHash,
        input.password,
      ))
    ) {
      return null;
    }
    const sessionToken = this.tokenFactory();
    if (sessionToken.length < 32) throw new Error("TOKEN_ENTROPY_INSUFFICIENT");
    await this.options.repository.createSession({
      principal: credential.principal,
      tokenHash: sha256(sessionToken),
      expiresAt: new Date(now.getTime() + this.options.sessionTtlMs),
      createdAt: now,
    });
    return { principal: credential.principal, sessionToken };
  }

  async resolveSession(
    token: string,
    now = new Date(),
  ): Promise<AuthPrincipal | null> {
    if (token.length < 32) return null;
    return this.options.repository.findActiveSession({
      tokenHash: sha256(token),
      now,
    });
  }

  async revokeSession(token: string, now = new Date()): Promise<void> {
    if (token.length < 32) return;
    await this.options.repository.revokeSession({
      tokenHash: sha256(token),
      revokedAt: now,
    });
  }

  async changeMembershipRole(
    actor: AuthPrincipal,
    input: { targetUserId: string; role: AuthRole; teamId: string | null },
    now = new Date(),
  ): Promise<void> {
    if (!canManageUsers(actor)) throw new Error("FORBIDDEN");
    await this.options.repository.changeRole({
      actor,
      targetUserId: input.targetUserId,
      role: input.role,
      teamId: input.teamId,
      changedAt: now,
    });
  }
}
