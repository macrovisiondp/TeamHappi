-- M10.2: My shifts (docs/architecture/m10.2-my-shifts.md; scope D2, D7, D8).
--
-- Additive. No existing rows change.
--
-- Staff with a linked login see their own PUBLISHED shifts, with what's new or
-- changed since they last looked (rota_seen), and can ASK to take an open shift
-- at their site (shift_request); a manager approves (which runs every
-- assignment check) or declines. Access is by ownership (the employee record
-- linked to the signed-in member), checked in the rota module; no new
-- permissions. No app-role DELETE anywhere.
--
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE shift_request, rota_seen;

-- Requests to take an open shift ------------------------------------------------------
CREATE TABLE "shift_request" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "shift_id"     UUID NOT NULL,
    "employee_id"  UUID NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by"   UUID,
    "decided_at"   TIMESTAMPTZ,
    CONSTRAINT "shift_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_request_shift_fkey" FOREIGN KEY ("tenant_id", "shift_id")
      REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_request_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- Withdrawn by the person themselves (decided_by = them) or decided by a manager.
    CONSTRAINT "shift_request_status" CHECK (
      ("status" = 'pending' AND "decided_by" IS NULL AND "decided_at" IS NULL)
      OR ("status" IN ('approved', 'declined', 'withdrawn') AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "shift_request_tenant_id_id_key" ON "shift_request" ("tenant_id", "id");
-- One pending request per person per shift.
CREATE UNIQUE INDEX "shift_request_one_pending" ON "shift_request" ("tenant_id", "shift_id", "employee_id")
  WHERE "status" = 'pending';
CREATE INDEX "shift_request_shift" ON "shift_request" ("tenant_id", "shift_id") WHERE "status" = 'pending';

-- When each person last looked at My shifts (for "new" and "changed") --------------------
CREATE TABLE "rota_seen" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "seen_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rota_seen_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rota_seen_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "rota_seen_tenant_id_id_key" ON "rota_seen" ("tenant_id", "id");
CREATE UNIQUE INDEX "rota_seen_one_per_person" ON "rota_seen" ("tenant_id", "employee_id");

-- Row-level security ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_request', 'rota_seen']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE. The shift and the
-- person on a request never change.
GRANT SELECT, INSERT ON "shift_request", "rota_seen" TO teamhappi_app;
GRANT UPDATE ("status", "decided_by", "decided_at") ON "shift_request" TO teamhappi_app;
GRANT UPDATE ("seen_at") ON "rota_seen" TO teamhappi_app;
