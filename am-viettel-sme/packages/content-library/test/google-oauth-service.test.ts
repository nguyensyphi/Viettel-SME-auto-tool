import { describe, expect, it } from "vitest";
import {
  GoogleOAuthService,
  type GoogleOAuthHttpTransport,
  type GoogleOAuthConfig,
} from "../src/google-oauth-service.js";

const mockConfig: GoogleOAuthConfig = {
  clientId: "mock-google-client-id.apps.googleusercontent.com",
  clientSecret: "mock-google-client-secret",
  redirectUri: "http://127.0.0.1:3000/api/v1/google/oauth/callback",
};

describe("GoogleOAuthService (PB-P01)", () => {
  it("generates authorization URL with minimal required scopes and workspace state", () => {
    const oauth = new GoogleOAuthService(mockConfig);
    const workspaceId = "11111111-1111-4111-8111-111111111111";

    const { authUrl, state } = oauth.generateAuthUrl(workspaceId);

    const url = new URL(authUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(mockConfig.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(mockConfig.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");

    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/documents.readonly");

    // State validation
    expect(state).toBeDefined();
    expect(oauth.verifyState(state, workspaceId)).toBe(true);
    expect(oauth.verifyState(state, "wrong-workspace")).toBe(false);
  });

  it("exchanges authorization code for tokens and extracts verified account email", async () => {
    const mockTransport: GoogleOAuthHttpTransport = {
      async postJson(url, data) {
        if (url === "https://oauth2.googleapis.com/token") {
          return {
            status: 200,
            data: {
              access_token: "mock-access-token-123",
              refresh_token: "mock-refresh-token-456",
              expires_in: 3600,
              scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly",
              token_type: "Bearer",
            },
          };
        }
        return { status: 404, data: {} };
      },
      async getJson(url, headers) {
        if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
          expect(headers["Authorization"]).toBe("Bearer mock-access-token-123");
          return {
            status: 200,
            data: {
              email: "am.viettel@example.com",
              email_verified: true,
            },
          };
        }
        return { status: 404, data: {} };
      },
    };

    const oauth = new GoogleOAuthService(mockConfig, mockTransport);
    const tokens = await oauth.exchangeCode("mock-auth-code");

    expect(tokens.accessToken).toBe("mock-access-token-123");
    expect(tokens.refreshToken).toBe("mock-refresh-token-456");
    expect(tokens.accountEmail).toBe("am.viettel@example.com");
    expect(tokens.expiresIn).toBe(3600);
    expect(tokens.scopes).toContain("https://www.googleapis.com/auth/drive.readonly");
  });

  it("fails closed when granted scopes are insufficient", async () => {
    const mockTransport: GoogleOAuthHttpTransport = {
      async postJson() {
        return {
          status: 200,
          data: {
            access_token: "mock-token",
            refresh_token: "mock-refresh",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/userinfo.email", // Missing drive/docs scope
          },
        };
      },
      async getJson() {
        return { status: 200, data: { email: "am@example.com" } };
      },
    };

    const oauth = new GoogleOAuthService(mockConfig, mockTransport);
    await expect(oauth.exchangeCode("insufficient-code")).rejects.toThrow(
      "INSUFFICIENT_GOOGLE_SCOPES",
    );
  });

  it("refreshes access token successfully when valid refresh token is provided", async () => {
    const mockTransport: GoogleOAuthHttpTransport = {
      async postJson(url, data) {
        expect(data["grant_type"]).toBe("refresh_token");
        expect(data["refresh_token"]).toBe("valid-refresh-token");
        return {
          status: 200,
          data: {
            access_token: "new-access-token-789",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly",
          },
        };
      },
      async getJson() {
        return { status: 404, data: {} };
      },
    };

    const oauth = new GoogleOAuthService(mockConfig, mockTransport);
    const refreshed = await oauth.refreshAccessToken("valid-refresh-token");

    expect(refreshed.accessToken).toBe("new-access-token-789");
    expect(refreshed.expiresIn).toBe(3600);
  });

  it("handles revoked refresh token with GOOGLE_AUTH_REVOKED error", async () => {
    const mockTransport: GoogleOAuthHttpTransport = {
      async postJson() {
        return {
          status: 400,
          data: {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
        };
      },
      async getJson() {
        return { status: 404, data: {} };
      },
    };

    const oauth = new GoogleOAuthService(mockConfig, mockTransport);
    await expect(oauth.refreshAccessToken("revoked-token")).rejects.toThrow(
      "GOOGLE_AUTH_REVOKED",
    );
  });

  it("revokes token via Google revoke endpoint", async () => {
    let revoked = false;
    const mockTransport: GoogleOAuthHttpTransport = {
      async postJson(url) {
        if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
          revoked = true;
          return { status: 200, data: {} };
        }
        return { status: 404, data: {} };
      },
      async getJson() {
        return { status: 404, data: {} };
      },
    };

    const oauth = new GoogleOAuthService(mockConfig, mockTransport);
    await oauth.revokeToken("token-to-revoke");
    expect(revoked).toBe(true);
  });
});

