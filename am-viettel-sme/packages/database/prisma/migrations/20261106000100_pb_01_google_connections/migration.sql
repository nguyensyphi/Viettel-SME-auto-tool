-- PB-P01: Google OAuth + Drive Integration Schema

CREATE TYPE "GoogleConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');
CREATE TYPE "DriveFolderType" AS ENUM ('ROOT', 'CONTENT', 'MEDIA', 'ARCHIVE', 'OTHER');
CREATE TYPE "GoogleSyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'IN_PROGRESS');

CREATE TABLE "GoogleConnection" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE',
    "accountEmail" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoogleConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GoogleConnection_workspaceId_status_idx" ON "GoogleConnection"("workspaceId", "status");

CREATE TABLE "GoogleDriveFolder" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "folderType" "DriveFolderType" NOT NULL DEFAULT 'OTHER',
    "pathHint" TEXT,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMPTZ(6),
    CONSTRAINT "GoogleDriveFolder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoogleDriveFolder_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GoogleDriveFolder_connectionId_idx" ON "GoogleDriveFolder"("connectionId");
CREATE UNIQUE INDEX "GoogleDriveFolder_connectionId_driveFolderId_key" ON "GoogleDriveFolder"("connectionId", "driveFolderId");

CREATE TABLE "GoogleSyncLog" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "entityId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "syncStatus" "GoogleSyncStatus" NOT NULL,
    "itemsSynced" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleSyncLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoogleSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GoogleSyncLog_connectionId_createdAt_idx" ON "GoogleSyncLog"("connectionId", "createdAt");

