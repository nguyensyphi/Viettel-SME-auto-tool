CREATE OR REPLACE FUNCTION "assert_suppression_audit_link"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  linked_action TEXT;
  linked_entity_type TEXT;
  linked_entity_id TEXT;
  linked_actor_id UUID;
BEGIN
  SELECT event."action", event."entityType", event."entityId", event."actorId"
  INTO linked_action, linked_entity_type, linked_entity_id, linked_actor_id
  FROM "AuditEvent" AS event
  WHERE event."workspaceId" = NEW."workspaceId"
    AND event."id" = NEW."auditEventId";

  IF linked_action IS DISTINCT FROM 'SUPPRESSION_CREATED'
     OR linked_entity_type IS DISTINCT FROM 'SuppressionRecord'
     OR linked_entity_id IS DISTINCT FROM NEW."id"::TEXT
     OR linked_actor_id IS DISTINCT FROM NEW."recordedByUserId" THEN
    RAISE EXCEPTION 'SuppressionRecord must reference its matching actor/action/entity audit event';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SuppressionRecord_audit_link_check"
BEFORE INSERT ON "SuppressionRecord"
FOR EACH ROW EXECUTE FUNCTION "assert_suppression_audit_link"();

CREATE OR REPLACE FUNCTION "assert_consent_audit_link"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  linked_action TEXT;
  linked_entity_type TEXT;
  linked_entity_id TEXT;
  linked_actor_id UUID;
BEGIN
  SELECT event."action", event."entityType", event."entityId", event."actorId"
  INTO linked_action, linked_entity_type, linked_entity_id, linked_actor_id
  FROM "AuditEvent" AS event
  WHERE event."workspaceId" = NEW."workspaceId"
    AND event."id" = NEW."auditEventId";

  IF linked_action IS DISTINCT FROM 'CONSENT_RECORDED'
     OR linked_entity_type IS DISTINCT FROM 'ConsentRecord'
     OR linked_entity_id IS DISTINCT FROM NEW."id"::TEXT
     OR linked_actor_id IS DISTINCT FROM NEW."recordedByUserId" THEN
    RAISE EXCEPTION 'ConsentRecord must reference its matching actor/action/entity audit event';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ConsentRecord_audit_link_check"
BEFORE INSERT ON "ConsentRecord"
FOR EACH ROW EXECUTE FUNCTION "assert_consent_audit_link"();
