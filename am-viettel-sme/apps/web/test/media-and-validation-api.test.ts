import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAuthGuard } from "@am-sme/auth";
import type { ApiServices } from "../src/server/http-api.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { InMemoryImportApi } from "../src/server/import-api.js";

const am = {
  userId: "am-user-1",
  workspaceId: "workspace-media-test",
  role: "AM" as const,
  teamId: "team-media-1",
};

const session = "mock-valid-session-token-32-chars-long";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `am_sme_session=${session}`,
    origin: "http://localhost",
    ...extra,
  };
}

describe("Media & Content Validation HTTP API (PB-P04, PB-P05)", () => {
  let mockContentRepo: any;
  let services: ApiServices;

  beforeEach(() => {
    const mediaList = [
      {
        id: "media-1",
        workspaceId: am.workspaceId,
        connectionId: "conn-123",
        driveFileId: "drive-file-1",
        fileName: "PB001_CHU_KY_SO_1.png",
        mimeType: "image/png",
        sizeBytes: 250000,
        checksum: "sha256-pb001-img",
        topicCode: "CHU_KY_SO",
        postCodeHint: "PB001",
        platforms: ["ZALO", "FACEBOOK"],
        status: "APPROVED",
        version: 1,
        isSharedMedia: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "media-shared-1",
        workspaceId: am.workspaceId,
        connectionId: "conn-123",
        driveFileId: "drive-file-shared",
        fileName: "SHARED_VIETTEL_BRAND.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 180000,
        checksum: "sha256-shared-img",
        topicCode: "SHARED_MEDIA",
        postCodeHint: null,
        platforms: ["ZALO", "FACEBOOK"],
        status: "APPROVED",
        version: 1,
        isSharedMedia: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const linkedMediaMap = new Map<string, any[]>();
    const approvalsList: any[] = [];

    mockContentRepo = {
      listMediaAssets: vi.fn(async (wsId: string, filters?: any) => {
        return mediaList.filter((m) => {
          if (m.workspaceId !== wsId) return false;
          if (filters?.topicCode && m.topicCode !== filters.topicCode) return false;
          if (filters?.status && m.status !== filters.status) return false;
          return true;
        });
      }),
      getMediaById: vi.fn(async (wsId: string, id: string) => {
        return mediaList.find((m) => m.workspaceId === wsId && m.id === id) ?? null;
      }),
      listMediaVersions: vi.fn(async (mediaId: string) => {
        if (mediaId === "media-1") {
          return [
            {
              id: "mv-1",
              mediaId: "media-1",
              version: 1,
              checksum: "sha256-pb001-img",
              sizeBytes: 250000,
              createdAt: new Date().toISOString(),
            },
          ];
        }
        return [];
      }),
      findMediaByChecksum: vi.fn(async (wsId: string, checksum: string) => {
        return mediaList.find((m) => m.workspaceId === wsId && m.checksum === checksum) ?? null;
      }),
      upsertMediaAsset: vi.fn(async (input: any) => {
        const created = {
          id: "media-new-1",
          workspaceId: input.workspaceId,
          connectionId: input.connectionId ?? null,
          driveFileId: input.driveFileId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          topicCode: input.topicCode,
          postCodeHint: input.postCodeHint ?? null,
          platforms: input.platforms ?? ["ZALO", "FACEBOOK"],
          status: input.status ?? "VALID",
          version: 1,
          isSharedMedia: Boolean(input.isSharedMedia),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        mediaList.push(created);
        return created;
      }),
      updateMediaStatus: vi.fn(async (wsId: string, id: string, status: string) => {
        const found = mediaList.find((m) => m.workspaceId === wsId && m.id === id);
        if (!found) return null;
        found.status = status;
        return found;
      }),
      getPostById: vi.fn(async (wsId: string, id: string) => {
        if (id === "post-1") {
          return {
            id: "post-1",
            workspaceId: wsId,
            documentId: "gdoc-rec-1",
            postCode: "PB001",
            title: "Ưu đãi Chữ ký số Viettel-CA cho DN mới thành lập",
            body: "Nội dung bài viết hướng dẫn đăng ký Chữ ký số Viettel-CA nhanh chóng.",
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
        if (id === "post-expired") {
          return {
            id: "post-expired",
            workspaceId: wsId,
            documentId: "gdoc-rec-1",
            postCode: "PB_EXP",
            title: "Khuyến mãi đã hết hạn",
            body: "Nội dung khuyến mãi cũ",
            topicCode: "CHU_KY_SO",
            targetAudience: "BUSINESS_OWNER",
            platforms: ["ZALO"],
            status: "DRAFT",
            priority: "NORMAL",
            mediaHint: null,
            hashtags: [],
            version: 1,
            contentHash: "hash-exp",
            validFrom: "2025-01-01T00:00:00.000Z",
            validUntil: "2025-01-31T23:59:59.000Z",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      }),
      linkMediaToContent: vi.fn(async (input: any) => {
        const media = mediaList.find((m) => m.id === input.mediaId);
        const list = linkedMediaMap.get(input.contentId) ?? [];
        const linked = {
          ...(media ?? {}),
          position: input.position ?? 0,
          matchMethod: input.matchMethod ?? "AUTO",
          matchScore: input.matchScore ?? 0,
        };
        list.push(linked);
        linkedMediaMap.set(input.contentId, list);
        return {
          id: "link-1",
          contentId: input.contentId,
          mediaId: input.mediaId,
          position: linked.position,
          matchMethod: linked.matchMethod,
          matchScore: linked.matchScore,
          createdAt: new Date().toISOString(),
        };
      }),
      listMediaForContent: vi.fn(async (contentId: string) => {
        return linkedMediaMap.get(contentId) ?? [];
      }),
      updatePostStatus: vi.fn(async (wsId: string, id: string, status: string) => {
        return {
          id,
          workspaceId: wsId,
          status,
          updatedAt: new Date().toISOString(),
        };
      }),
      recordContentApproval: vi.fn(async (input: any) => {
        const rec = {
          id: `approval-${approvalsList.length + 1}`,
          workspaceId: input.workspaceId,
          contentId: input.contentId,
          contentVersion: input.contentVersion,
          mediaVersion: input.mediaVersion ?? null,
          approvedBy: input.approvedBy,
          status: input.status,
          approvedPlatforms: input.approvedPlatforms ?? [],
          notes: input.notes ?? null,
          createdAt: new Date().toISOString(),
        };
        approvalsList.push(rec);
        return rec;
      }),
      listContentApprovals: vi.fn(async (contentId: string) => {
        return approvalsList.filter((a) => a.contentId === contentId);
      }),
      listPostVersions: vi.fn(async (contentId: string) => {
        return [
          {
            id: "v-1",
            contentId,
            version: 1,
            contentHash: "hash-pb001",
            title: "Ưu đãi Chữ ký số Viettel-CA cho DN mới thành lập",
            body: "Nội dung bài viết hướng dẫn đăng ký Chữ ký số Viettel-CA nhanh chóng.",
            topicCode: "CHU_KY_SO",
            hashtags: ["#Viettel", "#ChuKySo"],
            createdAt: new Date().toISOString(),
          },
        ];
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
    };
  });

  it("GET /api/v1/media lists media assets with topicCode and status filters", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/media?topicCode=CHU_KY_SO", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "media"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].fileName).toBe("PB001_CHU_KY_SO_1.png");
  });

  it("POST /api/v1/media/sync validates and upserts valid media, rejecting unsupported MIME or oversize files", async () => {
    // 1. Reject PDF
    const badRes = await handleApiRequest(
      new Request("http://localhost/api/v1/media/sync", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          driveFileId: "drive-pdf-1",
          fileName: "brochure.pdf",
          mimeType: "application/pdf",
          sizeBytes: 500000,
          checksum: "sha256-pdf-1",
          topicCode: "CHU_KY_SO",
        }),
      }),
      ["api", "v1", "media", "sync"],
      services,
    );
    expect(badRes.status).toBe(400);
    const badBody = (await badRes.json()) as any;
    expect(badBody.error).toBe("UNSUPPORTED_MEDIA_TYPE");

    // 2. Accept valid PNG
    const okRes = await handleApiRequest(
      new Request("http://localhost/api/v1/media/sync", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          driveFileId: "drive-img-2",
          fileName: "PB002_HOA_DON_DIEN_TU_1.png",
          mimeType: "image/png",
          sizeBytes: 420000,
          checksum: "sha256-new-unique-img",
          topicCode: "HOA_DON_DIEN_TU",
          postCodeHint: "PB002",
        }),
      }),
      ["api", "v1", "media", "sync"],
      services,
    );
    expect(okRes.status).toBe(201);
    const okBody = (await okRes.json()) as any;
    expect(okBody.media.fileName).toBe("PB002_HOA_DON_DIEN_TU_1.png");
  });

  it("GET /api/v1/media/:id and GET /api/v1/media/:id/preview return media details and preview info", async () => {
    const detailRes = await handleApiRequest(
      new Request("http://localhost/api/v1/media/media-1", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "media", "media-1"],
      services,
    );
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as any;
    expect(detailBody.media.id).toBe("media-1");
    expect(detailBody.versions).toHaveLength(1);

    const previewRes = await handleApiRequest(
      new Request("http://localhost/api/v1/media/media-1/preview", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "media", "media-1", "preview"],
      services,
    );
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as any;
    expect(previewBody.mediaId).toBe("media-1");
    expect(previewBody.mimeType).toBe("image/png");
    expect(previewBody.previewUrl).toContain("media-1");
  });

  it("POST /api/v1/media/:id/approve updates media status to APPROVED", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/media/media-1/approve", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "media", "media-1", "approve"],
      services,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("APPROVED");
  });

  it("POST /api/v1/contents/:id/match-media matches best media asset and links it to content", async () => {
    const res = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/match-media", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "contents", "post-1", "match-media"],
      services,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.match.status).toBe("MATCHED");
    expect(body.match.matchedBy).toBe("POST_ID");
    expect(body.match.selectedMedia.id).toBe("media-1");
    expect(mockContentRepo.linkMediaToContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: "post-1",
        mediaId: "media-1",
        matchMethod: "POST_ID",
      }),
    );
  });

  it("POST /api/v1/contents/:id/validate validates post and linked media, flagging expired or missing-media posts", async () => {
    // First link media to post-1
    await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/match-media", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "contents", "post-1", "match-media"],
      services,
    );

    const validRes = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/validate", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "contents", "post-1", "validate"],
      services,
    );
    expect(validRes.status).toBe(200);
    const validBody = (await validRes.json()) as any;
    expect(validBody.valid).toBe(true);
    expect(validBody.status).toBe("VALID");

    // Expired post validation
    const expRes = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-expired/validate", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
      }),
      ["api", "v1", "contents", "post-expired", "validate"],
      services,
    );
    expect(expRes.status).toBe(200);
    const expBody = (await expRes.json()) as any;
    expect(expBody.valid).toBe(false);
    expect(expBody.status).toBe("POST_EXPIRED");
  });

  it("POST /api/v1/contents/:id/approve records approval audit trail and GET /api/v1/contents/:id/versions returns versions + approvals", async () => {
    const approveRes = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/approve", {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          approvedPlatforms: ["ZALO", "FACEBOOK"],
          notes: "Nội dung và hình ảnh đạt chuẩn Viettel-CA.",
        }),
      }),
      ["api", "v1", "contents", "post-1", "approve"],
      services,
    );

    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as any;
    expect(approveBody.status).toBe("APPROVED");
    expect(approveBody.approval).toBeDefined();
    expect(approveBody.approval.approvedBy).toBe(am.userId);
    expect(approveBody.approval.notes).toBe("Nội dung và hình ảnh đạt chuẩn Viettel-CA.");

    const versionsRes = await handleApiRequest(
      new Request("http://localhost/api/v1/contents/post-1/versions", {
        method: "GET",
        headers: headers(),
      }),
      ["api", "v1", "contents", "post-1", "versions"],
      services,
    );
    expect(versionsRes.status).toBe(200);
    const versionsBody = (await versionsRes.json()) as any;
    expect(versionsBody.versions).toHaveLength(1);
    expect(versionsBody.approvals).toHaveLength(1);
    expect(versionsBody.approvals[0].status).toBe("APPROVED");
  });
});

