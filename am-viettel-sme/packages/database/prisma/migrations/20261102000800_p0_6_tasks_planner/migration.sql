CREATE TYPE "TaskApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_AM_APPROVAL', 'APPROVED');

ALTER TABLE "Task"
  ADD COLUMN "leadContactId" UUID,
  ADD COLUMN "approvedByUserId" UUID,
  ADD COLUMN "suggestedProductInterestId" UUID,
  ADD COLUMN "contactChannel" "ContactChannel",
  ADD COLUMN "approvalStatus" "TaskApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "nextAction" VARCHAR(500),
  ADD COLUMN "deferReason" VARCHAR(300),
  ADD COLUMN "cancelReason" VARCHAR(300),
  ADD COLUMN "completionOutcome" VARCHAR(1000),
  ADD COLUMN "suggestedService" VARCHAR(160),
  ADD COLUMN "approvedAt" TIMESTAMPTZ(6),
  ADD COLUMN "completedAt" TIMESTAMPTZ(6);

-- Existing contact tasks are not presumed approved by this migration.
UPDATE "Task"
SET "approvalStatus" = 'PENDING_AM_APPROVAL'
WHERE "type" IN ('CALL', 'EMAIL', 'FOLLOW_UP');

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_leadContactId_fkey"
    FOREIGN KEY ("workspaceId", "leadContactId")
    REFERENCES "LeadContact" ("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_approvedByUserId_fkey"
    FOREIGN KEY ("workspaceId", "approvedByUserId")
    REFERENCES "User" ("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_suggestedProductInterestId_fkey"
    FOREIGN KEY ("workspaceId", "suggestedProductInterestId")
    REFERENCES "ProductInterest" ("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Task_workspaceId_assigneeUserId_approvalStatus_status_idx"
  ON "Task" ("workspaceId", "assigneeUserId", "approvalStatus", "status");
CREATE INDEX "Task_workspaceId_leadContactId_status_idx"
  ON "Task" ("workspaceId", "leadContactId", "status");
