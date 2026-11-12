import fs from "node:fs";
import path from "node:path";

export interface DriveRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number | undefined;
}

export interface DriveFolderMetadata {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

export interface ListFolderOptions {
  mimeType?: string | undefined;
  mimeTypePrefix?: string | undefined;
  pageSize?: number | undefined;
  pageToken?: string | undefined;
}

export interface DiscoveredDriveHierarchy {
  rootFolder: DriveFolderMetadata;
  contentFolder: DriveRemoteFile | null;
  mediaFolder: DriveRemoteFile | null;
  archiveFolder: DriveRemoteFile | null;
  recognizedSubfolders: readonly DriveRemoteFile[];
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
  getFileMetadata?(fileId: string): Promise<DriveRemoteFile>;
}

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

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

function normalizeDriveError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : String(cause);
  const status = (cause as { statusCode?: number })?.statusCode;

  if (status === 403 || message.includes("403") || message.toLowerCase().includes("permission")) {
    throw new Error(`GOOGLE_DRIVE_PERMISSION_DENIED: ${message}`);
  }
  if (status === 404 || message.includes("404") || message.toLowerCase().includes("not found")) {
    throw new Error(`GOOGLE_DRIVE_FOLDER_NOT_FOUND: ${message}`);
  }
  throw new Error(`GOOGLE_DRIVE_API_ERROR: ${message}`);
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

  async inspectFolder(folderId: string): Promise<DriveFolderMetadata> {
    const cleanId = folderId?.trim() ?? "";
    if (!cleanId) throw new Error("folderId is required");

    try {
      if (this.transport.getFileMetadata) {
        const meta = await this.transport.getFileMetadata(cleanId);
        const isFolder = meta.mimeType === GOOGLE_FOLDER_MIME;
        if (!isFolder) {
          throw new Error(`NOT_A_DRIVE_FOLDER: Resource is "${meta.mimeType}", not a folder.`);
        }
        return {
          id: meta.id,
          name: meta.name,
          mimeType: meta.mimeType,
          isFolder: true,
        };
      }
      // Fallback: list children to verify access
      await this.transport.listFolderFiles(cleanId);
      return {
        id: cleanId,
        name: cleanId,
        mimeType: GOOGLE_FOLDER_MIME,
        isFolder: true,
      };
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("NOT_A_DRIVE_FOLDER")) {
        throw cause;
      }
      normalizeDriveError(cause);
    }
  }

  async listFolderChildren(
    folderId: string,
    options?: ListFolderOptions,
  ): Promise<DriveRemoteFile[]> {
    const cleanId = folderId?.trim() ?? "";
    if (!cleanId) throw new Error("folderId is required");

    try {
      const files = await this.transport.listFolderFiles(cleanId);
      return files.filter((f) => {
        if (options?.mimeType && f.mimeType !== options.mimeType) {
          return false;
        }
        if (options?.mimeTypePrefix && !f.mimeType.startsWith(options.mimeTypePrefix)) {
          return false;
        }
        return true;
      });
    } catch (cause) {
      normalizeDriveError(cause);
    }
  }

  async discoverWorkspaceHierarchy(rootFolderId: string): Promise<DiscoveredDriveHierarchy> {
    const root = await this.inspectFolder(rootFolderId);
    const children = await this.listFolderChildren(rootFolderId);

    const folders = children.filter((c) => c.mimeType === GOOGLE_FOLDER_MIME);
    let contentFolder: DriveRemoteFile | null = null;
    let mediaFolder: DriveRemoteFile | null = null;
    let archiveFolder: DriveRemoteFile | null = null;

    for (const folder of folders) {
      const upper = folder.name.toUpperCase().trim();
      if (upper === "CONTENT" || upper.includes("CONTENT")) {
        contentFolder = folder;
      } else if (upper === "MEDIA" || upper.includes("MEDIA")) {
        mediaFolder = folder;
      } else if (upper === "ARCHIVE" || upper.includes("ARCHIVE")) {
        archiveFolder = folder;
      }
    }

    return {
      rootFolder: root,
      contentFolder,
      mediaFolder,
      archiveFolder,
      recognizedSubfolders: folders,
    };
  }

  async syncMediaAssets(folderId: string): Promise<MediaAsset[]> {
    const cleanFolderId = folderId?.trim() ?? "";
    if (!cleanFolderId) {
      throw new Error("folderId is required");
    }

    fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    const remoteFiles = await this.listFolderChildren(cleanFolderId);
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
