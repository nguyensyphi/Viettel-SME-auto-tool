-- No time-basis default is intentional: legacy and unconfigured policies must fail closed.
CREATE TYPE "RetentionTimeBasis" AS ENUM ('CREATED_AT', 'UPDATED_AT', 'COMPLETED_AT');

ALTER TABLE "DataRetentionPolicy"
ADD COLUMN "timeBasis" "RetentionTimeBasis";

-- One append-only audit marker per workspace/run/category makes retries idempotent.
CREATE UNIQUE INDEX "AuditEvent_retention_job_category_key"
ON "AuditEvent" ("workspaceId", "jobId", "entityType", "entityId", "action")
WHERE "action" = 'RETENTION_PURGED' AND "jobId" IS NOT NULL;
