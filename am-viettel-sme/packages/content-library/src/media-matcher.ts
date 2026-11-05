import type { ParsedPost } from "./content-parser.js";
import type { MediaAsset } from "./google-drive-connector.js";

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

