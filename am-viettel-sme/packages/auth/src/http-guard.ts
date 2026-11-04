import type { AuthAdapter } from "./index.js";
import {
  authorizeLeadAccess,
  type AuthPrincipal,
  type AuthRole,
  type LeadAccessAction,
  type LeadAccessScope,
} from "./access-control.js";

export interface HttpRequestLike {
  headers: {
    cookie?: string;
    authorization?: string;
  };
}

export interface HttpAuthGuardOptions {
  secure?: boolean;
  cookieName?: string;
}

export const LOCAL_SESSION_COOKIE_NAME = "am_sme_session";
export const SECURE_SESSION_COOKIE_NAME = "__Host-am_sme_session";

export class ApiAuthError extends Error {
  constructor(
    readonly statusCode: 401 | 403 | 404,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND",
  ) {
    super(code);
    this.name = "ApiAuthError";
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  let found: string | null = null;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key !== name) continue;
    if (found !== null) return null;
    try {
      found = decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return found;
}

/** Framework-neutral HTTP boundary; controllers should call it before every protected handler. */
export class HttpAuthGuard {
  private readonly cookieName: string;

  constructor(
    private readonly auth: Pick<AuthAdapter, "resolveSession">,
    options: HttpAuthGuardOptions = {},
  ) {
    this.cookieName =
      options.cookieName ??
      (options.secure ? SECURE_SESSION_COOKIE_NAME : LOCAL_SESSION_COOKIE_NAME);
  }

  async authenticate(request: HttpRequestLike): Promise<AuthPrincipal> {
    const token = readCookie(request.headers.cookie, this.cookieName);
    if (!token || token.length < 32) {
      throw new ApiAuthError(401, "UNAUTHENTICATED");
    }
    const principal = await this.auth.resolveSession(token);
    if (!principal) throw new ApiAuthError(401, "UNAUTHENTICATED");
    return principal;
  }
}

export function requireRole(
  principal: AuthPrincipal,
  allowedRoles: readonly AuthRole[],
): void {
  if (!allowedRoles.includes(principal.role)) {
    throw new ApiAuthError(403, "FORBIDDEN");
  }
}

/** Return 404 for out-of-scope lead IDs to avoid confirming another user's records exist. */
export function requireLeadAccess(
  principal: AuthPrincipal,
  lead: LeadAccessScope,
  action: LeadAccessAction,
): void {
  if (!authorizeLeadAccess(principal, lead, action).allowed) {
    throw new ApiAuthError(404, "NOT_FOUND");
  }
}

export function formatSessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  if (token.length < 32) throw new Error("INVALID_SESSION_TOKEN");
  if (
    !Number.isSafeInteger(options.maxAgeSeconds) ||
    options.maxAgeSeconds <= 0
  ) {
    throw new Error("INVALID_COOKIE_MAX_AGE");
  }
  const name = options.secure
    ? SECURE_SESSION_COOKIE_NAME
    : LOCAL_SESSION_COOKIE_NAME;
  const secureFlag = options.secure ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.maxAgeSeconds}${secureFlag}`;
}

export function clearSessionCookie(secure: boolean): string {
  const name = secure ? SECURE_SESSION_COOKIE_NAME : LOCAL_SESSION_COOKIE_NAME;
  const secureFlag = secure ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}
