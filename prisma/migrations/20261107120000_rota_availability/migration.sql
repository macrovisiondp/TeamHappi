-- M10.3: availability, drops and swaps (docs/architecture/m10.3-availability-swaps.md;
-- scope in docs/architecture/m10-rota-scope.md).
--
-- Additive. No existing rows change.
--
-- Staff with a linked login mark when they can't work: weekly (a weekday, all
-- day or between two times) or for dates (a range, all day or between two
-- times). Managers get a warning when assigning them (needs a reason), like the
-- other warnings. Staff can also ask to DROP one of their published, future
-- shifts (the manager approves; it becomes open) or to SWAP it to a named
-- colleague at the site (the colleague accepts, then the manager approves; every
-- assignment check runs). Access is by ownership of the linked staff record;
-- managers act with rota.manage at the site. No app-role DELETE anywhere.
--
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE shift_change_request, unavailability;

-- When someone can't work ---------------------------------------------------------------
CREATE TABLE "unavailability" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind"        TEXT NOT NULL,
    -- weekly: ISO weekday, 1 = Monday ... 7 = Sunday.
    "weekday"     SMALLINT,
    -- dates: an inclusive range.
    "starts_on"   DATE,
    "ends_on"     DATE,
    -- Both empty = all day; otherwise local wall-clock times at the shift's site.
    "start_time"  TIME,
    "end_time"    TIME,
    "note"        TEXT,
    "created_by"  UUID NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at"  TIMESTAMPTZ,
    "removed_by"  UUID,
    CONSTRAINT "unavailability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "unavailability_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "unavailability_kind" CHECK (
      ("kind" = 'weekly' AND "weekday" BETWEEN 1 AND 7 AND "starts_on" IS NULL AND "ends_on" IS NULL)
      OR ("kind" = 'dates' AND "weekday" IS NULL AND "starts_on" IS NOT NULL AND "ends_on" IS NOT NULL
          AND "ends_on" >= "starts_on" AND "ends_on" - "starts_on" <= 366)),
    CONSTRAINT "unavailability_times" CHECK (
      ("start_time" IS NULL AND "end_time" IS NULL)
      OR ("start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "end_time" > "start_time")),
    CONSTRAINT "unavailability_note" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200),
    CONSTRAINT "unavailability_removed" CHECK (("removed_at" IS NULL) = ("removed_by" IS NULL))
);
CREATE UNIQUE INDEX "unavailability_tenant_id_id_key" ON "unavailability" ("tenant_id", "id");
CREATE INDEX "unavailability_employee" ON "unavailability" ("tenant_id", "employee_id") WHERE "removed_at" IS NULL;

-- Requests to drop or swap a shift --------------------------------------------------------
CREATE TABLE "shift_change_request" (
    "id"                  UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID NOT NULL,
    "shift_id"            UUID NOT NULL,
    -- The person on the shift who is asking.
    "employee_id"         UUID NOT NULL,
    "kind"                TEXT NOT NULL,
    -- Swap: the colleague who would take it.
    "target_employee_id"  UUID,
    -- pending (swap: waiting for the colleague; drop: waiting for a manager),
    -- accepted (swap: the colleague agreed, waiting for a manager), then
    -- approved, declined, withdrawn or cancelled (the shift changed meanwhile).
    "status"              TEXT NOT NULL DEFAULT 'pending',
    "requested_by"        UUID NOT NULL,
    "requested_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_responded_at" TIMESTAMPTZ,
    "decided_by"          UUID,
    "decided_at"          TIMESTAMPTZ,
    CONSTRAINT "shift_change_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_change_request_shift_fkey" FOREIGN KEY ("tenant_id", "shift_id")
      REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_change_request_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_change_request_target_fkey" FOREIGN KEY ("tenant_id", "target_employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_change_request_kind" CHECK (
      ("kind" = 'drop' AND "target_employee_id" IS NULL)
      OR ("kind" = 'swap' AND "target_employee_id" IS NOT NULL AND "target_employee_id" <> "employee_id")),
    CONSTRAINT "shift_change_request_status" CHECK (
      ("status" = 'pending' AND "decided_by" IS NULL AND "decided_at" IS NULL)
      OR ("status" = 'accepted' AND "kind" = 'swap' AND "target_responded_at" IS NOT NULL
          AND "decided_by" IS NULL AND "decided_at" IS NULL)
      OR ("status" IN ('approved', 'declined', 'withdrawn', 'cancelled')
          AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "shift_change_request_tenant_id_id_key" ON "shift_change_request" ("tenant_id", "id");
-- One open request per shift.
CREATE UNIQUE INDEX "shift_change_request_one_open" ON "shift_change_request" ("tenant_id", "shift_id")
  WHERE "status" IN ('pending', 'accepted');
CREATE INDEX "shift_change_request_target" ON "shift_change_request" ("tenant_id", "target_employee_id")
  WHERE "status" = 'pending';

-- Row-level security ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unavailability', 'shift_change_request']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE. Who, which shift and
-- what kind never change.
GRANT SELECT, INSERT ON "unavailability", "shift_change_request" TO teamhappi_app;
GRANT UPDATE ("removed_at", "removed_by") ON "unavailability" TO teamhappi_app;
GRANT UPDATE ("status", "target_responded_at", "decided_by", "decided_at")
  ON "shift_change_request" TO teamhappi_app;
