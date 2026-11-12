import { describe, expect, it } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";

describe("PB-P04 & PB-P05 End-to-End Integration Test", () => {
  it("executes full workflow: Sync Media -> Approve Media -> Match Media to Post -> Validate Post -> Approve with Audit Trail -> Verify Versions & Approvals", async () => {
    const services = createDemoApiServices();

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

    // 1. Sync a Google Document to create posts (PB_SYNC_01: CHU_KY_SO, PB_SYNC_02: HOA_DON_DIEN_TU)
    const syncDocRes = await handleApiRequest(
      req("/api/v1/google/sync-documents", "POST", {
        connectionId: "conn-viettel-dian",
        documentId: "gdoc_viettel_am_posts",
      }),
      ["api", "v1", "google", "sync-documents"],
      services,
    );
    expect(syncDocRes.status).toBe(200);

    const postsRes = await handleApiRequest(
      req("/api/v1/contents?topicCode=HOA_DON_DIEN_TU"),
      ["api", "v1", "contents"],
      services,
    );
    const postsData = (await postsRes.json()) as any;
    const targetPost = postsData.items.find((p: any) => p.postCode === "PB_SYNC_02");
    expect(targetPost).toBeDefined();

    // 2. Reject invalid media file (PDF) during Drive media sync
    const invalidMediaRes = await handleApiRequest(
      req("/api/v1/media/sync", "POST", {
        driveFileId: "drive-invalid-pdf",
        fileName: "PB_SYNC_02_HOA_DON_DIEN_TU.pdf",
        mimeType: "application/pdf",
        sizeBytes: 300000,
        checksum: "sha256-pdf-invalid",
        topicCode: "HOA_DON_DIEN_TU",
      }),
      ["api", "v1", "media", "sync"],
      services,
    );
    expect(invalidMediaRes.status).toBe(400);
    const invalidMediaBody = (await invalidMediaRes.json()) as any;
    expect(invalidMediaBody.error).toBe("UNSUPPORTED_MEDIA_TYPE");

    // 3. Sync valid image for HOA_DON_DIEN_TU (initially PENDING)
    const syncMediaRes = await handleApiRequest(
      req("/api/v1/media/sync", "POST", {
        driveFileId: "drive-sinvoice-banner-01",
        fileName: "PB_SYNC_02_HOA_DON_DIEN_TU_1.png",
        mimeType: "image/png",
        sizeBytes: 512000,
        checksum: "sha256-sinvoice-banner-v1",
        topicCode: "HOA_DON_DIEN_TU",
        postCodeHint: "PB_SYNC_02",
        status: "PENDING",
      }),
      ["api", "v1", "media", "sync"],
      services,
    );
    expect(syncMediaRes.status).toBe(201);
    const syncedMedia = ((await syncMediaRes.json()) as any).media;
    expect(syncedMedia.version).toBe(1);
    expect(syncedMedia.status).toBe("PENDING");

    // 4. Approve the synced media asset
    const approveMediaRes = await handleApiRequest(
      req(`/api/v1/media/${syncedMedia.id}/approve`, "POST"),
      ["api", "v1", "media", syncedMedia.id, "approve"],
      services,
    );
    expect(approveMediaRes.status).toBe(200);
    const approvedMedia = (await approveMediaRes.json()) as any;
    expect(approvedMedia.status).toBe("APPROVED");

    // 5. Re-sync the same Drive file with a new checksum -> verify version bumps to 2 (PB-MT-009)
    const updateMediaRes = await handleApiRequest(
      req("/api/v1/media/sync", "POST", {
        driveFileId: "drive-sinvoice-banner-01",
        fileName: "PB_SYNC_02_HOA_DON_DIEN_TU_1.png",
        mimeType: "image/png",
        sizeBytes: 540000,
        checksum: "sha256-sinvoice-banner-v2",
        topicCode: "HOA_DON_DIEN_TU",
        postCodeHint: "PB_SYNC_02",
        status: "APPROVED",
      }),
      ["api", "v1", "media", "sync"],
      services,
    );
    expect(updateMediaRes.status).toBe(201);
    const updatedMedia = ((await updateMediaRes.json()) as any).media;
    expect(updatedMedia.version).toBe(2);

    // Check media detail & version history
    const mediaDetailRes = await handleApiRequest(
      req(`/api/v1/media/${syncedMedia.id}`),
      ["api", "v1", "media", syncedMedia.id],
      services,
    );
    expect(mediaDetailRes.status).toBe(200);
    const mediaDetail = (await mediaDetailRes.json()) as any;
    expect(mediaDetail.versions).toHaveLength(2);

    // 6. Run Content-Media Matching Engine on targetPost (PB_SYNC_02)
    const matchRes = await handleApiRequest(
      req(`/api/v1/contents/${targetPost.id}/match-media`, "POST"),
      ["api", "v1", "contents", targetPost.id, "match-media"],
      services,
    );
    expect(matchRes.status).toBe(200);
    const matchData = (await matchRes.json()) as any;
    expect(matchData.match.status).toBe("MATCHED");
    expect(matchData.match.matchedBy).toBe("POST_ID");
    expect(matchData.match.selectedMedia.id).toBe(syncedMedia.id);
    expect(matchData.link).toBeDefined();

    // 7. Run Content Validation Engine on targetPost
    const validateRes = await handleApiRequest(
      req(`/api/v1/contents/${targetPost.id}/validate`, "POST"),
      ["api", "v1", "contents", targetPost.id, "validate"],
      services,
    );
    expect(validateRes.status).toBe(200);
    const validateData = (await validateRes.json()) as any;
    expect(validateData.valid).toBe(true);
    expect(validateData.status).toBe("VALID");
    expect(validateData.issues).toHaveLength(0);
    expect(validateData.linkedMediaCount).toBe(1);

    // 8. Approve post with audit trail (records contentVersion=1, mediaVersion=2, approvedPlatforms, notes)
    const approvePostRes = await handleApiRequest(
      req(`/api/v1/contents/${targetPost.id}/approve`, "POST", {
        approvedPlatforms: ["ZALO"],
        notes: "Đã kiểm duyệt nội dung và banner S-Invoice v2 cho kênh Zalo cá nhân.",
      }),
      ["api", "v1", "contents", targetPost.id, "approve"],
      services,
    );
    expect(approvePostRes.status).toBe(200);
    const approvePostData = (await approvePostRes.json()) as any;
    expect(approvePostData.status).toBe("APPROVED");
    expect(approvePostData.approval).toBeDefined();
    expect(approvePostData.approval.contentVersion).toBe(1);
    expect(approvePostData.approval.mediaVersion).toBe(2);
    expect(approvePostData.approval.approvedPlatforms).toEqual(["ZALO"]);

    // 9. Verify GET /api/v1/contents/:id/versions returns both content versions and approval audit records
    const versionsRes = await handleApiRequest(
      req(`/api/v1/contents/${targetPost.id}/versions`),
      ["api", "v1", "contents", targetPost.id, "versions"],
      services,
    );
    expect(versionsRes.status).toBe(200);
    const versionsData = (await versionsRes.json()) as any;
    expect(versionsData.versions).toHaveLength(1);
    expect(versionsData.approvals).toHaveLength(1);
    expect(versionsData.approvals[0].notes).toContain("banner S-Invoice v2");
  });
});

