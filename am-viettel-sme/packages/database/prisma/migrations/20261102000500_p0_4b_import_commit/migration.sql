ALTER TABLE "ImportJob"
ADD COLUMN "failureReasonCode" VARCHAR(80);

ALTER TABLE "AuditEvent"
ADD COLUMN "beforeContactabilityStatus" "ContactabilityStatus",
ADD COLUMN "afterContactabilityStatus" "ContactabilityStatus",
ADD COLUMN "beforeConsentStatus" "ConsentStatus",
ADD COLUMN "afterConsentStatus" "ConsentStatus";

DROP INDEX "ImportJob_workspaceId_fileChecksum_idx";

CREATE UNIQUE INDEX "ImportJob_workspaceId_fileChecksum_key"
ON "ImportJob"("workspaceId", "fileChecksum");
