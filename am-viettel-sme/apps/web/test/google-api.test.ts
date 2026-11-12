import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";

const am = {
  userId: "am-1",
  workspaceId: "workspace-1",
  role: "AM" as const,
  teamId: "team-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("Google Integration HTTP API (PB-P01)", () => {
  let mockGoogleRepo: any;
  let mockOAuthService: any;
  let mockDriveConnector: any;
  let services: ApiServices;

  beforeEach(() => {
    mockGoogleRepo = {
      createConnection: vi.fn(async (input) => ({
        id: "conn-123",
        workspaceId: input.workspaceId,
        provider: "GOOGLE",
        accountEmail: input.accountEmail,
        scopes: input.scopes,
        status: "CONNECTED",
        encryptedRefreshToken: input.encryptedRefreshToken,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      getConnectionById: vi.fn(async (wsId, id) => {
        if (id === "conn-123") {
          return {
            id: "conn-123",
            workspaceId: wsId,
            provider: "GOOGLE",
            accountEmail: "am.viettel@gmail.com",
            scopes: [
              "https://www.googleapis.com/auth/drive.readonly",
              "https://www.googleapis.com/auth/documents.readonly",
            ],
            status: "CONNECTED",
            encryptedRefreshToken: "secret-token",
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
      listConnections: vi.fn(async (wsId) => [
        {
          id: "conn-123",
          workspaceId: wsId,
          provider: "GOOGLE",
          accountEmail: "am.viettel@gmail.com",
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
          status: "CONNECTED",
          encryptedRefreshToken: "secret-token", // MUST be omitted from JSON response
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      revokeConnection: vi.fn(async () => true),
      registerFolder: vi.fn(async (input) => ({
        id: "folder-rec-1",
        connectionId: input.connectionId,
        driveFolderId: input.driveFolderId,
        folderName: input.folderName,
        folderType: input.folderType,
        pathHint: input.pathHint ?? null,
        registeredAt: new Date(),
        lastSyncedAt: null,
      })),
      listFolders: vi.fn(async () => [
        {
          id: "folder-rec-1",
          connectionId: "conn-123",
          driveFolderId: "drive_folder_abc",
          folderName: "VIETTEL_AM",
          folderType: "ROOT",
          pathHint: "/VIETTEL_AM",
          registeredAt: new Date(),
          lastSyncedAt: null,
        },
      ]),
      appendSyncLog: vi.fn(async (input) => ({
        id: "log-1",
        connectionId: input.connectionId,
        entityId: input.entityId,
        syncType: input.syncType,
        syncStatus: input.syncStatus,
        itemsSynced: input.itemsSynced,
        errorMessage: input.errorMessage ?? null,
        createdAt: new Date(),
      })),
      listSyncLogs: vi.fn(async () => []),
    };

    mockOAuthService = {
      generateAuthUrl: vi.fn(() => ({
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth?mock=1",
        state: "state-token-123",
      })),
      verifyState: vi.fn((state, wsId) => state === "state-token-123" && wsId === "workspace-1"),
      exchangeCode: vi.fn(async (code) => {
        if (code === "valid-code") {
          return {
            accessToken: "access-token-1",
            refreshToken: "refresh-token-1",
            expiresIn: 3600,
            accountEmail: "am.viettel@gmail.com",
            scopes: [
              "https://www.googleapis.com/auth/drive.readonly",
              "https://www.googleapis.com/auth/documents.readonly",
            ],
          };
        }
        throw new Error("INVALID_AUTH_CODE");
      }),
      revokeToken: vi.fn(async () => undefined),
    };

    mockDriveConnector = {
      inspectFolder: vi.fn(async (id) => {
        if (id === "drive_folder_abc") {
          return {
            id,
            name: "VIETTEL_AM",
            mimeType: "application/vnd.google-apps.folder",
            isFolder: true,
          };
        }
        throw new Error("GOOGLE_DRIVE_FOLDER_NOT_FOUND");
      }),
      listFolderChildren: vi.fn(async () => [
        {
          id: "file-1",
          name: "banner.png",
          mimeType: "image/png",
        },
      ]),
      discoverWorkspaceHierarchy: vi.fn(async () => ({
        rootFolder: { id: "drive_folder_abc", name: "VIETTEL_AM", isFolder: true },
        contentFolder: { id: "c1", name: "CONTENT", mimeType: "application/vnd.google-apps.folder" },
        mediaFolder: { id: "m1", name: "MEDIA", mimeType: "application/vnd.google-apps.folder" },
        archiveFolder: null,
        recognizedSubfolders: [],
      })),
    };

    const auth = {
      resolveSession: vi.fn(async (tok) => (tok === session ? am : null)),
      authenticatePassword: vi.fn() as any,
      acceptInvitation: vi.fn() as any,
      createInvitation: vi.fn() as any,
      changeMembershipRole: vi.fn() as any,
      revokeSession: vi.fn() as any,
    };

    services = {
      auth,
      guard: new HttpAuthGuard(auth as any),
      leads: {} as any,
      tasks: {} as any,
      imports: new InMemoryImportApi({} as any),
      db: {} as any,
      sessionCookie: { secure: false, maxAgeSeconds: 3600 },
      googleConnections: mockGoogleRepo,
      googleOAuth: mockOAuthService,
      googleDrive: mockDriveConnector,
    };
  });

  it("POST /api/v1/google/oauth/url returns authorization URL with state", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/oauth/url", {
        method: "POST",
        headers: headers(),
      }),
      ["api", "v1", "google", "oauth", "url"],
      services,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.authUrl).toContain("accounts.google.com");
    expect(json.state).toBe("state-token-123");
  });

  it("POST /api/v1/google/oauth/callback exchanges code and registers connection", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/oauth/callback", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          code: "valid-code",
          state: "state-token-123",
        }),
      }),
      ["api", "v1", "google", "oauth", "callback"],
      services,
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.accountEmail).toBe("am.viettel@gmail.com");
    expect(json.status).toBe("CONNECTED");
    // Ensure refreshToken is NEVER returned in response
    expect(json.encryptedRefreshToken).toBeUndefined();
    expect(json.refreshToken).toBeUndefined();
  });

  it("GET /api/v1/google/connections lists sanitized connections without tokens", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/connections", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "google", "connections"],
      services,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as any[];
    expect(json).toHaveLength(1);
    expect(json[0].accountEmail).toBe("am.viettel@gmail.com");
    expect(json[0].encryptedRefreshToken).toBeUndefined();
  });

  it("DELETE /api/v1/google/connections/:id revokes and disconnects", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/connections/conn-123", {
        method: "DELETE",
        headers: headers(),
      }),
      ["api", "v1", "google", "connections", "conn-123"],
      services,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(mockOAuthService.revokeToken).toHaveBeenCalled();
    expect(mockGoogleRepo.revokeConnection).toHaveBeenCalledWith("workspace-1", "conn-123");
  });

  it("POST /api/v1/google/folders validates and registers drive folder", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/folders", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          connectionId: "conn-123",
          driveFolderId: "drive_folder_abc",
          folderName: "VIETTEL_AM",
          folderType: "ROOT",
          pathHint: "/VIETTEL_AM",
        }),
      }),
      ["api", "v1", "google", "folders"],
      services,
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.folderName).toBe("VIETTEL_AM");
    expect(mockDriveConnector.inspectFolder).toHaveBeenCalledWith("drive_folder_abc");
  });

  it("GET /api/v1/google/folders/:id/files lists files inside folder", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/folders/drive_folder_abc/files", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "google", "folders", "drive_folder_abc", "files"],
      services,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as any[];
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("banner.png");
  });
});
