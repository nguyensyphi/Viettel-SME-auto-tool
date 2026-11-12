import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";

const am = {
  userId: "am-user-1",
  workspaceId: "workspace-content-test",
  role: "AM" as const,
  teamId: "team-content-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("Content Library & Google Docs Sync HTTP API (PB-P02, PB-P03)", () => {
  let mockContentRepo: any;
  let mockSyncService: any;
  let services: ApiServices;

  beforeEach(() => {
    mockContentRepo = {
      listGoogleDocuments: vi.fn(async (connId: string) => [
        {
          id: "gdoc-rec-1",
          connectionId: connId,
          documentId: "gdoc_123",
          name: "Viettel AM Chữ ký số Content",
          revisionId: "rev_1",
          contentHash: "hash_doc_1",
          postCount: 2,
          modifiedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString(),
        },
      ]),
      listPosts: vi.fn(async (wsId: string, filters?: any) => {
        const all = [
          {
            id: "post-1",
            workspaceId: wsId,
            documentId: "gdoc-rec-1",
            postCode: "PB001",
            title: "Ưu đãi Chữ ký số Viettel-CA cho DN mới thành lập",
            body: "Nội dung bài viết CKS",
            topicCode: "CHU_KY_SO",
            targetAudience: "BUSINESS_OWNER",
            platforms: ["ZALO", "FACEBOOK"],
            status: "DRAFT",
            priority: "HIGH",
            mediaHint: "AUTO",
            hashtags: ["#Viettel", "#ChuKySo"],
            version: 1,
            contentHash: "hash-pb001",
            validFrom: null,
            validUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "post-2",
            workspaceId: wsId,
            documentId: "gdoc-rec-1",
            postCode: "PB002",
            title: "Hóa đơn điện tử S-Invoice",
            body: "Nội dung hóa đơn điện tử",
            topicCode: "HOA_DON_DIEN_TU",
            targetAudience: "BUSINESS_OWNER",
            platforms: ["ZALO"],
            status: "APPROVED",
            priority: "NORMAL",
            mediaHint: null,
            hashtags: ["#SInvoice"],
            version: 2,
            contentHash: "hash-pb002",
            validFrom: null,
            validUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        if (filters?.topicCode) {
          return all.filter((p) => p.topicCode === filters.topicCode);
        }
        if (filters?.status) {
          return all.filter((p) => p.status === filters.status);
        }
        return all;
      }),
      getPostById: vi.fn(async (wsId: string, id: string) => {
        if (id === "post-1") {
          return {
            id: "post-1",
            workspaceId: wsId,
            documentId: "gdoc-rec-1",
            postCode: "PB001",
            title: "Ưu đãi Chữ ký số Viettel-CA",
            body: "Nội dung bài viết CKS",
            topicCode: "CHU_KY_SO",
            targetAudience: "BUSINESS_OWNER",
            platforms: ["ZALO", "FACEBOOK"],
            status: "DRAFT",
            priority: "HIGH",
            mediaHint: "AUTO",
            hashtags: ["#Viettel", "#ChuKySo"],
            version: 1,
            contentHash: "hash-pb001",
            validFrom: null,
            validUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      }),
      listPostVersions: vi.fn(async (contentId: string) => {
        if (contentId === "post-1") {
          return [
            {
              id: "v-1",
              contentId: "post-1",
              version: 1,
              contentHash: "hash-pb001",
              title: "Ưu đãi Chữ ký số Viettel-CA",
              body: "Nội dung bài viết CKS",
              topicCode: "CHU_KY_SO",
              hashtags: ["#Viettel", "#ChuKySo"],
              createdAt: new Date().toISOString(),
            },
          ];
        }
        return [];
      }),
      updatePostStatus: vi.fn(async (wsId: string, id: string, status: string) => {
        return {
          id,
          workspaceId: wsId,
          status,
          updatedAt: new Date().toISOString(),
        };
      }),
    };

    mockSyncService = {
      syncDocument: vi.fn(async (opts: any) => {
        if (opts.documentId === "gdoc-pii") {
          return {
            success: false,
            errorCode: "PII_DETECTED",
            errorMessage: "PII_DETECTED: CCCD pattern found",
          };
        }
        return {
          success: true,
          document: { id: "doc-uuid-1", name: "Doc Name" },
          postsCount: 2,
          posts: [
            { id: "post-1", postCode: "PB001", version: 1, status: "DRAFT" },
            { id: "post-2", postCode: "PB002", version: 1, status: "APPROVED" },
          ],
        };
      }),
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
      contentLibrary: mockContentRepo,
      googleDocsSync: mockSyncService,
    };
  });

  it("POST /api/v1/google/sync-documents syncs Google Doc into Content Library", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/sync-documents", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          connectionId: "conn-123",
          documentId: "gdoc_123",
        }),
      }),
      ["api", "v1", "google", "sync-documents"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.postsCount).toBe(2);
    expect(mockSyncService.syncDocument).toHaveBeenCalledWith({
      workspaceId: am.workspaceId,
      connectionId: "conn-123",
      documentId: "gdoc_123",
    });
  });

  it("POST /api/v1/google/sync-documents blocks document when PII is detected", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/sync-documents", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          connectionId: "conn-123",
          documentId: "gdoc-pii",
        }),
      }),
      ["api", "v1", "google", "sync-documents"],
      services,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("PII_DETECTED");
  });

  it("GET /api/v1/google/documents lists synced documents", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/google/documents?connectionId=conn-123", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "google", "documents"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].documentId).toBe("gdoc_123");
  });

  it("GET /api/v1/contents lists posts with optional topic and status filter", async () => {
    const resAll = await handleApiRequest(
      new Request("http://localhost/api/v1/contents", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "contents"],
      services,
    );
    expect(resAll.status).toBe(200);
    const allBody = (await resAll.json()) as any;
    expect(allBody.items).toHaveLength(2);

    const resFiltered = await handleApiRequest(
      new Request("http://localhost/api/v1/contents?topicCode=CHU_KY_SO", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "contents"],
      services,
    );
    expect(resFiltered.status).toBe(200);
    const filteredBody = (await resFiltered.json()) as any;
    expect(filteredBody.items).toHaveLength(1);
    expect(filteredBody.items[0].postCode).toBe("PB001");
  });

  it("GET /api/v1/contents/:id returns post detail and version history", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "contents", "post-1"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.post.id).toBe("post-1");
    expect(body.versions).toHaveLength(1);
  });

  it("POST /api/v1/contents/:id/approve approves a post", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/approve", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "contents", "post-1", "approve"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("APPROVED");
    expect(mockContentRepo.updatePostStatus).toHaveBeenCalledWith(
      am.workspaceId,
      "post-1",
      "APPROVED",
    );
  });

  it("POST /api/v1/contents/:id/reject rejects a post", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/reject", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "contents", "post-1", "reject"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("REJECTED");
    expect(mockContentRepo.updatePostStatus).toHaveBeenCalledWith(
      am.workspaceId,
      "post-1",
      "REJECTED",
    );
  });

  it("POST /api/v1/contents creates a new post directly", async () => {
    mockContentRepo.upsertPost = vi.fn(async (input: any) => ({
      id: "post-created-01",
      ...input,
    }));

    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/contents", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          title: "Giải pháp Viettel-CA Cloud",
          content: "Ký số từ xa không cần USB Token",
          topic: "CHU_KY_SO",
          platforms: ["FACEBOOK"],
        }),
      }),
      ["api", "v1", "contents"],
      services,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.post.id).toBe("post-created-01");
    expect(body.post.title).toBe("Giải pháp Viettel-CA Cloud");
    expect(mockContentRepo.upsertPost).toHaveBeenCalled();
  });
});
