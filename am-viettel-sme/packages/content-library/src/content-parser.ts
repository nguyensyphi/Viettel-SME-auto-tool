import { createHash } from "node:crypto";

export type PublishPlatform = "ZALO" | "FACEBOOK";

export type PostLifecycleStatus =
  | "DRAFT"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED";

export interface ParsedPost {
  readonly postId?: string | undefined;
  readonly contentId: string; // alias for backward compatibility
  readonly title?: string | undefined;
  readonly topic: string;
  readonly target?: string | undefined;
  readonly platforms: readonly PublishPlatform[];
  readonly status?: "DRAFT" | "APPROVED" | undefined;
  lifecycleStatus: PostLifecycleStatus;
  readonly media?: string | undefined;
  readonly mediaRequired: boolean;
  readonly publishPriority?: "NORMAL" | "HIGH" | "LOW" | undefined;
  readonly content: string;
  readonly hashtags?: readonly string[] | undefined;
  readonly publishFrom?: string | undefined;
  readonly publishUntil?: string | undefined;
  readonly contentHash?: string | undefined;
}

const ALLOWED_PLATFORMS = new Set<PublishPlatform>(["ZALO", "FACEBOOK"]);

// Detects CCCD (12 digits), CMND (9 digits), or birth dates (SN / ngày sinh / DOB)
const PII_ID_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\d]{0,15}\d{9,12}\b|\b0\d{11}\b|\b(?:sn|sinh\s*ngày|ngày\s*sinh|dob|birthdate)\b[^\n\r]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)/iu;

export function calculateContentHash(post: {
  readonly title?: string | undefined;
  readonly content: string;
  readonly topic: string;
  readonly hashtags?: readonly string[] | undefined;
}): string {
  const normalizedPayload = {
    body: (post.content ?? "").trim().normalize("NFC"),
    hashtags: [...(post.hashtags ?? [])].map((h) => h.trim().toLowerCase()).sort(),
    title: (post.title ?? "").trim().normalize("NFC"),
    topic: (post.topic ?? "").trim().toUpperCase(),
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex");
}

function extractHashtags(raw: string): string[] {
  if (!raw.trim()) return [];
  const matches = raw.match(/#[^\s#]+/g);
  if (matches) return matches.map((m) => m.trim());
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("#") ? s : `#${s}`));
}

export function parseStructuredPosts(rawText: string): ParsedPost[] {
  const isPostStartFormat = rawText.includes("[POST_START]");
  let rawBlocks: string[] = [];

  if (isPostStartFormat) {
    const regex = /\[POST_START\]([\s\S]*?)\[POST_END\]/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(rawText)) !== null) {
      if (match[1]?.trim()) {
        rawBlocks.push(match[1].trim());
      }
    }
  } else {
    rawBlocks = rawText
      .split(/^\s*(?:---|===)\s*$/m)
      .map((b) => b.trim())
      .filter(Boolean);
  }

  const posts: ParsedPost[] = [];
  const seenIds = new Set<string>();

  for (const block of rawBlocks) {
    const lines = block.split(/\r?\n/);
    let postId = "";
    let title = "";
    let topic = "";
    let target: string | undefined = undefined;
    let mediaRequired = false;
    let media: string | undefined = undefined;
    let priority: "NORMAL" | "HIGH" | "LOW" = "NORMAL";
    let status: "DRAFT" | "APPROVED" = "DRAFT";
    let platforms: PublishPlatform[] = ["ZALO", "FACEBOOK"];
    let hashtags: string[] = [];
    let publishFrom: string | undefined = undefined;
    let publishUntil: string | undefined = undefined;

    let inContent = false;
    const contentLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (inContent) {
        // Check if a recognized metadata key starts this line
        const metaMatch = /^(HASHTAGS|PUBLISH_FROM|PUBLISH_UNTIL|MEDIA|STATUS|PUBLISH_PRIORITY)\s*:/i.exec(trimmed);
        if (metaMatch) {
          inContent = false;
        } else {
          contentLines.push(line);
          continue;
        }
      }

      if (!trimmed) continue;

      if (/^(?:POST_ID|CONTENT_ID)\s*:/i.test(trimmed)) {
        postId = trimmed.replace(/^(?:POST_ID|CONTENT_ID)\s*:/i, "").trim();
      } else if (/^TITLE\s*:/i.test(trimmed)) {
        title = trimmed.replace(/^TITLE\s*:/i, "").trim();
      } else if (/^TOPIC\s*:/i.test(trimmed)) {
        const rawTopic = trimmed.replace(/^TOPIC\s*:/i, "").trim();
        topic = isPostStartFormat ? rawTopic.toUpperCase() : rawTopic;
      } else if (/^TARGET\s*:/i.test(trimmed)) {
        target = trimmed.replace(/^TARGET\s*:/i, "").trim();
      } else if (/^STATUS\s*:/i.test(trimmed)) {
        const val = trimmed.replace(/^STATUS\s*:/i, "").trim().toUpperCase();
        status = val === "APPROVED" ? "APPROVED" : "DRAFT";
      } else if (/^MEDIA\s*:/i.test(trimmed)) {
        media = trimmed.replace(/^MEDIA\s*:/i, "").trim();
        mediaRequired = media.toUpperCase() !== "NONE" && media.length > 0;
      } else if (/^MEDIA_REQUIRED\s*:/i.test(trimmed)) {
        const val = trimmed.replace(/^MEDIA_REQUIRED\s*:/i, "").trim().toLowerCase();
        mediaRequired = val === "true" || val === "yes" || val === "1";
        if (mediaRequired && !media) media = "AUTO";
      } else if (/^PUBLISH_PRIORITY\s*:/i.test(trimmed)) {
        const val = trimmed.replace(/^PUBLISH_PRIORITY\s*:/i, "").trim().toUpperCase();
        if (val === "HIGH" || val === "LOW") priority = val;
        else priority = "NORMAL";
      } else if (/^HASHTAGS\s*:/i.test(trimmed)) {
        hashtags = extractHashtags(trimmed.replace(/^HASHTAGS\s*:/i, ""));
      } else if (/^PUBLISH_FROM\s*:/i.test(trimmed)) {
        publishFrom = trimmed.replace(/^PUBLISH_FROM\s*:/i, "").trim();
      } else if (/^PUBLISH_UNTIL\s*:/i.test(trimmed)) {
        publishUntil = trimmed.replace(/^PUBLISH_UNTIL\s*:/i, "").trim();
      } else if (/^PLATFORMS\s*:/i.test(trimmed)) {
        const parsed = trimmed
          .replace(/^PLATFORMS\s*:/i, "")
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean) as PublishPlatform[];
        for (const p of parsed) {
          if (!ALLOWED_PLATFORMS.has(p)) {
            throw new Error(`Unsupported platform "${p}" in CONTENT_ID ${postId || "(unknown)"}`);
          }
        }
        if (parsed.length > 0) {
          platforms = parsed;
        }
      } else if (/^CONTENT\s*:/i.test(trimmed)) {
        inContent = true;
        const inlineRest = line.replace(/^\s*CONTENT\s*:/i, "").trim();
        if (inlineRest) {
          contentLines.push(inlineRest);
        }
      }
    }

    if (!postId) {
      throw new Error("Missing mandatory CONTENT_ID field in post block");
    }
    if (seenIds.has(postId)) {
      throw new Error(`Duplicate CONTENT_ID "${postId}" found in document`);
    }
    seenIds.add(postId);

    if (!topic) {
      throw new Error(`Missing mandatory TOPIC field for CONTENT_ID "${postId}"`);
    }

    const content = contentLines.join("\n").trim();
    if (!content) {
      throw new Error(`Empty CONTENT body for CONTENT_ID "${postId}"`);
    }

    if (PII_ID_PATTERN.test(content)) {
      throw new Error(
        `PII_DETECTED: post "${postId}" contains personal identifier pattern (CCCD/CMND forbidden)`,
      );
    }

    const resolvedTitle = title || postId;
    const contentHash = calculateContentHash({
      title: resolvedTitle,
      content,
      topic,
      hashtags,
    });

    if (isPostStartFormat) {
      posts.push({
        postId,
        contentId: postId,
        title: resolvedTitle,
        topic,
        target: target ?? "BUSINESS_OWNER",
        platforms,
        status,
        lifecycleStatus: status,
        media,
        mediaRequired,
        publishPriority: priority,
        content,
        hashtags,
        ...(publishFrom ? { publishFrom } : {}),
        ...(publishUntil ? { publishUntil } : {}),
        contentHash,
      });
    } else {
      // Legacy format object with exact 6 enumerable properties for full backward compatibility
      const legacyPost: any = {
        contentId: postId,
        topic,
        mediaRequired,
        platforms,
        content,
        lifecycleStatus: status,
      };

      Object.defineProperty(legacyPost, "postId", { value: postId, enumerable: false });
      Object.defineProperty(legacyPost, "title", { value: resolvedTitle, enumerable: false });
      Object.defineProperty(legacyPost, "target", { value: target ?? "BUSINESS_OWNER", enumerable: false });
      Object.defineProperty(legacyPost, "status", { value: status, enumerable: false });
      Object.defineProperty(legacyPost, "media", { value: media, enumerable: false });
      Object.defineProperty(legacyPost, "publishPriority", { value: priority, enumerable: false });
      Object.defineProperty(legacyPost, "hashtags", { value: hashtags, enumerable: false });
      Object.defineProperty(legacyPost, "contentHash", { value: contentHash, enumerable: false });

      posts.push(legacyPost as ParsedPost);
    }
  }

  return posts;
}
