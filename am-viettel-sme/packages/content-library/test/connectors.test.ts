import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStructuredPosts } from "../src/content-parser.js";
import { GoogleDocsConnector } from "../src/google-docs-connector.js";
import { GoogleDriveConnector } from "../src/google-drive-connector.js";

describe("Content Library — Docs Parser & Google Docs/Drive Connectors (Task 8)", () => {
  let tempCacheDir: string;

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-media-cache-"));
  });

  afterEach(() => {
    fs.rmSync(tempCacheDir, { recursive: true, force: true });
  });

  describe("parseStructuredPosts", () => {
    it("parses structured CONTENT_ID, TOPIC, MEDIA_REQUIRED, PLATFORMS and multi-line CONTENT", () => {
      const rawDoc = `
CONTENT_ID: POST-CA-001
TOPIC: CHU_KY_SO
MEDIA_REQUIRED: true
PLATFORMS: ZALO, FACEBOOK
CONTENT:
Doanh nghiệp mới thành lập cần lưu ý 3 mốc kê khai thuế ban đầu.
Liên hệ AM để được hướng dẫn quy trình chuẩn.
---
CONTENT_ID: POST-HDDT-002
TOPIC: HOA_DON_DIEN_TU
CONTENT:
Hướng dẫn rà soát hóa đơn điện tử khởi tạo từ máy tính tiền cho cửa hàng F&B.
      `;

      const posts = parseStructuredPosts(rawDoc);

      expect(posts).toHaveLength(2);
      expect(posts[0]).toEqual({
        contentId: "POST-CA-001",
        topic: "CHU_KY_SO",
        mediaRequired: true,
        platforms: ["ZALO", "FACEBOOK"],
        content:
          "Doanh nghiệp mới thành lập cần lưu ý 3 mốc kê khai thuế ban đầu.\nLiên hệ AM để được hướng dẫn quy trình chuẩn.",
        lifecycleStatus: "DRAFT",
      });
      expect(posts[1]?.contentId).toBe("POST-HDDT-002");
      expect(posts[1]?.mediaRequired).toBe(false);
      expect(posts[1]?.lifecycleStatus).toBe("DRAFT");
    });

    it("rejects duplicate CONTENT_ID or missing mandatory fields", () => {
      const dupDoc = `
CONTENT_ID: DUP-01
TOPIC: CA
CONTENT: Bài 1
---
CONTENT_ID: DUP-01
TOPIC: CA
CONTENT: Bài 2
      `;
      expect(() => parseStructuredPosts(dupDoc)).toThrow(/duplicate CONTENT_ID/i);

      const missingTopic = `
CONTENT_ID: NO-TOPIC
CONTENT: Nội dung thiếu topic
      `;
      expect(() => parseStructuredPosts(missingTopic)).toThrow(/TOPIC/i);
    });

    it("blocks posts containing raw CCCD/CMND PII identifiers (Data Minimization)", () => {
      const piiDoc = `
CONTENT_ID: POST-PII
TOPIC: CA
CONTENT: Hồ sơ khách hàng CCCD: 079095001234 cần gia hạn.
      `;
      expect(() => parseStructuredPosts(piiDoc)).toThrow(/PII_DETECTED/i);

      const dobDoc = `
CONTENT_ID: POST-DOB
TOPIC: CA
CONTENT: Khách hàng Nguyễn Văn A ngày sinh 20/11/1985 cần cấp mới.
      `;
      expect(() => parseStructuredPosts(dobDoc)).toThrow(/PII_DETECTED/i);
    });
  });

  describe("GoogleDocsConnector & GoogleDriveConnector", () => {
    it("extracts text runs from Google Docs API JSON structure and imports posts", async () => {
      const transport = {
        fetchDocument: vi.fn(async () => ({
          documentId: "doc-abc",
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: "CONTENT_ID: DOC-101\n" } }],
                },
              },
              {
                paragraph: {
                  elements: [{ textRun: { content: "TOPIC: VIETTEL_CA\n" } }],
                },
              },
              {
                paragraph: {
                  elements: [
                    { textRun: { content: "CONTENT:\nChia sẻ kiến thức chữ ký số SME.\n" } },
                  ],
                },
              },
            ],
          },
        })),
      };

      const connector = new GoogleDocsConnector(transport);
      const posts = await connector.importPostsFromDoc("doc-abc");

      expect(transport.fetchDocument).toHaveBeenCalledWith("doc-abc");
      expect(posts).toHaveLength(1);
      expect(posts[0]?.contentId).toBe("DOC-101");
      expect(posts[0]?.topic).toBe("VIETTEL_CA");
    });

    it("syncs valid image assets from Drive folder into local media cache and skips unsupported MIME types", async () => {
      const transport = {
        listFolderFiles: vi.fn(async () => [
          {
            id: "file-1",
            name: "POST-CA-001_banner.png",
            mimeType: "image/png",
            sizeBytes: 1024,
          },
          {
            id: "file-2",
            name: "CHU_KY_SO_infographic.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 2048,
          },
          {
            id: "file-bad",
            name: "malware.exe",
            mimeType: "application/x-msdownload",
            sizeBytes: 512,
          },
        ]),
        downloadFileBytes: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
      };

      const drive = new GoogleDriveConnector(transport, { cacheDir: tempCacheDir });
      const assets = await drive.syncMediaAssets("folder-xyz");

      expect(assets).toHaveLength(2);
      expect(assets[0]?.contentIdHint).toBe("POST-CA-001");
      expect(fs.existsSync(assets[0]!.localPath)).toBe(true);
      expect(assets[1]?.topicHint).toBe("CHU_KY_SO");
    });
  });
});

