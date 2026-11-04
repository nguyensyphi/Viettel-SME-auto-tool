CREATE TABLE "AdminBootstrapState" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "adminUserId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminBootstrapState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminBootstrapState_singleton_check" CHECK ("id" = 1)
);

-- This marker deliberately has no FK to User, so successful bootstrap remains recorded across account changes.
COMMENT ON TABLE "AdminBootstrapState" IS 'Durable one-time first-Admin bootstrap marker; do not delete or reset.';
COMMENT ON COLUMN "AdminBootstrapState"."adminUserId" IS 'Historical user ID; intentionally not a foreign key.';

CREATE TRIGGER "AdminBootstrapState_append_only"
BEFORE UPDATE OR DELETE ON "AdminBootstrapState"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
