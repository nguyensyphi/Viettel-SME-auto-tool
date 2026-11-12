-- PB-P06 & PB-P07: Social Accounts, Publishing Campaigns, Schedules, Jobs, Job Steps, and Results

CREATE TABLE "SocialAccount" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "profileDir" TEXT NOT NULL,
    "assignedTopics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "maxPostsPerDay" INTEGER NOT NULL DEFAULT 2,
    "minIntervalMinutes" INTEGER NOT NULL DEFAULT 180,
    "preferredWindows" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'NEEDS_AUTH',
    "lastSessionCheckAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SocialAccount_workspaceId_accountCode_key" ON "SocialAccount"("workspaceId", "accountCode");
CREATE INDEX "SocialAccount_workspaceId_platform_status_idx" ON "SocialAccount"("workspaceId", "platform", "status");

CREATE TABLE "PublishingCampaign" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "topicCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "accountIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "startDate" TIMESTAMPTZ(6),
    "endDate" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishingCampaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublishingCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PublishingCampaign_workspaceId_status_idx" ON "PublishingCampaign"("workspaceId", "status");

CREATE TABLE "PublishingSchedule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID,
    "contentId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "publishMode" TEXT NOT NULL DEFAULT 'ASSISTED_PUBLISH',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishingSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublishingSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingSchedule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PublishingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PublishingSchedule_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingSchedule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PublishingSchedule_workspaceId_accountId_scheduledAt_idx" ON "PublishingSchedule"("workspaceId", "accountId", "scheduledAt");

CREATE TABLE "PublishingJob" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "scheduleId" UUID,
    "contentId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "publishMode" TEXT NOT NULL DEFAULT 'ASSISTED_PUBLISH',
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishingJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublishingJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingJob_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PublishingSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PublishingJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PublishingJob_workspaceId_idempotencyKey_key" ON "PublishingJob"("workspaceId", "idempotencyKey");
CREATE INDEX "PublishingJob_workspaceId_accountId_status_idx" ON "PublishingJob"("workspaceId", "accountId", "status");

CREATE TABLE "PublishingJobStep" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishingJobStep_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublishingJobStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PublishingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PublishingJobStep_jobId_createdAt_idx" ON "PublishingJobStep"("jobId", "createdAt");

CREATE TABLE "PublishingResult" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "publishedUrl" TEXT,
    "screenshotPath" TEXT,
    "confirmedBy" TEXT,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishingResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublishingResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PublishingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingResult_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishingResult_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PublishingResult_jobId_key" ON "PublishingResult"("jobId");
CREATE INDEX "PublishingResult_workspaceId_accountId_publishedAt_idx" ON "PublishingResult"("workspaceId", "accountId", "publishedAt");

