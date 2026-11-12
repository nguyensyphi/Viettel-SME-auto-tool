import { describe, expect, it } from "vitest";
import {
  GoogleDriveConnector,
  type GoogleDriveTransport,
  type DriveRemoteFile,
} from "../src/google-drive-connector.js";

describe("Enhanced Google Drive Connector - Discovery & Permissions (PB-P01)", () => {
  it("inspects folder metadata and validates folder mime type", async () => {
    const mockTransport: GoogleDriveTransport = {
      async listFolderFiles() {
        return [];
      },
      async downloadFileBytes() {
        return new Uint8Array();
      },
      async getFileMetadata(fileId) {
        if (fileId === "folder_root_123") {
          return {
            id: "folder_root_123",
            name: "VIETTEL_AM",
            mimeType: "application/vnd.google-apps.folder",
          };
        }
        if (fileId === "file_doc_456") {
          return {
            id: "file_doc_456",
            name: "Post_List.docx",
            mimeType: "application/vnd.google-apps.document",
          };
        }
        throw new Error("NOT_FOUND: 404");
      },
    };

    const connector = new GoogleDriveConnector(mockTransport);
    const meta = await connector.inspectFolder("folder_root_123");

    expect(meta.id).toBe("folder_root_123");
    expect(meta.name).toBe("VIETTEL_AM");
    expect(meta.isFolder).toBe(true);

    await expect(connector.inspectFolder("file_doc_456")).rejects.toThrow(
      "NOT_A_DRIVE_FOLDER",
    );
  });

  it("handles 403 permission denied and 404 not found with structured errors", async () => {
    const mockTransport: GoogleDriveTransport = {
      async listFolderFiles(folderId) {
        if (folderId === "private_folder") {
          const err = new Error("The user does not have sufficient permissions: 403");
          (err as { statusCode?: number }).statusCode = 403;
          throw err;
        }
        if (folderId === "missing_folder") {
          const err = new Error("File not found: 404");
          (err as { statusCode?: number }).statusCode = 404;
          throw err;
        }
        return [];
      },
      async downloadFileBytes() {
        return new Uint8Array();
      },
    };

    const connector = new GoogleDriveConnector(mockTransport);

    await expect(connector.listFolderChildren("private_folder")).rejects.toThrow(
      "GOOGLE_DRIVE_PERMISSION_DENIED",
    );
    await expect(connector.listFolderChildren("missing_folder")).rejects.toThrow(
      "GOOGLE_DRIVE_FOLDER_NOT_FOUND",
    );
  });

  it("discovers workspace folder hierarchy and categorizes standard subfolders", async () => {
    const hierarchyFiles: Record<string, DriveRemoteFile[]> = {
      root_1: [
        {
          id: "content_dir",
          name: "CONTENT",
          mimeType: "application/vnd.google-apps.folder",
        },
        {
          id: "media_dir",
          name: "MEDIA",
          mimeType: "application/vnd.google-apps.folder",
        },
        {
          id: "archive_dir",
          name: "ARCHIVE",
          mimeType: "application/vnd.google-apps.folder",
        },
      ],
      content_dir: [
        {
          id: "doc_chu_ky_so",
          name: "Bai_Viet_Chu_Ky_So",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
      media_dir: [
        {
          id: "media_chu_ky_so",
          name: "CHU_KY_SO",
          mimeType: "application/vnd.google-apps.folder",
        },
      ],
    };

    const mockTransport: GoogleDriveTransport = {
      async listFolderFiles(folderId) {
        return hierarchyFiles[folderId] ?? [];
      },
      async downloadFileBytes() {
        return new Uint8Array();
      },
      async getFileMetadata(id) {
        return {
          id,
          name: "Root_VIETTEL_AM",
          mimeType: "application/vnd.google-apps.folder",
        };
      },
    };

    const connector = new GoogleDriveConnector(mockTransport);
    const discovered = await connector.discoverWorkspaceHierarchy("root_1");

    expect(discovered.rootFolder.name).toBe("Root_VIETTEL_AM");
    expect(discovered.contentFolder?.id).toBe("content_dir");
    expect(discovered.mediaFolder?.id).toBe("media_dir");
    expect(discovered.archiveFolder?.id).toBe("archive_dir");
    expect(discovered.recognizedSubfolders).toHaveLength(3);
  });

  it("lists children with MIME type filtering and excludes trashed files", async () => {
    const files: DriveRemoteFile[] = [
      { id: "img1", name: "banner.png", mimeType: "image/png" },
      { id: "img2", name: "cert.jpg", mimeType: "image/jpeg" },
      { id: "pdf1", name: "doc.pdf", mimeType: "application/pdf" },
      { id: "doc1", name: "post.gdoc", mimeType: "application/vnd.google-apps.document" },
    ];

    const mockTransport: GoogleDriveTransport = {
      async listFolderFiles() {
        return files;
      },
      async downloadFileBytes() {
        return new Uint8Array();
      },
    };

    const connector = new GoogleDriveConnector(mockTransport);

    const imagesOnly = await connector.listFolderChildren("media_dir", {
      mimeTypePrefix: "image/",
    });
    expect(imagesOnly.map((f) => f.id)).toEqual(["img1", "img2"]);

    const docsOnly = await connector.listFolderChildren("content_dir", {
      mimeType: "application/vnd.google-apps.document",
    });
    expect(docsOnly.map((f) => f.id)).toEqual(["doc1"]);
  });
});

