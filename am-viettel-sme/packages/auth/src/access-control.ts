export type AuthRole = "AM" | "MANAGER" | "ADMIN";

export interface AuthPrincipal {
  userId: string;
  workspaceId: string;
  role: AuthRole;
  teamId: string | null;
}

export interface LeadAccessScope {
  workspaceId: string;
  ownerUserId: string | null;
  ownerTeamId: string | null;
}

export type LeadAccessAction = "read" | "update" | "assign";

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "UNAUTHENTICATED" | "WORKSPACE_MISMATCH" | "LEAD_OUT_OF_SCOPE";
    };

export function authorizeLeadAccess(
  principal: AuthPrincipal | null,
  lead: LeadAccessScope,
  action: LeadAccessAction,
): AccessDecision {
  if (!principal) return { allowed: false, reason: "UNAUTHENTICATED" };
  if (principal.workspaceId !== lead.workspaceId) {
    return { allowed: false, reason: "WORKSPACE_MISMATCH" };
  }
  if (principal.role === "ADMIN") return { allowed: true };

  if (principal.role === "AM") {
    const ownsLead = lead.ownerUserId === principal.userId;
    return ownsLead && action !== "assign"
      ? { allowed: true }
      : { allowed: false, reason: "LEAD_OUT_OF_SCOPE" };
  }

  const isSameTeam =
    principal.teamId !== null && lead.ownerTeamId === principal.teamId;
  return isSameTeam
    ? { allowed: true }
    : { allowed: false, reason: "LEAD_OUT_OF_SCOPE" };
}

export function canManageUsers(principal: AuthPrincipal | null): boolean {
  return principal?.role === "ADMIN";
}

export function canReadAudit(principal: AuthPrincipal | null): boolean {
  return principal?.role === "MANAGER" || principal?.role === "ADMIN";
}
