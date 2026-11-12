-- CreateTable: CommunityGroup (PC-P01)
CREATE TABLE "CommunityGroup" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "groupCode" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "postingPermission" TEXT NOT NULL DEFAULT 'ALLOWED',
    "minHoursBetweenPosts" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPostedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GroupCampaign (PC-P01)
CREATE TABLE "GroupCampaign" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignType" TEXT NOT NULL,
    "targetCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentTemplate" TEXT NOT NULL,
    "mediaPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedByAmId" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GroupPostJob (PC-P01)
CREATE TABLE "GroupPostJob" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "lockKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "postUrl" TEXT,
    "screenshotPath" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupPostJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PartnerLead (PC-P02)
CREATE TABLE "PartnerLead" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "partnerCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "sourceGroupId" TEXT,
    "notes" TEXT,
    "updatedByAmId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PartnerReferral (PC-P02)
CREATE TABLE "PartnerReferral" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "referralCode" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "normalizedTaxCode" TEXT NOT NULL,
    "productCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'REFERRED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PartnerConversion (PC-P03)
CREATE TABLE "PartnerConversion" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversionCode" TEXT NOT NULL,
    "referralId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "contractRevenueVnd" INTEGER NOT NULL,
    "commissionRatePercent" DOUBLE PRECISION NOT NULL,
    "commissionAmountVnd" INTEGER NOT NULL,
    "commissionPolicyConfirmedByAmId" TEXT NOT NULL,
    "policyReferenceNote" TEXT,
    "payoutStatus" TEXT NOT NULL DEFAULT 'APPROVED_PENDING_PAYOUT',
    "payoutReference" TEXT,
    "paidByOperatorId" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityGroup_workspaceId_groupCode_key" ON "CommunityGroup"("workspaceId", "groupCode");
CREATE INDEX "CommunityGroup_workspaceId_category_active_idx" ON "CommunityGroup"("workspaceId", "category", "active");

CREATE UNIQUE INDEX "GroupCampaign_workspaceId_campaignCode_key" ON "GroupCampaign"("workspaceId", "campaignCode");
CREATE INDEX "GroupCampaign_workspaceId_status_idx" ON "GroupCampaign"("workspaceId", "status");

CREATE UNIQUE INDEX "GroupPostJob_workspaceId_idempotencyKey_key" ON "GroupPostJob"("workspaceId", "idempotencyKey");
CREATE INDEX "GroupPostJob_workspaceId_campaignId_status_idx" ON "GroupPostJob"("workspaceId", "campaignId", "status");

CREATE UNIQUE INDEX "PartnerLead_workspaceId_partnerCode_key" ON "PartnerLead"("workspaceId", "partnerCode");
CREATE UNIQUE INDEX "PartnerLead_workspaceId_phoneHash_key" ON "PartnerLead"("workspaceId", "phoneHash");
CREATE INDEX "PartnerLead_workspaceId_stage_idx" ON "PartnerLead"("workspaceId", "stage");

CREATE UNIQUE INDEX "PartnerReferral_workspaceId_referralCode_key" ON "PartnerReferral"("workspaceId", "referralCode");
CREATE UNIQUE INDEX "PartnerReferral_workspaceId_normalizedTaxCode_key" ON "PartnerReferral"("workspaceId", "normalizedTaxCode");
CREATE INDEX "PartnerReferral_workspaceId_partnerId_status_idx" ON "PartnerReferral"("workspaceId", "partnerId", "status");

CREATE UNIQUE INDEX "PartnerConversion_workspaceId_conversionCode_key" ON "PartnerConversion"("workspaceId", "conversionCode");
CREATE UNIQUE INDEX "PartnerConversion_referralId_key" ON "PartnerConversion"("referralId");
CREATE INDEX "PartnerConversion_workspaceId_partnerId_payoutStatus_idx" ON "PartnerConversion"("workspaceId", "partnerId", "payoutStatus");

-- AddForeignKey
ALTER TABLE "CommunityGroup" ADD CONSTRAINT "CommunityGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupCampaign" ADD CONSTRAINT "GroupCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupPostJob" ADD CONSTRAINT "GroupPostJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupPostJob" ADD CONSTRAINT "GroupPostJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GroupCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupPostJob" ADD CONSTRAINT "GroupPostJob_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CommunityGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerLead" ADD CONSTRAINT "PartnerLead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerReferral" ADD CONSTRAINT "PartnerReferral_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerConversion" ADD CONSTRAINT "PartnerConversion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerConversion" ADD CONSTRAINT "PartnerConversion_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "PartnerReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerConversion" ADD CONSTRAINT "PartnerConversion_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "PartnerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

