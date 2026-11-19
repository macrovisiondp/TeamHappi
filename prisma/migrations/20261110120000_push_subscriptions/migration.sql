-- M12: push notifications for shift changes (docs/architecture/m12-app-and-push.md).
--
-- Additive. No existing rows change.
--
-- A member turns on alerts on a device; the browser gives us a push endpoint
-- and two public keys, stored here for that membership in that organisation.
-- When their published shifts change, TeamHappi sends a short, generic alert
-- ("Your shifts have changed") with no names, times or places, so nothing
-- private shows on a locked phone. Endpoints that the push service reports as
-- gone are marked removed. No app-role DELETE.
--
-- Rollback (only while the table is empty; see the record):
--   DROP TABLE push_subscription;

CREATE TABLE "push_subscription" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    -- The push service URL for this device (https only).
    "endpoint"      TEXT NOT NULL,
    -- The browser's public encryption keys (base64url). Not secret, but never logged.
    "p256dh"        TEXT NOT NULL,
    "auth"          TEXT NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sent_at"  TIMESTAMPTZ,
    "removed_at"    TIMESTAMPTZ,
    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_subscription_membership_fkey" FOREIGN KEY ("tenant_id", "membership_id")
      REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "push_subscription_endpoint" CHECK (
      "endpoint" LIKE 'https://%' AND char_length("endpoint") <= 1000),
    CONSTRAINT "push_subscription_keys" CHECK (
      "p256dh" ~ '^[A-Za-z0-9_-]{80,100}$' AND "auth" ~ '^[A-Za-z0-9_-]{16,30}$')
);
CREATE UNIQUE INDEX "push_subscription_tenant_id_id_key" ON "push_subscription" ("tenant_id", "id");
-- One live row per device in an organisation.
CREATE UNIQUE INDEX "push_subscription_one_live" ON "push_subscription" ("tenant_id", "endpoint")
  WHERE "removed_at" IS NULL;
CREATE INDEX "push_subscription_membership" ON "push_subscription" ("tenant_id", "membership_id")
  WHERE "removed_at" IS NULL;

ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "push_subscription" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE.
GRANT SELECT, INSERT ON "push_subscription" TO teamhappi_app;
GRANT UPDATE ("last_sent_at", "removed_at") ON "push_subscription" TO teamhappi_app;
