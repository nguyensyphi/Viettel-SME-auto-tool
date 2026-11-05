export type PublishPlatform = "ZALO" | "FACEBOOK";

export type PostLifecycleStatus =
  | "DRAFT"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED";

export interface ParsedPost {
  contentId: string;
  topic: string;
  mediaRequired: boolean;
  platforms: PublishPlatform[];
  content: string;
  lifecycleStatus: PostLifecycleStatus;
}

const ALLOWED_PLATFORMS = new Set<PublishPlatform>(["ZALO", "FACEBOOK"]);
// Detects CCCD (12 digits), CMND (9 digits), or birth dates (SN / ngày sinh / DOB)
const PII_ID_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\d]{0,15}\d{9,12}\b|\b0\d{11}\b|\b(?:sn|sinh\s*ngày|ngày\s*sinh|dob|birthdate)\b[^\n\r]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)/iu;

export function parseStructuredPosts(rawText: string): ParsedPost[] {
  const blocks = rawText
    .split(/^\s*(?:---|===)\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const posts: ParsedPost[] = [];
  const seenIds = new Set<string>();

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let contentId = "";
    let topic = "";
    let mediaRequired = false;
    let platforms: PublishPlatform[] = ["ZALO", "FACEBOOK"];
    let inContent = false;
    const contentLines: string[] = [];

    for (const line of lines) {
      if (inContent) {
        contentLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^CONTENT_ID\s*:/i.test(trimmed)) {
        contentId = trimmed.replace(/^CONTENT_ID\s*:/i, "").trim();
      } else if (/^TOPIC\s*:/i.test(trimmed)) {
        topic = trimmed.replace(/^TOPIC\s*:/i, "").trim();
      } else if (/^MEDIA_REQUIRED\s*:/i.test(trimmed)) {
        const val = trimmed.replace(/^MEDIA_REQUIRED\s*:/i, "").trim().toLowerCase();
        mediaRequired = val === "true" || val === "yes" || val === "1";
      } else if (/^PLATFORMS\s*:/i.test(trimmed)) {
        const parsed = trimmed
          .replace(/^PLATFORMS\s*:/i, "")
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean) as PublishPlatform[];
        for (const p of parsed) {
          if (!ALLOWED_PLATFORMS.has(p)) {
            throw new Error(`Unsupported platform "${p}" in CONTENT_ID ${contentId || "(unknown)"}`);
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

    if (!contentId) {
      throw new Error("Missing mandatory CONTENT_ID field in post block");
    }
    if (seenIds.has(contentId)) {
      throw new Error(`Duplicate CONTENT_ID "${contentId}" found in document`);
    }
    if (!topic) {
      throw new Error(`Missing mandatory TOPIC field for CONTENT_ID "${contentId}"`);
    }

    const content = contentLines.join("\n").trim();
    if (!content) {
      throw new Error(`Empty CONTENT body for CONTENT_ID "${contentId}"`);
    }

    if (PII_ID_PATTERN.test(content)) {
      throw new Error(
        `PII_DETECTED: post "${contentId}" contains personal identifier pattern (CCCD/CMND forbidden)`,
      );
    }

    seenIds.add(contentId);
    posts.push({
      contentId,
      topic,
      mediaRequired,
      platforms,
      content,
      lifecycleStatus: "DRAFT",
    });
  }

  return posts;
}

