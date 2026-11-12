import type { ParsedPost, PublishPlatform } from "./content-parser.js";
import type { MediaAsset } from "./google-drive-connector.js";

export type MediaAssetStatus = "PENDING" | "APPROVED" | "REJECTED" | "INVALID";

export type MediaMatchStatus =
  | "MATCHED"
  | "MULTIPLE_MATCHES"
  | "MISSING_MEDIA"
  | "INVALID_MEDIA"
  | "NEEDS_REVIEW";

export type MediaMatchMethod =
  | "EXPLICIT_ID"
  | "EXPLICIT_FILENAME"
  | "POST_ID"
  | "TOPIC"
  | "SHARED_MEDIA"
  | "NONE";

export interface EnrichedMediaAsset {
  readonly id: string;
  readonly driveFileId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly topicCode: string;
  readonly postCodeHint?: string | null | undefined;
  readonly products?: readonly string[] | undefined;
  readonly platforms: readonly PublishPlatform[];
  readonly status: MediaAssetStatus;
  readonly version: number;
  readonly isSharedMedia?: boolean | undefined;
}

export interface PostMediaMatchRequest {
  readonly postCode: string;
  readonly topicCode: string;
  readonly products?: readonly string[] | undefined;
  readonly platforms: readonly PublishPlatform[];
  readonly mediaRequired?: boolean | undefined;
  readonly explicitMediaHint?: string | null | undefined;
}

export interface ScoredMediaCandidate {
  readonly asset: EnrichedMediaAsset;
  readonly score: number;
  readonly matchMethod: MediaMatchMethod;
}

export interface MediaMatchResult {
  readonly status: MediaMatchStatus;
  readonly selectedMedia: EnrichedMediaAsset | null;
  readonly matchMethod: MediaMatchMethod;
  readonly candidates: readonly ScoredMediaCandidate[];
  readonly errorCode?: string | undefined;
}

export const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const MAX_MEDIA_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export interface MediaValidationInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
}

export interface MediaValidationOptions {
  readonly existingChecksums?: ReadonlySet<string> | undefined;
  readonly maxSizeBytes?: number | undefined;
}

export interface MediaValidationResult {
  readonly valid: boolean;
  readonly errorCode?:
    | "INVALID_MEDIA_MIME_TYPE"
    | "MEDIA_FILE_TOO_LARGE"
    | "EMPTY_MEDIA_FILE"
    | "DUPLICATE_MEDIA_CHECKSUM"
    | undefined;
}

export function validateMediaCandidate(
  input: MediaValidationInput,
  options?: MediaValidationOptions,
): MediaValidationResult {
  const mime = (input.mimeType ?? "").trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mime)) {
    return { valid: false, errorCode: "INVALID_MEDIA_MIME_TYPE" };
  }

  if (input.sizeBytes <= 0) {
    return { valid: false, errorCode: "EMPTY_MEDIA_FILE" };
  }

  const maxBytes = options?.maxSizeBytes ?? MAX_MEDIA_FILE_SIZE_BYTES;
  if (input.sizeBytes > maxBytes) {
    return { valid: false, errorCode: "MEDIA_FILE_TOO_LARGE" };
  }

  if (options?.existingChecksums && input.checksum) {
    if (options.existingChecksums.has(input.checksum)) {
      return { valid: false, errorCode: "DUPLICATE_MEDIA_CHECKSUM" };
    }
  }

  return { valid: true };
}

/**
 * Spec 5.5 Weighted Scoring Formula:
 * Score = 0.40 * P + 0.30 * T + 0.15 * F + 0.10 * V + 0.05 * R
 * - P: POST_ID match (1.0 if exact match, 0.0 otherwise)
 * - T: TOPIC match (1.0 if exact topic match, 0.5 if shared media, 0.0 otherwise)
 * - F: Product fit (1.0 if product overlap or both unspecified, 0.5 if asset has no product restriction, 0.0 otherwise)
 * - V: Validity & approval status (1.0 if APPROVED, 0.0 otherwise)
 * - R: Platform compatibility ratio (fraction of post platforms supported by media)
 */
export function calculateMediaScore(
  request: PostMediaMatchRequest,
  asset: EnrichedMediaAsset,
): number {
  const normPostCode = request.postCode.trim().toUpperCase();
  const normAssetPostCode = (asset.postCodeHint ?? "").trim().toUpperCase();
  const P = normPostCode && normAssetPostCode === normPostCode ? 1.0 : 0.0;

  const normTopic = request.topicCode.trim().toUpperCase();
  const normAssetTopic = asset.topicCode.trim().toUpperCase();
  const T =
    normTopic && normAssetTopic === normTopic
      ? 1.0
      : asset.isSharedMedia
        ? 0.5
        : 0.0;

  const reqProducts = (request.products ?? []).map((p) => p.trim().toUpperCase());
  const assetProducts = (asset.products ?? []).map((p) => p.trim().toUpperCase());
  let F = 0.5;
  if (reqProducts.length > 0 && assetProducts.length > 0) {
    const hasOverlap = reqProducts.some((p) => assetProducts.includes(p));
    F = hasOverlap ? 1.0 : 0.0;
  } else if (reqProducts.length === 0 && assetProducts.length === 0) {
    F = 1.0;
  }

  const V = asset.status === "APPROVED" ? 1.0 : 0.0;

  const reqPlatforms = request.platforms.length > 0 ? request.platforms : (["ZALO"] as const);
  const supportedCount = reqPlatforms.filter((plat) =>
    asset.platforms.includes(plat),
  ).length;
  const R = supportedCount / reqPlatforms.length;

  return 0.4 * P + 0.3 * T + 0.15 * F + 0.1 * V + 0.05 * R;
}

export function rankAndMatchMedia(
  request: PostMediaMatchRequest,
  assets: readonly EnrichedMediaAsset[],
): MediaMatchResult {
  const hint = request.explicitMediaHint?.trim() ?? "";

  // 1 & 2. Priority 1 & 2: Explicit MEDIA_ID or MEDIA_FILENAME specified on post
  if (hint && hint.toUpperCase() !== "AUTO" && hint.toUpperCase() !== "NONE") {
    const byId = assets.find((a) => a.id === hint || a.driveFileId === hint);
    if (byId) {
      if (byId.status !== "APPROVED") {
        return {
          status: "INVALID_MEDIA",
          selectedMedia: null,
          matchMethod: "EXPLICIT_ID",
          candidates: [],
          errorCode: "EXPLICIT_MEDIA_NOT_APPROVED",
        };
      }
      return {
        status: "MATCHED",
        selectedMedia: byId,
        matchMethod: "EXPLICIT_ID",
        candidates: [{ asset: byId, score: 1.0, matchMethod: "EXPLICIT_ID" }],
      };
    }

    const normHint = hint.toLowerCase();
    const byFilename = assets.find((a) => a.fileName.trim().toLowerCase() === normHint);
    if (byFilename) {
      if (byFilename.status !== "APPROVED") {
        return {
          status: "INVALID_MEDIA",
          selectedMedia: null,
          matchMethod: "EXPLICIT_FILENAME",
          candidates: [],
          errorCode: "EXPLICIT_MEDIA_NOT_APPROVED",
        };
      }
      return {
        status: "MATCHED",
        selectedMedia: byFilename,
        matchMethod: "EXPLICIT_FILENAME",
        candidates: [{ asset: byFilename, score: 1.0, matchMethod: "EXPLICIT_FILENAME" }],
      };
    }
  }

  // Only consider APPROVED assets with valid MIME and size
  const approvedAssets = assets.filter(
    (a) =>
      a.status === "APPROVED" &&
      validateMediaCandidate({
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        checksum: a.checksum,
      }).valid,
  );

  const normPostCode = request.postCode.trim().toUpperCase();
  const normTopicCode = request.topicCode.trim().toUpperCase();

  // 3. Priority 3: Exact POST_ID match
  const postMatches = approvedAssets
    .filter((a) => (a.postCodeHint ?? "").trim().toUpperCase() === normPostCode)
    .map((asset) => ({
      asset,
      score: calculateMediaScore(request, asset),
      matchMethod: "POST_ID" as const,
    }))
    .sort((a, b) => b.score - a.score);

  if (postMatches.length > 0) {
    return {
      status: "MATCHED",
      selectedMedia: postMatches[0]!.asset,
      matchMethod: "POST_ID",
      candidates: postMatches,
    };
  }

  // 4. Priority 4: Topic match (never auto-match a different non-shared topic)
  const topicMatches = approvedAssets
    .filter((a) => a.topicCode.trim().toUpperCase() === normTopicCode)
    .map((asset) => ({
      asset,
      score: calculateMediaScore(request, asset),
      matchMethod: "TOPIC" as const,
    }))
    .sort((a, b) => b.score - a.score);

  if (topicMatches.length > 0) {
    return {
      status: "MATCHED",
      selectedMedia: topicMatches[0]!.asset,
      matchMethod: "TOPIC",
      candidates: topicMatches,
    };
  }

  // 5. Priority 5: Shared media fallback (requires AM review)
  const sharedMatches = approvedAssets
    .filter((a) => a.isSharedMedia === true)
    .map((asset) => ({
      asset,
      score: calculateMediaScore(request, asset),
      matchMethod: "SHARED_MEDIA" as const,
    }))
    .sort((a, b) => b.score - a.score);

  if (sharedMatches.length > 0) {
    return {
      status: "NEEDS_REVIEW",
      selectedMedia: sharedMatches[0]!.asset,
      matchMethod: "SHARED_MEDIA",
      candidates: sharedMatches,
    };
  }

  return {
    status: "MISSING_MEDIA",
    selectedMedia: null,
    matchMethod: "NONE",
    candidates: [],
    ...(request.mediaRequired ? { errorCode: "REQUIRED_MEDIA_MISSING" } : {}),
  };
}

/**
 * Legacy helper preserved for backward compatibility with Phase 1 tests.
 */
export function matchMediaToPost(
  post: ParsedPost,
  assets: readonly MediaAsset[],
): MediaAsset[] {
  const targetContentId = post.contentId.trim().toUpperCase();
  const targetTopic = post.topic.trim().toUpperCase();

  const exactById = assets.filter(
    (a) => a.contentIdHint?.trim().toUpperCase() === targetContentId,
  );

  if (exactById.length > 0) {
    return exactById;
  }

  const byTopic = assets.filter(
    (a) => a.topicHint?.trim().toUpperCase() === targetTopic,
  );

  if (byTopic.length > 0) {
    return byTopic;
  }

  if (post.mediaRequired) {
    throw new Error(
      `REQUIRED_MEDIA_MISSING: post "${post.contentId}" requires media but no matching asset was found`,
    );
  }

  return [];
}
