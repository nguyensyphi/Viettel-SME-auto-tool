-- PB-P04 & PB-P05: Media Assets, Versions, Content-Media Links, and Content Approvals

CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectionId" UUID,
    "driveFileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "topicCode" TEXT NOT NULL,
    "postCodeHint" TEXT,
    "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isSharedMedia" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaAsset_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MediaAsset_workspaceId_driveFileId_key" ON "MediaAsset"("workspaceId", "driveFileId");
CREATE INDEX "MediaAsset_workspaceId_topicCode_idx" ON "MediaAsset"("workspaceId", "topicCode");
CREATE INDEX "MediaAsset_workspaceId_checksum_idx" ON "MediaAsset"("workspaceId", "checksum");

CREATE TABLE "MediaVersion" (
    "id" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaVersion_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MediaVersion_mediaId_version_key" ON "MediaVersion"("mediaId", "version");
CREATE INDEX "MediaVersion_mediaId_idx" ON "MediaVersion"("mediaId");

CREATE TABLE "ContentMediaLink" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "matchMethod" TEXT NOT NULL DEFAULT 'TOPIC',
    "matchScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentMediaLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentMediaLink_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentMediaLink_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentMediaLink_contentId_mediaId_key" ON "ContentMediaLink"("contentId", "mediaId");
CREATE INDEX "ContentMediaLink_contentId_idx" ON "ContentMediaLink"("contentId");

CREATE TABLE "ContentApproval" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "mediaVersion" INTEGER,
    "approvedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approvedPlatforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentApproval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentApproval_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ContentApproval_contentId_createdAt_idx" ON "ContentApproval"("contentId", "createdAt");

