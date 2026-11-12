import { describe, expect, it } from "vitest";
import {
  calculateMediaScore,
  rankAndMatchMedia,
  validateMediaCandidate,
  type EnrichedMediaAsset,
  type PostMediaMatchRequest,
} from "../src/media-matcher.js";

describe("Media Validation & Weighted Content-Media Matching Engine (PB-004, PB-005)", () => {
  const baseAssets: EnrichedMediaAsset[] = [
    {
      id: "media-cks-post-01",
      driveFileId: "drive-file-1",
      fileName: "pb001_chu_ky_so_banner.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 512_000,
      checksum: "sha256-cks-01",
      topicCode: "CHU_KY_SO",
      postCodeHint: "PB001",
      products: ["VIETTEL_CA"],
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: false,
    },
    {
      id: "media-cks-topic-02",
      driveFileId: "drive-file-2",
      fileName: "chu_ky_so_general_01.png",
      mimeType: "image/png",
      sizeBytes: 640_000,
      checksum: "sha256-cks-02",
      topicCode: "CHU_KY_SO",
      products: ["VIETTEL_CA"],
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: false,
    },
    {
      id: "media-cks-topic-03",
      driveFileId: "drive-file-3",
      fileName: "chu_ky_so_general_02.webp",
      mimeType: "image/webp",
      sizeBytes: 420_000,
      checksum: "sha256-cks-03",
      topicCode: "CHU_KY_SO",
      products: ["VIETTEL_CA"],
      platforms: ["ZALO"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: false,
    },
    {
      id: "media-hddt-01",
      driveFileId: "drive-file-4",
      fileName: "sinvoice_banner.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 380_000,
      checksum: "sha256-hddt-01",
      topicCode: "HOA_DON_DIEN_TU",
      products: ["SINVOICE"],
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: false,
    },
    {
      id: "media-shared-01",
      driveFileId: "drive-file-5",
      fileName: "viettel_brand_shared.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 300_000,
      checksum: "sha256-shared-01",
      topicCode: "GENERAL_BRANDING",
      products: [],
      platforms: ["ZALO", "FACEBOOK"],
      status: "APPROVED",
      version: 1,
      isSharedMedia: true,
    },
    {
      id: "media-unapproved-01",
      driveFileId: "drive-file-6",
      fileName: "draft_cks.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 250_000,
      checksum: "sha256-draft-01",
      topicCode: "CHU_KY_SO",
      postCodeHint: "PB999",
      products: ["VIETTEL_CA"],
      platforms: ["ZALO", "FACEBOOK"],
      status: "PENDING",
      version: 1,
      isSharedMedia: false,
    },
  ];

  it("PB-MT-006 & PB-MT-007: validates MIME types (JPG, PNG, WEBP) and rejects oversized or non-image files", () => {
    const validJpg = validateMediaCandidate({
      fileName: "banner.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1_024_000,
      checksum: "hash-1",
    });
    expect(validJpg.valid).toBe(true);

    const invalidPdf = validateMediaCandidate({
      fileName: "brochure.pdf",
      mimeType: "application/pdf",
      sizeBytes: 500_000,
      checksum: "hash-2",
    });
    expect(invalidPdf.valid).toBe(false);
    expect(invalidPdf.errorCode).toBe("INVALID_MEDIA_MIME_TYPE");

    const oversized = validateMediaCandidate({
      fileName: "huge.png",
      mimeType: "image/png",
      sizeBytes: 20 * 1024 * 1024, // 20 MB > 15 MB limit
      checksum: "hash-3",
    });
    expect(oversized.valid).toBe(false);
    expect(oversized.errorCode).toBe("MEDIA_FILE_TOO_LARGE");
  });

  it("PB-MT-005: detects duplicate checksums when existingChecksums set is provided", () => {
    const existing = new Set(["sha256-cks-01"]);
    const dup = validateMediaCandidate(
      {
        fileName: "copy_banner.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 512_000,
        checksum: "sha256-cks-01",
      },
      { existingChecksums: existing },
    );
    expect(dup.valid).toBe(false);
    expect(dup.errorCode).toBe("DUPLICATE_MEDIA_CHECKSUM");
  });

  it("PB-MT-010: prioritizes direct MEDIA_ID or MEDIA_FILENAME when specified on the post", () => {
    const req: PostMediaMatchRequest = {
      postCode: "PB005",
      topicCode: "CHU_KY_SO",
      platforms: ["ZALO"],
      mediaRequired: true,
      explicitMediaHint: "chu_ky_so_general_02.webp",
    };

    const result = rankAndMatchMedia(req, baseAssets);
    expect(result.status).toBe("MATCHED");
    expect(result.selectedMedia?.id).toBe("media-cks-topic-03");
    expect(result.matchMethod).toBe("EXPLICIT_FILENAME");
  });

  it("PB-MT-001: matches exact POST_ID with highest weighted score (Score = 0.40P + 0.30T + 0.15F + 0.10V + 0.05R)", () => {
    const req: PostMediaMatchRequest = {
      postCode: "PB001",
      topicCode: "CHU_KY_SO",
      products: ["VIETTEL_CA"],
      platforms: ["ZALO", "FACEBOOK"],
      mediaRequired: true,
    };

    const score = calculateMediaScore(req, baseAssets[0]!);
    // P=1(0.40) + T=1(0.30) + F=1(0.15) + V=1(0.10) + R=1(0.05) = 1.00
    expect(score).toBeCloseTo(1.0, 5);

    const result = rankAndMatchMedia(req, baseAssets);
    expect(result.status).toBe("MATCHED");
    expect(result.selectedMedia?.id).toBe("media-cks-post-01");
    expect(result.matchMethod).toBe("POST_ID");
  });

  it("PB-MT-002 & PB-MT-003: matches by TOPIC when no POST_ID match exists, and never auto-matches wrong topic", () => {
    const req: PostMediaMatchRequest = {
      postCode: "PB002",
      topicCode: "HOA_DON_DIEN_TU",
      products: ["SINVOICE"],
      platforms: ["ZALO", "FACEBOOK"],
      mediaRequired: true,
    };

    const result = rankAndMatchMedia(req, baseAssets);
    expect(result.status).toBe("MATCHED");
    expect(result.selectedMedia?.id).toBe("media-hddt-01");
    expect(result.matchMethod).toBe("TOPIC");
    // Ensure CHU_KY_SO assets were not selected
    expect(result.candidates.every((c) => c.asset.topicCode !== "CHU_KY_SO")).toBe(true);
  });

  it("PB-MT-004: returns MISSING_MEDIA when no matching topic media exists and excludes unapproved assets", () => {
    const req: PostMediaMatchRequest = {
      postCode: "PB999",
      topicCode: "FTTH",
      platforms: ["ZALO"],
      mediaRequired: true,
    };

    // Exclude shared media to test strict missing media
    const nonSharedAssets = baseAssets.filter((a) => !a.isSharedMedia);
    const result = rankAndMatchMedia(req, nonSharedAssets);
    expect(result.status).toBe("MISSING_MEDIA");
    expect(result.selectedMedia).toBeNull();
  });

  it("falls back to SHARED_MEDIA with NEEDS_REVIEW status when topic has no dedicated image", () => {
    const req: PostMediaMatchRequest = {
      postCode: "PB888",
      topicCode: "FTTH",
      platforms: ["ZALO", "FACEBOOK"],
      mediaRequired: true,
    };

    const result = rankAndMatchMedia(req, baseAssets);
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.selectedMedia?.id).toBe("media-shared-01");
    expect(result.matchMethod).toBe("SHARED_MEDIA");
  });
});

