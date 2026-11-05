import fs from "node:fs";
import path from "node:path";

export interface DriveRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number | undefined;
}

export interface MediaAsset {
  assetId: string;
  fileName: string;
  mimeType: string;
  localPath: string;
  contentIdHint?: string | undefined;
  topicHint?: string | undefined;
}

export interface GoogleDriveTransport {
  listFolderFiles(folderId: string): Promise<DriveRemoteFile[]>;
  downloadFileBytes(fileId: string): Promise<Uint8Array>;
}

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MAX_ASSET_BYTES = 15 * 1024 * 1024; // 15 MB

function extractNamingHints(fileName: string): {
  contentIdHint?: string | undefined;
  topicHint?: string | undefined;
} {
  const stem = path.parse(fileName).name;

  // Match CONTENT_ID convention with hyphen (e.g. POST-CA-001_banner -> POST-CA-001)
  const contentMatch = /^([A-Z0-9]+-[A-Z0-9-]+)(?:_|$)/i.exec(stem);
  if (contentMatch?.[1]) {
    return { contentIdHint: contentMatch[1].toUpperCase() };
  }

  // Match UPPERCASE_TOPIC followed by lowercase descriptor (e.g. CHU_KY_SO_infographic -> CHU_KY_SO)
  const topicMatch = /^([A-Z0-9]+(?:_[A-Z0-9]+)*)_[a-z0-9-]+$/.exec(stem);
  if (topicMatch?.[1]) {
    return { topicHint: topicMatch[1] };
  }

  return {};
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export interface GoogleDriveConnectorOptions {
  cacheDir?: string | undefined;
}

export class GoogleDriveConnector {
  private readonly cacheDir: string;

  constructor(
    private readonly transport: GoogleDriveTransport,
    options?: GoogleDriveConnectorOptions,
  ) {
    this.cacheDir = path.resolve(options?.cacheDir ?? path.join("storage", "media_cache"));
  }

  async syncMediaAssets(folderId: string): Promise<MediaAsset[]> {
    const cleanFolderId = folderId?.trim() ?? "";
    if (!cleanFolderId) {
      throw new Error("folderId is required");
    }

    fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    const remoteFiles = await this.transport.listFolderFiles(cleanFolderId);
    const synced: MediaAsset[] = [];

    for (const file of remoteFiles) {
      if (!ALLOWED_IMAGE_MIMES.has(file.mimeType)) {
        continue;
      }
      if (file.sizeBytes !== undefined && file.sizeBytes > MAX_ASSET_BYTES) {
        continue;
      }

      const safeFileId = sanitizeFileName(file.id);
      const safeName = sanitizeFileName(file.name);
      const localPath = path.resolve(this.cacheDir, `${safeFileId}_${safeName}`);
      const rel = path.relative(this.cacheDir, localPath);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        continue;
      }

      const bytes = await this.transport.downloadFileBytes(file.id);
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        continue;
      }

      fs.writeFileSync(localPath, bytes);
      const hints = extractNamingHints(file.name);

      synced.push({
        assetId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        localPath,
        ...(hints.contentIdHint !== undefined ? { contentIdHint: hints.contentIdHint } : {}),
        ...(hints.topicHint !== undefined ? { topicHint: hints.topicHint } : {}),
      });
    }

    return synced;
  }
}

