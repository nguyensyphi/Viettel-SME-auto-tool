import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, describe, expect, it, afterEach, vi } from "vitest";
import { scanFacebookSessions, sanitizeAccountSlug, formatAccountDisplayName } from "../src/server/fb-account-scanner.js";
import { buildDesktopLoginArgs, launchDesktopLoginBrowser } from "../src/server/desktop-login-launcher.js";
import { WorkspaceOperationsHub } from "../src/server/operations-hub.js";

describe("Facebook Account Discovery & Session Scanner", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-sessions-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("sanitizes account names into safe IDs and readable display names", () => {
    expect(sanitizeAccountSlug("facebook_profile_nguyen_van_son")).toBe("fb-nguyen-van-son");
    expect(sanitizeAccountSlug("Acc Chính")).toBe("fb-acc-chinh");
    expect(sanitizeAccountSlug("clone_profile")).toBe("fb-clone-profile");

    expect(formatAccountDisplayName("facebook_profile_nguyen_van_son")).toBe("Nguyễn Văn Sơn");
    expect(formatAccountDisplayName("facebook_profile_tin")).toBe("Tín");
    expect(formatAccountDisplayName("facebook_profile_tin_nguyen")).toBe("Tín Nguyễn");
    expect(formatAccountDisplayName("Acc Chính")).toBe("Acc Chính");
    expect(formatAccountDisplayName("clone")).toBe("Clone");
  });

  it("scans mock sessions directory and discovers existing accounts with connected status", () => {
    // Create mock profiles
    const sonDir = path.join(tempDir, "facebook_profile_nguyen_van_son");
    fs.mkdirSync(path.join(sonDir, "Default"), { recursive: true });
    fs.writeFileSync(path.join(sonDir, "Default", "Preferences"), "{}");

    const tinDir = path.join(tempDir, "facebook_profile_tin_nguyen");
    fs.mkdirSync(path.join(tinDir, "Default"), { recursive: true });

    const emptyDir = path.join(tempDir, "facebook_profile_new_empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    // Backup dir should be ignored
    const backupDir = path.join(tempDir, "facebook_profile_backup_20260709");
    fs.mkdirSync(backupDir, { recursive: true });

    // Temp images should be ignored
    const tempImagesDir = path.join(tempDir, "temp_images");
    fs.mkdirSync(tempImagesDir, { recursive: true });

    const accounts = scanFacebookSessions(tempDir);

    expect(accounts).toHaveLength(3);

    const sonAcc = accounts.find((a) => a.folderName === "facebook_profile_nguyen_van_son");
    expect(sonAcc).toBeDefined();
    expect(sonAcc?.accountId).toBe("fb-nguyen-van-son");
    expect(sonAcc?.displayName).toBe("Nguyễn Văn Sơn");
    expect(sonAcc?.status).toBe("CONNECTED");
    expect(sonAcc?.platform).toBe("FACEBOOK");

    const tinAcc = accounts.find((a) => a.folderName === "facebook_profile_tin_nguyen");
    expect(tinAcc).toBeDefined();
    expect(tinAcc?.status).toBe("CONNECTED");

    const emptyAcc = accounts.find((a) => a.folderName === "facebook_profile_new_empty");
    expect(emptyAcc).toBeDefined();
    expect(emptyAcc?.status).toBe("NEEDS_LOGIN");
  });

  it("builds correct command line arguments for desktop browser login", () => {
    const profileDir = path.join(tempDir, "facebook_profile_test");
    const launchConfig = buildDesktopLoginArgs(profileDir, "https://www.facebook.com");

    expect(launchConfig.args).toContain(`--user-data-dir=${profileDir}`);
    expect(launchConfig.args).toContain("https://www.facebook.com");
    expect(launchConfig.args).toContain("--no-first-run");
  });

  it("launches desktop browser with mock spawn", () => {
    const mockSpawn = vi.fn().mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
    });

    const profileDir = path.join(tempDir, "facebook_profile_spawn_test");
    const result = launchDesktopLoginBrowser({
      profileDir,
      url: "https://www.facebook.com",
      spawnFn: mockSpawn as any,
    });

    expect(result.launched).toBe(true);
    expect(result.pid).toBe(12345);
    expect(mockSpawn).toHaveBeenCalled();
    expect(fs.existsSync(profileDir)).toBe(true);
  });

  it("syncs discovered Facebook sessions into WorkspaceOperationsHub", () => {
    // Setup a mock account in tempDir
    const sonDir = path.join(tempDir, "facebook_profile_nguyen_van_son");
    fs.mkdirSync(path.join(sonDir, "Default"), { recursive: true });

    const hub = new WorkspaceOperationsHub();
    const wsId = "ws-sync-test";

    const synced = hub.syncFacebookAccountsFromSessions(wsId, tempDir);
    expect(synced.length).toBeGreaterThanOrEqual(1);

    const sonAcc = synced.find((a) => a.accountId === "fb-nguyen-van-son");
    expect(sonAcc).toBeDefined();
    expect(sonAcc?.platform).toBe("FACEBOOK");
    expect(sonAcc?.status).toBe("CONNECTED");

    const list = hub.listSocialAccounts(wsId);
    expect(list.some((a) => a.accountId === "fb-nguyen-van-son")).toBe(true);
  });

  it("handles POST /api/v1/fb-poster/sync-accounts and /api/v1/social-accounts/launch-browser via HTTP API", async () => {
    const { HttpAuthGuard } = await import("@am-sme/auth");
    const { handleApiRequest } = await import("../src/server/http-api.js");
    const { InMemoryImportApi } = await import("../src/server/import-api.js");

    const session = "mock-valid-session-token-32-chars-long";
    const auth = {
      resolveSession: vi.fn(async (tok) =>
        tok === session
          ? {
              userId: "am-user-1",
              workspaceId: "ws-http-fb-test",
              role: "AM" as const,
              teamId: "team-1",
            }
          : null,
      ),
      authenticatePassword: vi.fn() as any,
      acceptInvitation: vi.fn() as any,
      createInvitation: vi.fn() as any,
      changeMembershipRole: vi.fn() as any,
      revokeSession: vi.fn() as any,
    };

    const operations = new WorkspaceOperationsHub();
    const services = {
      auth,
      guard: new HttpAuthGuard(auth as any),
      leads: {} as any,
      tasks: {} as any,
      imports: new InMemoryImportApi({} as any),
      db: {} as any,
      sessionCookie: { secure: false, maxAgeSeconds: 3600 },
      operations,
    };

    // 1. Sync accounts
    const syncRes = await handleApiRequest(
      new Request("http://localhost/api/v1/fb-poster/sync-accounts", {
        method: "POST",
        headers: {
          cookie: `am_sme_session=${session}`,
          origin: "http://localhost",
        },
      }),
      ["fb-poster", "sync-accounts"],
      services as any,
    );
    expect(syncRes.status).toBe(200);
    const syncData = await syncRes.json();
    expect(syncData.accounts).toBeDefined();

    // 2. Launch browser
    const launchRes = await handleApiRequest(
      new Request("http://localhost/api/v1/social-accounts/launch-browser", {
        method: "POST",
        headers: {
          cookie: `am_sme_session=${session}`,
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ accountId: "fb-viettel-sme", platform: "FACEBOOK" }),
      }),
      ["social-accounts", "launch-browser"],
      services as any,
    );
    expect(launchRes.status).toBe(200);
    const launchData = await launchRes.json();
    expect(launchData.ok).toBeDefined();
  });
});

