import { describe, expect, it } from "vitest";
import {
  parseStructuredPosts,
  calculateContentHash,
  type ParsedPost,
} from "../src/content-parser.js";

describe("Enhanced Content Parser & SHA-256 Hashing (PB-002, PB-P02)", () => {
  const sampleGoogleDoc = `
[POST_START]
POST_ID: PB001
TITLE: Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?
TOPIC: CHU_KY_SO
TARGET: BUSINESS_OWNER
PLATFORMS: ZALO, FACEBOOK
STATUS: APPROVED
MEDIA: AUTO
PUBLISH_PRIORITY: HIGH
CONTENT:
Chữ ký số là giải pháp không thể thiếu đối với mọi doanh nghiệp khi mới thành lập.
Viettel-CA bảo mật theo chuẩn Bộ Thông tin & Truyền thông, hỗ trợ nộp thuế điện tử và ký kết hóa đơn 24/7.
HASHTAGS: #Viettel #ChuKySo #DoanhNghiep
PUBLISH_FROM: 2026-11-10T08:00:00Z
PUBLISH_UNTIL: 2026-12-31T23:59:59Z
[POST_END]

[POST_START]
POST_ID: PB002
TITLE: Hóa đơn điện tử S-Invoice và những điều doanh nghiệp cần lưu ý
TOPIC: HOA_DON_DIEN_TU
TARGET: BUSINESS_OWNER
PLATFORMS: ZALO
STATUS: DRAFT
MEDIA: hoa_don_dien_tu_01.png
PUBLISH_PRIORITY: NORMAL
CONTENT:
Hướng dẫn doanh nghiệp chuyển đổi hóa đơn điện tử S-Invoice nhanh chóng, an toàn.
HASHTAGS: #HoaDonDienTu #SInvoice
[POST_END]
`;

  it("parses multiple posts enclosed by [POST_START] and [POST_END] markers", () => {
    const posts = parseStructuredPosts(sampleGoogleDoc);

    expect(posts).toHaveLength(2);

    const post1 = posts[0]!;
    expect(post1.postId).toBe("PB001");
    expect(post1.title).toBe("Vì sao doanh nghiệp mới thành lập nên quan tâm đến chữ ký số?");
    expect(post1.topic).toBe("CHU_KY_SO");
    expect(post1.target).toBe("BUSINESS_OWNER");
    expect(post1.platforms).toEqual(["ZALO", "FACEBOOK"]);
    expect(post1.status).toBe("APPROVED");
    expect(post1.media).toBe("AUTO");
    expect(post1.publishPriority).toBe("HIGH");
    expect(post1.content).toContain("Chữ ký số là giải pháp không thể thiếu");
    expect(post1.content).toContain("hỗ trợ nộp thuế điện tử");
    expect(post1.hashtags).toEqual(["#Viettel", "#ChuKySo", "#DoanhNghiep"]);
    expect(post1.publishFrom).toBe("2026-11-10T08:00:00Z");
    expect(post1.publishUntil).toBe("2026-12-31T23:59:59Z");
    expect(post1.contentHash).toBeDefined();
    expect(post1.contentHash).toHaveLength(64); // SHA-256 hex string

    const post2 = posts[1]!;
    expect(post2.postId).toBe("PB002");
    expect(post2.title).toBe("Hóa đơn điện tử S-Invoice và những điều doanh nghiệp cần lưu ý");
    expect(post2.topic).toBe("HOA_DON_DIEN_TU");
    expect(post2.platforms).toEqual(["ZALO"]);
    expect(post2.status).toBe("DRAFT");
    expect(post2.media).toBe("hoa_don_dien_tu_01.png");
    expect(post2.hashtags).toEqual(["#HoaDonDienTu", "#SInvoice"]);
  });

  it("calculates deterministic SHA-256 content hash according to Section 16.3", () => {
    const post: ParsedPost = {
      postId: "PB001",
      contentId: "PB001",
      title: "Vì sao doanh nghiệp cần chữ ký số?",
      topic: "CHU_KY_SO",
      platforms: ["ZALO"],
      status: "APPROVED",
      mediaRequired: true,
      lifecycleStatus: "APPROVED",
      content: "Nội dung bài viết...",
      hashtags: ["#Viettel", "#ChuKySo"],
      contentHash: "",
    };

    const hash1 = calculateContentHash(post);
    const hash2 = calculateContentHash({ ...post });
    expect(hash1).toBe(hash2);

    // If body changes, hash MUST change
    const modifiedHash = calculateContentHash({
      ...post,
      content: "Nội dung bài viết đã được chỉnh sửa bổ sung.",
    });
    expect(modifiedHash).not.toBe(hash1);
  });

  it("fails closed when document contains duplicate POST_ID", () => {
    const docWithDup = `
[POST_START]
POST_ID: PB001
TITLE: Bài 1
TOPIC: CHU_KY_SO
PLATFORMS: ZALO
STATUS: DRAFT
CONTENT: Nội dung 1
[POST_END]

[POST_START]
POST_ID: PB001
TITLE: Bài trùng ID
TOPIC: CHU_KY_SO
PLATFORMS: ZALO
STATUS: DRAFT
CONTENT: Nội dung 2
[POST_END]
`;
    expect(() => parseStructuredPosts(docWithDup)).toThrow(/Duplicate/i);
  });

  it("rejects posts containing forbidden national ID patterns (CCCD/CMND)", () => {
    const docWithPII = `
[POST_START]
POST_ID: PB003
TITLE: Cập nhật thông tin đại diện pháp luật
TOPIC: BUSINESS_KNOWLEDGE
PLATFORMS: FACEBOOK
STATUS: APPROVED
CONTENT: Doanh nghiệp gửi kèm CCCD 079123456789 để hoàn tất hồ sơ đăng ký.
[POST_END]
`;
    expect(() => parseStructuredPosts(docWithPII)).toThrow(/PII_DETECTED/);
  });

  it("maintains backward compatibility with legacy --- block markers", () => {
    const legacyDoc = `
CONTENT_ID: POST-CA-001
TOPIC: CHU_KY_SO
MEDIA_REQUIRED: true
PLATFORMS: ZALO, FACEBOOK
CONTENT:
Legacy block content without new markers.
---
CONTENT_ID: POST-CA-002
TOPIC: HOA_DON_DIEN_TU
PLATFORMS: ZALO
CONTENT:
Second legacy block.
`;
    const posts = parseStructuredPosts(legacyDoc);
    expect(posts).toHaveLength(2);
    expect(posts[0]!.contentId).toBe("POST-CA-001");
    expect(posts[0]!.postId).toBe("POST-CA-001");
    expect(posts[0]!.title).toBe("POST-CA-001"); // defaults to contentId when TITLE missing
  });
});

