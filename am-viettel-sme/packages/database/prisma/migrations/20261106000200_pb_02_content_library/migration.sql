-- PB-P02 & PB-P03: Content Library & Google Documents Schema

CREATE TABLE "GoogleDocument" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revisionId" TEXT,
    "contentHash" TEXT,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "modifiedAt" TIMESTAMPTZ(6),
    "syncedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoogleDocument_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GoogleDocument_connectionId_documentId_key" ON "GoogleDocument"("connectionId", "documentId");
CREATE INDEX "GoogleDocument_connectionId_idx" ON "GoogleDocument"("connectionId");

CREATE TABLE "ContentPost" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "documentId" UUID,
    "postCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topicCode" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL DEFAULT 'BUSINESS_OWNER',
    "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "mediaHint" TEXT,
    "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(6),
    "validUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentPost_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "GoogleDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentPost_workspaceId_postCode_key" ON "ContentPost"("workspaceId", "postCode");
CREATE INDEX "ContentPost_workspaceId_status_idx" ON "ContentPost"("workspaceId", "status");
CREATE INDEX "ContentPost_workspaceId_topicCode_idx" ON "ContentPost"("workspaceId", "topicCode");

CREATE TABLE "ContentVersion" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topicCode" TEXT NOT NULL,
    "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContentVersion_contentId_version_key" ON "ContentVersion"("contentId", "version");
CREATE INDEX "ContentVersion_contentId_idx" ON "ContentVersion"("contentId");

