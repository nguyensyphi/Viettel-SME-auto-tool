import { describe, expect, it } from "vitest";
import { handleApiRequest } from "../src/server/http-api.js";
import { getApiServices } from "../src/server/runtime.js";

const sessionCookie = "am_sme_session=session-am-dian-demo-token-32-chars";

function authedRequest(
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: {
      cookie: sessionCookie,
      origin: "http://127.0.0.1:3000",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("PB-P01: Google OAuth + Drive Connector End-to-End Integration", () => {
  it("executes the full PB-P01 lifecycle: auth url, callback, folder registration, file listing, sync log, and revocation", async () => {
    process.env.DEMO_MODE = "true";
    const services = getApiServices();

    // Authenticate as AM
    const authResult = await services.auth.authenticatePassword({
      workspaceId: "viettel-sme",
      email: "am@viettel.vn",
      password: "demo",
    });
    expect(authResult).not.toBeNull();
    const token = authResult!.sessionToken;

    function req(path: string, method = "GET", body?: Record<string, unknown>): Request {
      return new Request(`http://127.0.0.1:3000${path}`, {
        method,
        headers: {
          cookie: `am_sme_session=${token}`,
          origin: "http://127.0.0.1:3000",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }

    // 1. Generate OAuth authorization URL
    const authUrlRes = await handleApiRequest(
      req("/api/v1/google/oauth/url", "POST"),
      ["api", "v1", "google", "oauth", "url"],
      services,
    );
    expect(authUrlRes.status).toBe(200);
    const authUrlData = (await authUrlRes.json()) as { authUrl: string; state: string };
    expect(authUrlData.authUrl).toContain("accounts.google.com");
    expect(authUrlData.authUrl).toContain("drive.readonly");
    expect(authUrlData.authUrl).toContain("documents.readonly");
    expect(authUrlData.state).toBeDefined();

    // 2. Complete OAuth callback
    const callbackRes = await handleApiRequest(
      req("/api/v1/google/oauth/callback", "POST", {
        code: "mock-google-authorization-code",
        state: authUrlData.state,
      }),
      ["api", "v1", "google", "oauth", "callback"],
      services,
    );
    expect(callbackRes.status).toBe(201);
    const connection = (await callbackRes.json()) as {
      id: string;
      accountEmail: string;
      status: string;
      encryptedRefreshToken?: unknown;
    };
    expect(connection.id).toBeDefined();
    expect(connection.status).toBe("CONNECTED");
    // Ensure no raw or encrypted tokens leak in response
    expect(connection.encryptedRefreshToken).toBeUndefined();

    // 3. List active connections
    const listRes = await handleApiRequest(
      req("/api/v1/google/connections", "GET"),
      ["api", "v1", "google", "connections"],
      services,
    );
    expect(listRes.status).toBe(200);
    const connections = (await listRes.json()) as any[];
    expect(connections.some((c) => c.id === connection.id)).toBe(true);

    // 4. Register Google Drive ROOT folder
    const registerRootRes = await handleApiRequest(
      req("/api/v1/google/folders", "POST", {
        connectionId: connection.id,
        driveFolderId: "drive_root_viettel_am",
        folderName: "VIETTEL_AM",
        folderType: "ROOT",
        pathHint: "/VIETTEL_AM",
      }),
      ["api", "v1", "google", "folders"],
      services,
    );
    expect(registerRootRes.status).toBe(201);
    const rootFolder = (await registerRootRes.json()) as any;
    expect(rootFolder.folderName).toBe("VIETTEL_AM");
    expect(rootFolder.folderType).toBe("ROOT");

    // 5. Register MEDIA folder
    const registerMediaRes = await handleApiRequest(
      req("/api/v1/google/folders", "POST", {
        connectionId: connection.id,
        driveFolderId: "drive_media_dir",
        folderName: "MEDIA",
        folderType: "MEDIA",
        pathHint: "/VIETTEL_AM/PERSONAL_BRANDING/MEDIA",
      }),
      ["api", "v1", "google", "folders"],
      services,
    );
    expect(registerMediaRes.status).toBe(201);
    const mediaFolder = (await registerMediaRes.json()) as any;
    expect(mediaFolder.folderType).toBe("MEDIA");

    // 6. List files inside Drive folder with image MIME filter
    const listFilesRes = await handleApiRequest(
      req("/api/v1/google/folders/drive_media_dir/files?mimeTypePrefix=image/", "GET"),
      ["api", "v1", "google", "folders", "drive_media_dir", "files"],
      services,
    );
    expect(listFilesRes.status).toBe(200);
    const mediaFiles = (await listFilesRes.json()) as any[];
    expect(mediaFiles.length).toBeGreaterThan(0);
    expect(mediaFiles.every((f) => f.mimeType.startsWith("image/"))).toBe(true);

    // 7. Record sync activity log
    const syncLogRes = await handleApiRequest(
      req("/api/v1/google/sync", "POST", {
        connectionId: connection.id,
        entityId: "drive_media_dir",
        syncType: "FOLDER",
        syncStatus: "SUCCESS",
        itemsSynced: mediaFiles.length,
      }),
      ["api", "v1", "google", "sync"],
      services,
    );
    expect(syncLogRes.status).toBe(201);
    const log = (await syncLogRes.json()) as any;
    expect(log.itemsSynced).toBe(mediaFiles.length);
    expect(log.syncStatus).toBe("SUCCESS");

    // 8. Revoke connection
    const deleteRes = await handleApiRequest(
      req(`/api/v1/google/connections/${connection.id}`, "DELETE"),
      ["api", "v1", "google", "connections", connection.id],
      services,
    );
    expect(deleteRes.status).toBe(200);
    const deleteJson = (await deleteRes.json()) as any;
    expect(deleteJson.ok).toBe(true);

    // Verify status transitioned to REVOKED
    const listAfterRevokeRes = await handleApiRequest(
      req("/api/v1/google/connections", "GET"),
      ["api", "v1", "google", "connections"],
      services,
    );
    const connectionsAfter = (await listAfterRevokeRes.json()) as any[];
    const revokedConn = connectionsAfter.find((c) => c.id === connection.id);
    expect(revokedConn?.status).toBe("REVOKED");
  });
});
