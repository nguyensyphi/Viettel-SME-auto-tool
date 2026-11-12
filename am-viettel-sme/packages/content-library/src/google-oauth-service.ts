import { createHmac, randomBytes } from "node:crypto";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleOAuthHttpTransport {
  postJson(
    url: string,
    data: Record<string, string>,
  ): Promise<{ status: number; data: Record<string, unknown> }>;
  getJson(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: Record<string, unknown> }>;
}

export interface GoogleOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresIn: number;
  readonly accountEmail: string;
  readonly scopes: readonly string[];
}

export interface RefreshedTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly scopes?: readonly string[];
}

export const MANDATORY_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
] as const;

export class DefaultGoogleOAuthHttpTransport implements GoogleOAuthHttpTransport {
  async postJson(
    url: string,
    data: Record<string, string>,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const params = new URLSearchParams(data);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data: json };
  }

  async getJson(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data: json };
  }
}

export class GoogleOAuthService {
  private readonly transport: GoogleOAuthHttpTransport;

  constructor(
    private readonly config: GoogleOAuthConfig,
    transport?: GoogleOAuthHttpTransport,
  ) {
    this.transport = transport ?? new DefaultGoogleOAuthHttpTransport();
  }

  generateAuthUrl(workspaceId: string): { authUrl: string; state: string } {
    const nonce = randomBytes(16).toString("hex");
    const payload = JSON.stringify({ workspaceId, nonce });
    const signature = createHmac("sha256", this.config.clientSecret)
      .update(payload)
      .digest("hex");
    const state = Buffer.from(JSON.stringify({ payload, signature })).toString("base64url");

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: MANDATORY_GOOGLE_SCOPES.join(" "),
      state,
    });

    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  verifyState(state: string, expectedWorkspaceId: string): boolean {
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
        payload: string;
        signature: string;
      };
      const expectedSig = createHmac("sha256", this.config.clientSecret)
        .update(decoded.payload)
        .digest("hex");
      if (expectedSig !== decoded.signature) return false;

      const inner = JSON.parse(decoded.payload) as { workspaceId: string };
      return inner.workspaceId === expectedWorkspaceId;
    } catch {
      return false;
    }
  }

  async exchangeCode(code: string): Promise<GoogleOAuthTokens> {
    const cleanCode = code?.trim() ?? "";
    if (!cleanCode) {
      throw new Error("Authorization code is required");
    }

    const tokenRes = await this.transport.postJson("https://oauth2.googleapis.com/token", {
      code: cleanCode,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
    });

    if (tokenRes.status !== 200) {
      const err = (tokenRes.data.error_description as string) || (tokenRes.data.error as string) || "TOKEN_EXCHANGE_FAILED";
      throw new Error(`Google token exchange failed: ${err}`);
    }

    const accessToken = tokenRes.data.access_token as string;
    const refreshToken = tokenRes.data.refresh_token as string | undefined;
    const expiresIn = (tokenRes.data.expires_in as number) ?? 3600;
    const rawScope = (tokenRes.data.scope as string) ?? "";
    const scopes = rawScope.split(" ").map((s) => s.trim()).filter(Boolean);

    // Validate scopes
    const hasDrive = scopes.some((s) => s.includes("drive.readonly") || s.includes("drive"));
    const hasDocs = scopes.some((s) => s.includes("documents.readonly") || s.includes("documents"));
    if (!hasDrive || !hasDocs) {
      throw new Error("INSUFFICIENT_GOOGLE_SCOPES: Google Drive & Docs read permissions are required.");
    }

    // Retrieve verified user identity
    const userinfo = await this.transport.getJson("https://www.googleapis.com/oauth2/v3/userinfo", {
      Authorization: `Bearer ${accessToken}`,
    });

    const accountEmail = (userinfo.data.email as string) ?? "unknown@google.com";

    return {
      accessToken,
      refreshToken,
      expiresIn,
      accountEmail,
      scopes,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedTokenResult> {
    const cleanRefresh = refreshToken?.trim() ?? "";
    if (!cleanRefresh) {
      throw new Error("Refresh token is required");
    }

    const res = await this.transport.postJson("https://oauth2.googleapis.com/token", {
      refresh_token: cleanRefresh,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
    });

    if (res.status !== 200) {
      if (res.data.error === "invalid_grant") {
        throw new Error("GOOGLE_AUTH_REVOKED: Refresh token has been revoked or expired.");
      }
      throw new Error(`Google token refresh failed with code ${res.status}`);
    }

    const accessToken = res.data.access_token as string;
    const expiresIn = (res.data.expires_in as number) ?? 3600;
    const rawScope = res.data.scope as string | undefined;
    const scopes = rawScope ? rawScope.split(" ").map((s) => s.trim()).filter(Boolean) : undefined;

    return {
      accessToken,
      expiresIn,
      ...(scopes ? { scopes } : {}),
    };
  }

  async revokeToken(token: string): Promise<void> {
    const cleanToken = token?.trim() ?? "";
    if (!cleanToken) return;

    await this.transport.postJson(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cleanToken)}`,
      {},
    );
  }
}

