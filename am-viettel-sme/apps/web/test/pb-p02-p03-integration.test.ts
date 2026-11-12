import { describe, expect, it } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";

describe("PB-P02 & PB-P03 End-to-End Integration Test", () => {
  it("executes full workflow: Google Doc sync -> Parse -> Topic Classification -> Content Library -> Post Approval", async () => {
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

    // 1. Initially check content library has seeded demo posts
    const initialContentsRes = await handleApiRequest(
      req("/api/v1/contents"),
      ["api", "v1", "contents"],
      services,
    );
    expect(initialContentsRes.status).toBe(200);
    const initialContents = (await initialContentsRes.json()) as any;
    expect(initialContents.items.length).toBeGreaterThanOrEqual(3);

    // 2. Sync Google Document containing [POST_START]...[POST_END] structured posts
    const syncRes = await handleApiRequest(
      req("/api/v1/google/sync-documents", "POST", {
        connectionId: "conn-viettel-dian",
        documentId: "gdoc_viettel_am_posts",
      }),
      ["api", "v1", "google", "sync-documents"],
      services,
    );
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    expect(syncData.success).toBe(true);
    expect(syncData.postsCount).toBe(2);
    expect(syncData.posts.map((p: any) => p.postCode)).toEqual(["PB_SYNC_01", "PB_SYNC_02"]);

    // 3. Verify Google Document is registered in documents list
    const docsRes = await handleApiRequest(
      req("/api/v1/google/documents?connectionId=conn-viettel-dian"),
      ["api", "v1", "google", "documents"],
      services,
    );
    expect(docsRes.status).toBe(200);
    const docsData = (await docsRes.json()) as any;
    const syncedDoc = docsData.items.find((d: any) => d.documentId === "gdoc_viettel_am_posts");
    expect(syncedDoc).toBeDefined();
    expect(syncedDoc.name).toContain("Viettel AM");

    // 4. Query posts filtered by classified topic
    const cksRes = await handleApiRequest(
      req("/api/v1/contents?topicCode=CHU_KY_SO"),
      ["api", "v1", "contents"],
      services,
    );
    expect(cksRes.status).toBe(200);
    const cksData = (await cksRes.json()) as any;
    const syncedCksPost = cksData.items.find((p: any) => p.postCode === "PB_SYNC_01");
    expect(syncedCksPost).toBeDefined();
    expect(syncedCksPost.topicCode).toBe("CHU_KY_SO");
    expect(syncedCksPost.platforms).toEqual(["ZALO", "FACEBOOK"]);

    // 5. Query draft post PB_SYNC_02 and approve it
    const allPostsRes = await handleApiRequest(
      req("/api/v1/contents"),
      ["api", "v1", "contents"],
      services,
    );
    const allPosts = (await allPostsRes.json()) as any;
    const draftPost = allPosts.items.find((p: any) => p.postCode === "PB_SYNC_02");
    expect(draftPost).toBeDefined();
    expect(draftPost.status).toBe("DRAFT");

    // Approve the post
    const approveRes = await handleApiRequest(
      req(`/api/v1/contents/${draftPost.id}/approve`, "POST"),
      ["api", "v1", "contents", draftPost.id, "approve"],
      services,
    );
    expect(approveRes.status).toBe(200);
    const approvedData = (await approveRes.json()) as any;
    expect(approvedData.status).toBe("APPROVED");

    // 6. Verify post detail and version tracking
    const detailRes = await handleApiRequest(
      req(`/api/v1/contents/${draftPost.id}`),
      ["api", "v1", "contents", draftPost.id],
      services,
    );
    expect(detailRes.status).toBe(200);
    const detailData = (await detailRes.json()) as any;
    expect(detailData.post.id).toBe(draftPost.id);
    expect(detailData.post.status).toBe("APPROVED");
    expect(detailData.versions.length).toBeGreaterThanOrEqual(1);
    expect(detailData.versions[0].version).toBe(1);
  });
});
