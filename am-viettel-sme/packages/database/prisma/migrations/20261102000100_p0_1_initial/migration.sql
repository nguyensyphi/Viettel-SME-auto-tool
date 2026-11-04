-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AM', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('PENDING_REVIEW', 'NEW', 'QUALIFIED', 'CONTACTED', 'MEETING_SET', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('BUSINESS_CONTACT', 'INDIVIDUAL_CONTACT');

-- CreateEnum
CREATE TYPE "ContactabilityStatus" AS ENUM ('UNKNOWN', 'REVIEW_REQUIRED', 'ALLOWED_FOR_RECORDED_PURPOSE', 'OPTED_OUT', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('AM_ENTERED', 'CUSTOMER_REQUEST', 'REFERRAL', 'WEB_SOURCE', 'IMPORTED', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactBasis" AS ENUM ('UNKNOWN', 'CUSTOMER_REQUEST', 'EXISTING_RELATIONSHIP', 'CONSENT_RECORDED', 'OTHER_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'REVIEW_REQUIRED', 'ALLOWED_FOR_RECORDED_PURPOSE', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('PHONE', 'EMAIL', 'SMS', 'ZALO', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('OPT_OUT', 'COMPLAINT', 'LEGAL_REQUEST', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductInterestStatus" AS ENUM ('UNREVIEWED', 'AM_CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'MAPPED', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'COMMITTED', 'REJECTED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'NEEDS_REVIEW', 'SKIPPED', 'COMMITTED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('REVIEW_LEAD', 'CALL', 'EMAIL', 'MEETING', 'FOLLOW_UP', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'DEFERRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "RetentionCategory" AS ENUM ('RAW_WORKBOOK', 'IMPORT_ROW_RESULTS', 'LEAD_DATA', 'AUDIT_EVENTS');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "emailNormalized" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120),
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "invitationTokenHash" VARCHAR(128),
    "invitedAt" TIMESTAMPTZ(6),
    "invitationExpiresAt" TIMESTAMPTZ(6),
    "acceptedAt" TIMESTAMPTZ(6),
    "deactivatedAt" TIMESTAMPTZ(6),
    "invitedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "teamId" UUID,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyName" VARCHAR(200) NOT NULL,
    "normalizedCompanyName" VARCHAR(200) NOT NULL,
    "industry" VARCHAR(120),
    "district" VARCHAR(120),
    "province" VARCHAR(120),
    "website" VARCHAR(500),
    "businessAddress" VARCHAR(500),
    "stage" "LeadStage" NOT NULL DEFAULT 'PENDING_REVIEW',
    "ownerUserId" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "contactName" VARCHAR(160),
    "jobTitle" VARCHAR(120),
    "contactType" "ContactType" NOT NULL DEFAULT 'BUSINESS_CONTACT',
    "phoneNormalized" VARCHAR(32),
    "emailNormalized" VARCHAR(320),
    "contactabilityStatus" "ContactabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "sourceType" "LeadSourceType" NOT NULL,
    "sourceLabel" VARCHAR(160),
    "sourceUrl" VARCHAR(1000),
    "collectedAt" TIMESTAMPTZ(6),
    "contactBasis" "ContactBasis" NOT NULL DEFAULT 'UNKNOWN',
    "recordedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadContactId" UUID NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "purpose" VARCHAR(160) NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "capturedAt" TIMESTAMPTZ(6),
    "evidenceReference" VARCHAR(500),
    "recordedByUserId" UUID NOT NULL,
    "auditEventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadContactId" UUID NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "auditEventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductInterest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "productCode" VARCHAR(80),
    "productName" VARCHAR(160) NOT NULL,
    "status" "ProductInterestStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "recordedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProductInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "uploaderUserId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "fileChecksum" CHAR(64) NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRowResult" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "errorCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorColumns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchedLeadId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnMapping" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "sourceColumnIndex" INTEGER NOT NULL,
    "targetField" VARCHAR(64),
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColumnMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID,
    "assigneeUserId" UUID NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "type" "TaskType" NOT NULL,
    "outcomeGoal" VARCHAR(300) NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priorityReason" VARCHAR(300),
    "predecessorId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockedTimeBlock" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "label" VARCHAR(160),
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LockedTimeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" "UserRole",
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(60) NOT NULL,
    "requestId" VARCHAR(100),
    "jobId" UUID,
    "changedFieldNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRetentionPolicy" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "retentionDays" INTEGER,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_invitationTokenHash_key" ON "User"("invitationTokenHash");

-- CreateIndex
CREATE INDEX "User_workspaceId_status_idx" ON "User"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "User_workspaceId_invitedByUserId_idx" ON "User"("workspaceId", "invitedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_workspaceId_id_key" ON "User"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_workspaceId_emailNormalized_key" ON "User"("workspaceId", "emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Team_workspaceId_id_key" ON "Team"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Team_workspaceId_name_key" ON "Team"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "TeamMembership_workspaceId_teamId_role_idx" ON "TeamMembership"("workspaceId", "teamId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_workspaceId_id_key" ON "TeamMembership"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_workspaceId_userId_key" ON "TeamMembership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_ownerUserId_stage_idx" ON "Lead"("workspaceId", "ownerUserId", "stage");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_stage_updatedAt_idx" ON "Lead"("workspaceId", "stage", "updatedAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_normalizedCompanyName_district_idx" ON "Lead"("workspaceId", "normalizedCompanyName", "district");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_workspaceId_id_key" ON "Lead"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "LeadContact_workspaceId_leadId_idx" ON "LeadContact"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "LeadContact_workspaceId_phoneNormalized_idx" ON "LeadContact"("workspaceId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "LeadContact_workspaceId_emailNormalized_idx" ON "LeadContact"("workspaceId", "emailNormalized");

-- CreateIndex
CREATE INDEX "LeadContact_workspaceId_contactabilityStatus_idx" ON "LeadContact"("workspaceId", "contactabilityStatus");

-- CreateIndex
CREATE UNIQUE INDEX "LeadContact_workspaceId_id_key" ON "LeadContact"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "LeadSource_workspaceId_leadId_createdAt_idx" ON "LeadSource"("workspaceId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadSource_workspaceId_sourceType_collectedAt_idx" ON "LeadSource"("workspaceId", "sourceType", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_workspaceId_id_key" ON "LeadSource"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_auditEventId_key" ON "ConsentRecord"("auditEventId");

-- CreateIndex
CREATE INDEX "ConsentRecord_workspaceId_leadContactId_channel_createdAt_idx" ON "ConsentRecord"("workspaceId", "leadContactId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_workspaceId_status_createdAt_idx" ON "ConsentRecord"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_workspaceId_id_key" ON "ConsentRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_workspaceId_auditEventId_key" ON "ConsentRecord"("workspaceId", "auditEventId");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionRecord_auditEventId_key" ON "SuppressionRecord"("auditEventId");

-- CreateIndex
CREATE INDEX "SuppressionRecord_workspaceId_leadContactId_channel_created_idx" ON "SuppressionRecord"("workspaceId", "leadContactId", "channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionRecord_workspaceId_id_key" ON "SuppressionRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionRecord_workspaceId_auditEventId_key" ON "SuppressionRecord"("workspaceId", "auditEventId");

-- CreateIndex
CREATE INDEX "ProductInterest_workspaceId_leadId_status_idx" ON "ProductInterest"("workspaceId", "leadId", "status");

-- CreateIndex
CREATE INDEX "ProductInterest_workspaceId_productCode_idx" ON "ProductInterest"("workspaceId", "productCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductInterest_workspaceId_id_key" ON "ProductInterest"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_status_createdAt_idx" ON "ImportJob"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_workspaceId_fileChecksum_idx" ON "ImportJob"("workspaceId", "fileChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_workspaceId_id_key" ON "ImportJob"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_workspaceId_idempotencyKey_key" ON "ImportJob"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ImportRowResult_workspaceId_importJobId_status_idx" ON "ImportRowResult"("workspaceId", "importJobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRowResult_workspaceId_id_key" ON "ImportRowResult"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRowResult_workspaceId_importJobId_rowNumber_key" ON "ImportRowResult"("workspaceId", "importJobId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMapping_workspaceId_id_key" ON "ColumnMapping"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMapping_workspaceId_importJobId_sourceColumnIndex_key" ON "ColumnMapping"("workspaceId", "importJobId", "sourceColumnIndex");

-- CreateIndex
CREATE INDEX "Task_workspaceId_assigneeUserId_dueAt_status_idx" ON "Task"("workspaceId", "assigneeUserId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_leadId_status_idx" ON "Task"("workspaceId", "leadId", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_status_dueAt_idx" ON "Task"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workspaceId_id_key" ON "Task"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "LockedTimeBlock_workspaceId_userId_startsAt_endsAt_idx" ON "LockedTimeBlock"("workspaceId", "userId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LockedTimeBlock_workspaceId_id_key" ON "LockedTimeBlock"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_actorId_createdAt_idx" ON "AuditEvent"("workspaceId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_entityType_entityId_createdAt_idx" ON "AuditEvent"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_action_createdAt_idx" ON "AuditEvent"("workspaceId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_jobId_idx" ON "AuditEvent"("workspaceId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_workspaceId_id_key" ON "AuditEvent"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "DataRetentionPolicy_workspaceId_retentionDays_idx" ON "DataRetentionPolicy"("workspaceId", "retentionDays");

-- CreateIndex
CREATE UNIQUE INDEX "DataRetentionPolicy_workspaceId_id_key" ON "DataRetentionPolicy"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DataRetentionPolicy_workspaceId_category_key" ON "DataRetentionPolicy"("workspaceId", "category");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_invitedByUserId_fkey" FOREIGN KEY ("workspaceId", "invitedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_workspaceId_teamId_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "Team"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_ownerUserId_fkey" FOREIGN KEY ("workspaceId", "ownerUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_createdByUserId_fkey" FOREIGN KEY ("workspaceId", "createdByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "Lead"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "Lead"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_workspaceId_recordedByUserId_fkey" FOREIGN KEY ("workspaceId", "recordedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_leadContactId_fkey" FOREIGN KEY ("workspaceId", "leadContactId") REFERENCES "LeadContact"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_recordedByUserId_fkey" FOREIGN KEY ("workspaceId", "recordedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_auditEventId_fkey" FOREIGN KEY ("workspaceId", "auditEventId") REFERENCES "AuditEvent"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionRecord" ADD CONSTRAINT "SuppressionRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionRecord" ADD CONSTRAINT "SuppressionRecord_workspaceId_leadContactId_fkey" FOREIGN KEY ("workspaceId", "leadContactId") REFERENCES "LeadContact"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionRecord" ADD CONSTRAINT "SuppressionRecord_workspaceId_recordedByUserId_fkey" FOREIGN KEY ("workspaceId", "recordedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionRecord" ADD CONSTRAINT "SuppressionRecord_workspaceId_auditEventId_fkey" FOREIGN KEY ("workspaceId", "auditEventId") REFERENCES "AuditEvent"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductInterest" ADD CONSTRAINT "ProductInterest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductInterest" ADD CONSTRAINT "ProductInterest_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "Lead"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductInterest" ADD CONSTRAINT "ProductInterest_workspaceId_recordedByUserId_fkey" FOREIGN KEY ("workspaceId", "recordedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_workspaceId_uploaderUserId_fkey" FOREIGN KEY ("workspaceId", "uploaderUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowResult" ADD CONSTRAINT "ImportRowResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowResult" ADD CONSTRAINT "ImportRowResult_workspaceId_importJobId_fkey" FOREIGN KEY ("workspaceId", "importJobId") REFERENCES "ImportJob"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowResult" ADD CONSTRAINT "ImportRowResult_workspaceId_matchedLeadId_fkey" FOREIGN KEY ("workspaceId", "matchedLeadId") REFERENCES "Lead"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColumnMapping" ADD CONSTRAINT "ColumnMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColumnMapping" ADD CONSTRAINT "ColumnMapping_workspaceId_importJobId_fkey" FOREIGN KEY ("workspaceId", "importJobId") REFERENCES "ImportJob"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_leadId_fkey" FOREIGN KEY ("workspaceId", "leadId") REFERENCES "Lead"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_assigneeUserId_fkey" FOREIGN KEY ("workspaceId", "assigneeUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_assignedByUserId_fkey" FOREIGN KEY ("workspaceId", "assignedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_predecessorId_fkey" FOREIGN KEY ("workspaceId", "predecessorId") REFERENCES "Task"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockedTimeBlock" ADD CONSTRAINT "LockedTimeBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockedTimeBlock" ADD CONSTRAINT "LockedTimeBlock_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRetentionPolicy" ADD CONSTRAINT "DataRetentionPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRetentionPolicy" ADD CONSTRAINT "DataRetentionPolicy_workspaceId_approvedByUserId_fkey" FOREIGN KEY ("workspaceId", "approvedByUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
