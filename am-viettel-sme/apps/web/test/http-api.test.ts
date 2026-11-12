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
const manager = {
  userId: "manager-1",
  workspaceId: "workspace-1",
  role: "MANAGER" as const,
  teamId: "team-1",
};
const admin = {
  userId: "admin-1",
  workspaceId: "workspace-1",
  role: "ADMIN" as const,
  teamId: null,
};
const session = "abcdefghijklmnopqrstuvwxyz0123456789-secret";

function setup(
  principal: typeof am | typeof manager | typeof admin | null = am,
) {
  const auth = {
    resolveSession: vi.fn(async () => principal),
    authenticatePassword: vi.fn(async () => ({
      principal: admin,
      sessionToken: session,
    })),
    acceptInvitation: vi.fn(async () => am),
    createInvitation: vi.fn(async () => ({
      userId: "invited",
      url: "http://localhost/invite/accept?token=secret",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    })),
    changeMembershipRole: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => undefined),
  };
  const leads = {
    listLeads: vi.fn(async () => ({ items: [], total: 0 })),
    createLead: vi.fn(async () => ({ leadId: "lead-1" })),
    getLeadDetail: vi.fn(async () => ({
      id: "lead-1",
      contacts: [{ phone: "09••••••67", email: "a•••@example.test" }],
    })),
    updateLead: vi.fn(async () => undefined),
    assignLead: vi.fn(async () => undefined),
    transitionStage: vi.fn(async () => undefined),
    addNote: vi.fn(async () => ({ noteId: "note-1" })),
    updateNote: vi.fn(async () => undefined),
    reviewContactability: vi.fn(async () => undefined),
    suppressContact: vi.fn(async () => undefined),
    addSource: vi.fn(async () => ({ sourceId: "source-1" })),
  };
  const tasks = {
    listTasks: vi.fn(async () => []),
    createTask: vi.fn(async () => ({ id: "task-1" })),
    getTask: vi.fn(async () => ({ id: "task-1" })),
    assignTask: vi.fn(async () => ({ id: "task-1" })),
    approveProposedContactTask: vi.fn(async () => ({ id: "task-1" })),
    cancelTask: vi.fn(async () => ({ id: "task-1" })),
    completeTask: vi.fn(async () => ({ id: "task-1" })),
    deferTask: vi.fn(async () => ({ id: "task-1" })),
    getDailyPlan: vi.fn(async () => ({ tasks: [], skipped: [] })),
    listLockedTimeBlocks: vi.fn(async () => []),
    createLockedTimeBlock: vi.fn(async () => ({ id: "block-1" })),
  };
  const db = {
    query: vi.fn(async (...args: unknown[]) => {
      void args;
      return [] as Record<string, unknown>[];
    }),
    execute: vi.fn(async (...args: unknown[]) => {
      void args;
    }),
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work(db),
    ),
  };
  const imports = new InMemoryImportApi({
    previewWorkbook: vi.fn(() => ({
      success: false as const,
      errorCode: "INVALID_XLSX_SIGNATURE" as const,
    })),
    prepareReviewedCommit: vi.fn(() => ({
      success: false as const,
      errorCode: "PREVIEW_NOT_FOUND",
    })),
    commitPrepared: vi.fn(async () => ({ success: false })),
    discardPreview: vi.fn(() => true),
    discardPreparedCommit: vi.fn(() => true),
  });
  const services = {
    auth,
    guard: new HttpAuthGuard(auth),
    leads,
    tasks,
    imports,
    db,
    sessionCookie: { secure: false, maxAgeSeconds: 3600 },
  } as unknown as ApiServices;
  return { services, auth, leads, tasks, db };
}

function request(
  path: string,
  method = "GET",
  body?: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body }),
    headers,
  });
}

function loggedHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("P0.7 API security boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing session before touching a protected service", async () => {
    const { services, leads } = setup(null);
    const result = await handleApiRequest(
      request("/api/v1/leads"),
      ["api", "v1", "leads"],
      services,
    );
    expect(result.status).toBe(401);
    expect(leads.listLeads).not.toHaveBeenCalled();
  });

  it("blocks unsafe cross-origin requests before service execution", async () => {
    const { services, leads } = setup();
    const result = await handleApiRequest(
      request(
        "/api/v1/leads",
        "POST",
        JSON.stringify({ companyName: "Synthetic Co" }),
        {
          ...loggedHeaders(),
          "content-type": "application/json",
          origin: "https://attacker.invalid",
        },
      ),
      ["api", "v1", "leads"],
      services,
    );
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: "CSRF_ORIGIN_REJECTED" });
    expect(leads.createLead).not.toHaveBeenCalled();
  });

  it("sets HttpOnly SameSite cookie on login and never exposes the session token in JSON", async () => {
    const { services } = setup(null);
    const result = await handleApiRequest(
      request(
        "/api/v1/auth/login",
        "POST",
        JSON.stringify({
          workspaceId: "workspace-1",
          email: "admin@example.test",
          password: "not-a-real-password",
        }),
        { origin: "http://localhost", "content-type": "application/json" },
      ),
      ["api", "v1", "auth", "login"],
      services,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax",
    );
    expect(await result.text()).not.toContain(session);
  });

  it("does not expose public registration; invitations remain the only account-creation path", async () => {
    const { services, auth } = setup(null);
    const result = await handleApiRequest(
      request("/api/v1/auth/register", "POST", "{}", {
        origin: "http://localhost",
        "content-type": "application/json",
      }),
      ["api", "v1", "auth", "register"],
      services,
    );
    expect(result.status).toBe(401);
    expect(auth.createInvitation).not.toHaveBeenCalled();
    expect(auth.acceptInvitation).not.toHaveBeenCalled();
  });

  it("does not expose first-admin bootstrap over HTTP", async () => {
    const { services, db, auth } = setup(admin);
    const result = await handleApiRequest(
      request("/api/v1/auth/bootstrap", "POST", "{}", {
        ...loggedHeaders(),
        "content-type": "application/json",
      }),
      ["api", "v1", "auth", "bootstrap"],
      services,
    );

    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "NOT_FOUND" });
    expect(db.query).not.toHaveBeenCalled();
    expect(auth.authenticatePassword).not.toHaveBeenCalled();
    expect(auth.createInvitation).not.toHaveBeenCalled();
  });

  it("denies AM access to team administration", async () => {
    const { services, db } = setup(am);
    const result = await handleApiRequest(
      request("/api/v1/teams", "GET", undefined, loggedHeaders()),
      ["api", "v1", "teams"],
      services,
    );
    expect(result.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([am, manager, admin])(
    "passes an authenticated role to the lead repository for scope enforcement",
    async (principal) => {
      const { services, leads } = setup(principal);
      const result = await handleApiRequest(
        request(
          "/api/v1/leads?limit=50&offset=0",
          "GET",
          undefined,
          loggedHeaders(),
        ),
        ["api", "v1", "leads"],
        services,
      );
      expect(result.status).toBe(200);
      expect(leads.listLeads).toHaveBeenCalledWith(principal, {
        limit: 50,
        offset: 0,
      });
    },
  );

  it("audits lead detail access with metadata only and returns masked contacts", async () => {
    const { services, leads, db } = setup(am);
    const result = await handleApiRequest(
      request("/api/v1/leads/lead-1", "GET", undefined, loggedHeaders()),
      ["api", "v1", "leads", "lead-1"],
      services,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      id: "lead-1",
      contacts: [{ phone: "09••••••67", email: "a•••@example.test" }],
    });
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute.mock.calls[0]?.[0]).toContain("LEAD_VIEWED");
    expect(JSON.stringify(db.execute.mock.calls[0])).not.toContain(
      "09••••••67",
    );
    expect(leads.getLeadDetail).toHaveBeenCalledWith(am, "lead-1");
  });

  it("does not reveal out-of-scope lead details or record a successful view", async () => {
    const { services, leads, db } = setup(am);
    const denied = Object.assign(new Error("NOT_FOUND"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
    leads.getLeadDetail.mockRejectedValueOnce(denied);
    const result = await handleApiRequest(
      request("/api/v1/leads/other-team-id", "GET", undefined, loggedHeaders()),
      ["api", "v1", "leads", "other-team-id"],
      services,
    );
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "NOT_FOUND" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("accepts a one-time invite without creating a public signup form", async () => {
    const { services, auth } = setup(null);
    const result = await handleApiRequest(
      request(
        "/api/v1/auth/invitations/accept",
        "POST",
        JSON.stringify({
          token: "x".repeat(40),
          password: "correct horse battery staple",
          displayName: "Synthetic User",
        }),
        { origin: "http://localhost", "content-type": "application/json" },
      ),
      ["api", "v1", "auth", "invitations", "accept"],
      services,
    );
    expect(result.status).toBe(201);
    expect(auth.acceptInvitation).toHaveBeenCalledOnce();
  });

  it("does not touch database or log upload content on malformed workbook", async () => {
    const { services, db } = setup();
    const form = new FormData();
    form.set(
      "file",
      new File(["not a workbook"], "bad.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const result = await handleApiRequest(
      request("/api/v1/import-jobs", "POST", form, loggedHeaders()),
      ["api", "v1", "import-jobs"],
      services,
    );
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "INVALID_XLSX_SIGNATURE" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("rejects oversized upload before reading workbook bytes", async () => {
    const { services, db } = setup();
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.xlsx"),
    );
    const result = await handleApiRequest(
      request("/api/v1/import-jobs", "POST", form, loggedHeaders()),
      ["api", "v1", "import-jobs"],
      services,
    );
    expect(result.status).toBe(413);
    expect(await result.json()).toEqual({ error: "FILE_TOO_LARGE" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("creates a preview through the service but performs no database writes", async () => {
    const { services, db } = setup();
    const preview = {
      previewId: "preview-1",
      headerInspection: {
        status: "READY",
        columnMap: [],
        quarantinedColumns: [],
        warnings: [],
      },
      rows: [],
      totalRows: 0,
      commitEligible: false,
      decisionStatus: "AWAITING_AM_REVIEW",
    };
    const imports = services.imports as unknown as {
      upload: (input: unknown) => unknown;
      validate: (input: unknown) => unknown;
    };
    Object.assign(imports, {
      upload: vi.fn(() => ({
        success: true,
        value: {
          handle: "handle-1",
          status: "UPLOADED",
          expiresAt: "2026-11-03T00:00:00.000Z",
        },
      })),
      validate: vi.fn(() => ({ success: true, value: preview })),
    });
    const uploadForm = new FormData();
    uploadForm.set("file", new File(["synthetic"], "synthetic.xlsx"));
    const uploaded = await handleApiRequest(
      request("/api/v1/import-jobs", "POST", uploadForm, loggedHeaders()),
      ["api", "v1", "import-jobs"],
      services,
    );
    expect(uploaded.status).toBe(201);
    const validateForm = new FormData();
    validateForm.set("file", new File(["synthetic"], "synthetic.xlsx"));
    const validated = await handleApiRequest(
      request(
        "/api/v1/import-jobs/handle-1/validate",
        "POST",
        validateForm,
        loggedHeaders(),
      ),
      ["api", "v1", "import-jobs", "handle-1", "validate"],
      services,
    );
    expect(validated.status).toBe(200);
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected exception text instead of returning internal content", async () => {
    const { services, auth } = setup(null);
    auth.authenticatePassword.mockRejectedValueOnce(
      new Error("raw-email@example.test and secret"),
    );
    const result = await handleApiRequest(
      request(
        "/api/v1/auth/login",
        "POST",
        JSON.stringify({
          workspaceId: "workspace-1",
          email: "admin@example.test",
          password: "secret",
        }),
        { origin: "http://localhost", "content-type": "application/json" },
      ),
      ["api", "v1", "auth", "login"],
      services,
    );
    expect(result.status).toBe(500);
    const text = await result.text();
    expect(text).not.toContain("raw-email@example.test");
    expect(text).not.toContain("secret");
  });

  it("serves Phase 2-4 social-accounts, publishing-calendar, campaigns-overview routes with auth/CSRF and mutates approval & QR login state", async () => {
    const unauth = setup(null);
    const rUnauth = await handleApiRequest(
      request("/api/v1/social-accounts"),
      ["api", "v1", "social-accounts"],
      unauth.services,
    );
    expect(rUnauth.status).toBe(401);

    const { services } = setup(am);

    // Cross-origin POST rejected by CSRF guard
    const csrfBlocked = await handleApiRequest(
      request(
        "/api/v1/social-accounts/am_zalo_01/qr-login",
        "POST",
        JSON.stringify({ platform: "ZALO" }),
        {
          ...loggedHeaders(),
          "content-type": "application/json",
          origin: "https://evil.invalid",
        },
      ),
      ["api", "v1", "social-accounts", "am_zalo_01", "qr-login"],
      services,
    );
    expect(csrfBlocked.status).toBe(403);

    // Trigger QR login registers/updates account state and returns 200
    const qrRes = await handleApiRequest(
      request(
        "/api/v1/social-accounts/am_zalo_01/qr-login",
        "POST",
        JSON.stringify({ platform: "ZALO" }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "social-accounts", "am_zalo_01", "qr-login"],
      services,
    );
    expect(qrRes.status).toBe(200);
    const qrPayload = (await qrRes.json()) as { status: string; accountId: string };
    expect(qrPayload.accountId).toBe("am_zalo_01");

    const accountsRes = await handleApiRequest(
      request("/api/v1/social-accounts", "GET", undefined, loggedHeaders()),
      ["api", "v1", "social-accounts"],
      services,
    );
    expect(accountsRes.status).toBe(200);
    const accountsBody = (await accountsRes.json()) as {
      items: Array<{ accountId: string; profileDir: string }>;
    };
    expect(
      accountsBody.items.some((i) => i.accountId === "am_zalo_01"),
    ).toBe(true);

    // Create/seed draft calendar post via POST, then approve it via POST /approve
    const createDraftRes = await handleApiRequest(
      request(
        "/api/v1/publishing-calendar",
        "POST",
        JSON.stringify({
          contentId: "POST-API-01",
          topic: "CHU_KY_SO",
          platform: "FACEBOOK",
          mode: "SEMI_AUTO",
          publishTime: "2026-11-06T09:00:00.000Z",
          content: "Chia sẻ giải pháp chữ ký số SME.",
        }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "publishing-calendar"],
      services,
    );
    expect(createDraftRes.status).toBe(201);

    const approveRes = await handleApiRequest(
      request(
        "/api/v1/publishing-calendar/POST-API-01/approve",
        "POST",
        JSON.stringify({}),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "publishing-calendar", "POST-API-01", "approve"],
      services,
    );
    expect(approveRes.status).toBe(200);

    const calRes = await handleApiRequest(
      request("/api/v1/publishing-calendar", "GET", undefined, loggedHeaders()),
      ["api", "v1", "publishing-calendar"],
      services,
    );
    expect(calRes.status).toBe(200);
    const calBody = (await calRes.json()) as {
      items: Array<{ contentId: string; status: string }>;
    };
    expect(calBody.items.find((i) => i.contentId === "POST-API-01")?.status).toBe(
      "APPROVED",
    );

    const campRes = await handleApiRequest(
      request("/api/v1/campaigns-overview", "GET", undefined, loggedHeaders()),
      ["api", "v1", "campaigns-overview"],
      services,
    );
    expect(campRes.status).toBe(200);
    const campBody = (await campRes.json()) as {
      campaigns: unknown[];
      partners: unknown[];
    };
    expect(Array.isArray(campBody.campaigns)).toBe(true);
    expect(Array.isArray(campBody.partners)).toBe(true);
  });

  it("serves standard import template via GET /api/v1/import-template", async () => {
    const { services } = setup(am);
    const res = await handleApiRequest(
      request("/api/v1/import-template", "GET", undefined, loggedHeaders()),
      ["api", "v1", "import-template"],
      services,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);
  });

  it("handles social account declaration and connection via API", async () => {
    const { services } = setup(am);
    const declRes = await handleApiRequest(
      request(
        "/api/v1/social-accounts",
        "POST",
        JSON.stringify({ accountId: "zalo-test-am03", platform: "ZALO" }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "social-accounts"],
      services,
    );
    expect(declRes.status).toBe(201);
    const declBody = (await declRes.json()) as { status: string; accountId: string };
    expect(declBody.status).toBe("NEEDS_LOGIN");

    const connRes = await handleApiRequest(
      request(
        "/api/v1/social-accounts/zalo-test-am03/connect",
        "POST",
        JSON.stringify({ platform: "ZALO" }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "social-accounts", "zalo-test-am03", "connect"],
      services,
    );
    expect(connRes.status).toBe(200);
    const connBody = (await connRes.json()) as { status: string };
    expect(connBody.status).toBe("CONNECTED");
  });

  it("handles campaigns creation and approval via API", async () => {
    const { services } = setup(am);
    const createRes = await handleApiRequest(
      request(
        "/api/v1/campaigns",
        "POST",
        JSON.stringify({
          campaignId: "CAMP-API-01",
          name: "Chiến dịch tuyển CTV kế toán",
          campaignType: "PARTNER_RECRUITMENT",
          targetCategories: ["ACCOUNTING_TAX"],
          contentTemplate: "Chào anh/chị, Viettel tuyển CTV...",
        }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "campaigns"],
      services,
    );
    expect(createRes.status).toBe(201);

    const approveRes = await handleApiRequest(
      request(
        "/api/v1/campaigns/CAMP-API-01/approve",
        "POST",
        JSON.stringify({}),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "campaigns", "CAMP-API-01", "approve"],
      services,
    );
    expect(approveRes.status).toBe(200);
  });

  it("handles partner registration and stage transition via API", async () => {
    const { services } = setup(am);
    const regRes = await handleApiRequest(
      request(
        "/api/v1/partners",
        "POST",
        JSON.stringify({
          partnerId: "PARTNER-API-01",
          fullName: "Lê Thị CTV",
          phone: "0987654321",
          profession: "ACCOUNTANT",
          notes: "CTV chuyên thuế Dĩ An",
        }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "partners"],
      services,
    );
    expect(regRes.status).toBe(201);

    const stageRes = await handleApiRequest(
      request(
        "/api/v1/partners/PARTNER-API-01/stage",
        "POST",
        JSON.stringify({ newStage: "CONTACTED" }),
        { ...loggedHeaders(), "content-type": "application/json" },
      ),
      ["api", "v1", "partners", "PARTNER-API-01", "stage"],
      services,
    );
    expect(stageRes.status).toBe(200);
    const stageBody = (await stageRes.json()) as { stage: string };
    expect(stageBody.stage).toBe("CONTACTED");
  });
});
