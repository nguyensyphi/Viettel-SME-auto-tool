-- P0.5: persist lead notes and the exact stage transition in append-only audit events.
ALTER TABLE "AuditEvent"
    ADD COLUMN "beforeStage" "LeadStage",
    ADD COLUMN "afterStage" "LeadStage";

CREATE TABLE "LeadNote" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "content" VARCHAR(5000) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadNote_workspaceId_id_key"
    ON "LeadNote"("workspaceId", "id");
CREATE INDEX "LeadNote_workspaceId_leadId_createdAt_idx"
    ON "LeadNote"("workspaceId", "leadId", "createdAt");
CREATE INDEX "LeadNote_workspaceId_authorUserId_createdAt_idx"
    ON "LeadNote"("workspaceId", "authorUserId", "createdAt");

ALTER TABLE "LeadNote"
    ADD CONSTRAINT "LeadNote_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "LeadNote_workspaceId_leadId_fkey"
        FOREIGN KEY ("workspaceId", "leadId") REFERENCES "Lead"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "LeadNote_workspaceId_authorUserId_fkey"
        FOREIGN KEY ("workspaceId", "authorUserId") REFERENCES "User"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
