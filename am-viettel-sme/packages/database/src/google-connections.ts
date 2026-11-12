import { randomUUID } from "node:crypto";

export type GoogleConnectionStatus = "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
export type DriveFolderType = "ROOT" | "CONTENT" | "MEDIA" | "ARCHIVE" | "OTHER";
export type GoogleSyncStatus = "SUCCESS" | "FAILED" | "IN_PROGRESS";

export interface GoogleConnectionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly accountEmail: string;
  readonly scopes: readonly string[];
  readonly status: GoogleConnectionStatus;
  readonly encryptedRefreshToken: string | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GoogleDriveFolderRow {
  readonly id: string;
  readonly connectionId: string;
  readonly driveFolderId: string;
  readonly folderName: string;
  readonly folderType: DriveFolderType;
  readonly pathHint: string | null;
  readonly registeredAt: Date;
  readonly lastSyncedAt: Date | null;
}

export interface GoogleSyncLogRow {
  readonly id: string;
  readonly connectionId: string;
  readonly entityId: string;
  readonly syncType: string;
  readonly syncStatus: GoogleSyncStatus;
  readonly itemsSynced: number;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
}

export interface GoogleConnectionDatabase {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, values?: readonly unknown[]): Promise<void>;
}

export class GoogleConnectionRepository {
  constructor(private readonly db: GoogleConnectionDatabase) {}

  async createConnection(input: {
    readonly workspaceId: string;
    readonly accountEmail: string;
    readonly scopes: readonly string[];
    readonly encryptedRefreshToken?: string | null;
    readonly expiresAt?: Date | null;
  }): Promise<GoogleConnectionRow> {
    const id = randomUUID();
    const rows = await this.db.query<GoogleConnectionRow>(
      `INSERT INTO "GoogleConnection" (
        "id", "workspaceId", "provider", "accountEmail", "scopes", "status",
        "encryptedRefreshToken", "expiresAt", "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'GOOGLE', $3, $4, 'CONNECTED', $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING
        "id", "workspaceId", "provider", "accountEmail", "scopes", "status",
        "encryptedRefreshToken", "expiresAt", "createdAt", "updatedAt"`,
      [
        id,
        input.workspaceId,
        input.accountEmail.trim().toLowerCase(),
        [...input.scopes],
        input.encryptedRefreshToken ?? null,
        input.expiresAt ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("FAILED_TO_CREATE_GOOGLE_CONNECTION");
    return row;
  }

  async getConnectionById(
    workspaceId: string,
    id: string,
  ): Promise<GoogleConnectionRow | null> {
    const rows = await this.db.query<GoogleConnectionRow>(
      `SELECT "id", "workspaceId", "provider", "accountEmail", "scopes", "status",
              "encryptedRefreshToken", "expiresAt", "createdAt", "updatedAt"
       FROM "GoogleConnection"
       WHERE "id" = $1 AND "workspaceId" = $2`,
      [id, workspaceId],
    );
    return rows[0] ?? null;
  }

  async listConnections(workspaceId: string): Promise<GoogleConnectionRow[]> {
    return this.db.query<GoogleConnectionRow>(
      `SELECT "id", "workspaceId", "provider", "accountEmail", "scopes", "status",
              "encryptedRefreshToken", "expiresAt", "createdAt", "updatedAt"
       FROM "GoogleConnection"
       WHERE "workspaceId" = $1
       ORDER BY "createdAt" DESC`,
      [workspaceId],
    );
  }

  async updateConnectionStatus(
    workspaceId: string,
    id: string,
    status: GoogleConnectionStatus,
  ): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE "GoogleConnection"
       SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $2 AND "workspaceId" = $3
       RETURNING "id"`,
      [status, id, workspaceId],
    );
    return rows.length > 0;
  }

  async revokeConnection(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE "GoogleConnection"
       SET "status" = 'REVOKED', "encryptedRefreshToken" = NULL, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "workspaceId" = $2
       RETURNING "id"`,
      [id, workspaceId],
    );
    return rows.length > 0;
  }

  async registerFolder(input: {
    readonly connectionId: string;
    readonly driveFolderId: string;
    readonly folderName: string;
    readonly folderType: DriveFolderType;
    readonly pathHint?: string | null;
  }): Promise<GoogleDriveFolderRow> {
    const id = randomUUID();
    const rows = await this.db.query<GoogleDriveFolderRow>(
      `INSERT INTO "GoogleDriveFolder" (
        "id", "connectionId", "driveFolderId", "folderName", "folderType", "pathHint",
        "registeredAt", "lastSyncedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT ("connectionId", "driveFolderId") DO UPDATE
        SET "folderName" = EXCLUDED."folderName",
            "folderType" = EXCLUDED."folderType",
            "pathHint" = EXCLUDED."pathHint"
      RETURNING "id", "connectionId", "driveFolderId", "folderName", "folderType", "pathHint", "registeredAt", "lastSyncedAt"`,
      [
        id,
        input.connectionId,
        input.driveFolderId.trim(),
        input.folderName.trim(),
        input.folderType,
        input.pathHint ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("FAILED_TO_REGISTER_GOOGLE_DRIVE_FOLDER");
    return row;
  }

  async listFolders(
    workspaceId: string,
    connectionId: string,
  ): Promise<GoogleDriveFolderRow[]> {
    return this.db.query<GoogleDriveFolderRow>(
      `SELECT f."id", f."connectionId", f."driveFolderId", f."folderName", f."folderType",
              f."pathHint", f."registeredAt", f."lastSyncedAt"
       FROM "GoogleDriveFolder" f
       JOIN "GoogleConnection" c ON c."id" = f."connectionId"
       WHERE f."connectionId" = $1 AND c."workspaceId" = $2
       ORDER BY f."folderName" ASC`,
      [connectionId, workspaceId],
    );
  }

  async updateFolderSyncTime(folderId: string): Promise<void> {
    await this.db.execute(
      `UPDATE "GoogleDriveFolder"
       SET "lastSyncedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [folderId],
    );
  }

  async appendSyncLog(input: {
    readonly connectionId: string;
    readonly entityId: string;
    readonly syncType: string;
    readonly syncStatus: GoogleSyncStatus;
    readonly itemsSynced: number;
    readonly errorMessage?: string | null;
  }): Promise<GoogleSyncLogRow> {
    const id = randomUUID();
    const rows = await this.db.query<GoogleSyncLogRow>(
      `INSERT INTO "GoogleSyncLog" (
        "id", "connectionId", "entityId", "syncType", "syncStatus", "itemsSynced", "errorMessage", "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      RETURNING "id", "connectionId", "entityId", "syncType", "syncStatus", "itemsSynced", "errorMessage", "createdAt"`,
      [
        id,
        input.connectionId,
        input.entityId,
        input.syncType,
        input.syncStatus,
        input.itemsSynced,
        input.errorMessage ?? null,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("FAILED_TO_APPEND_SYNC_LOG");
    return row;
  }

  async listSyncLogs(connectionId: string, limit: number = 50): Promise<GoogleSyncLogRow[]> {
    return this.db.query<GoogleSyncLogRow>(
      `SELECT "id", "connectionId", "entityId", "syncType", "syncStatus", "itemsSynced", "errorMessage", "createdAt"
       FROM "GoogleSyncLog"
       WHERE "connectionId" = $1
       ORDER BY "createdAt" DESC
       LIMIT $2`,
      [connectionId, limit],
    );
  }
}

