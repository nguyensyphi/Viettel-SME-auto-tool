-- Retention is deliberately unconfigured until an authorized owner approves a value.
ALTER TABLE "DataRetentionPolicy"
ADD CONSTRAINT "DataRetentionPolicy_approval_check"
CHECK (
  ("retentionDays" IS NULL AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL)
  OR
  ("retentionDays" BETWEEN 1 AND 3650 AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
);

-- An allowed consent state must be backed by a captured timestamp and evidence reference.
ALTER TABLE "ConsentRecord"
ADD CONSTRAINT "ConsentRecord_allowed_requires_evidence_check"
CHECK (
  "status" <> 'ALLOWED_FOR_RECORDED_PURPOSE'
  OR ("capturedAt" IS NOT NULL AND NULLIF(BTRIM("evidenceReference"), '') IS NOT NULL)
);

ALTER TABLE "Task"
ADD CONSTRAINT "Task_estimated_minutes_positive_check"
CHECK ("estimatedMinutes" > 0);

ALTER TABLE "LockedTimeBlock"
ADD CONSTRAINT "LockedTimeBlock_start_before_end_check"
CHECK ("startsAt" < "endsAt");

CREATE OR REPLACE FUNCTION "reject_append_only_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; UPDATE and DELETE are forbidden', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE TRIGGER "ConsentRecord_append_only"
BEFORE UPDATE OR DELETE ON "ConsentRecord"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE TRIGGER "SuppressionRecord_append_only"
BEFORE UPDATE OR DELETE ON "SuppressionRecord"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE OR REPLACE FUNCTION "reject_user_hard_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'User rows must be deactivated or anonymized; hard deletion is forbidden';
END;
$$;

CREATE TRIGGER "User_no_hard_delete"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION "reject_user_hard_delete"();

CREATE OR REPLACE FUNCTION "block_contactability_after_suppression"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."contactabilityStatus" = 'ALLOWED_FOR_RECORDED_PURPOSE'
     AND EXISTS (
       SELECT 1
       FROM "SuppressionRecord" AS suppression
       WHERE suppression."workspaceId" = NEW."workspaceId"
         AND suppression."leadContactId" = NEW."id"
     ) THEN
    RAISE EXCEPTION 'A suppressed contact cannot become contactable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LeadContact_block_suppressed_activation"
BEFORE UPDATE OF "contactabilityStatus" ON "LeadContact"
FOR EACH ROW EXECUTE FUNCTION "block_contactability_after_suppression"();

CREATE OR REPLACE FUNCTION "mark_contact_suppressed"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "LeadContact"
  SET "contactabilityStatus" = 'SUPPRESSED', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."leadContactId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SuppressionRecord_blocks_contact"
AFTER INSERT ON "SuppressionRecord"
FOR EACH ROW EXECUTE FUNCTION "mark_contact_suppressed"();
