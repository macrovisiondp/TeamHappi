-- M11.2 + M11.3: weekly timesheets, approval and export
-- (docs/architecture/m11.2-timesheets.md; scope in m11-attendance-scope.md, approved
-- 19 November 2026; bundled into one release by the product owner the same day).
--
-- Additive. No existing rows change except that two new permissions are added to
-- the permission catalogue and to every organisation's BUILT-IN roles (approve:
-- owner, admin, hr_manager, site_manager; export: owner, admin, hr_manager),
-- matching src/lib/permissions/catalogue.ts. Custom roles are not touched.
--
-- One timesheet per site per rota week. Approving locks the week: a trigger
-- refuses any new or changed time entry whose clock-in falls in an approved week
-- at its site (before or after the change), so even a bug can't alter approved
-- times. Reopening needs a reason. Every approval and reopening is kept in
-- timesheet_event (append-only). No pay columns. No app-role DELETE anywhere.
--
-- Rollback (only while the new tables are empty; see the approval request):
--   DROP TRIGGER time_entry_week_lock ON time_entry;
--   DROP FUNCTION app.time_entry_week_lock();
--   DROP TABLE timesheet_event, timesheet;
--   DROP FUNCTION app.timesheet_event_immutable();
--   DELETE FROM role_permission WHERE permission_code IN ('attendance.approve', 'attendance.export');
--   DELETE FROM permission WHERE code IN ('attendance.approve', 'attendance.export');

CREATE TABLE "timesheet" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID NOT NULL,
    "site_id"     UUID NOT NULL,
    -- Monday of the rota week, in the site's time zone.
    "week_start"  DATE NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'open',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "timesheet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "timesheet_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "timesheet_monday" CHECK (EXTRACT(ISODOW FROM "week_start") = 1),
    CONSTRAINT "timesheet_status" CHECK (
      ("status" = 'open' AND "approved_by" IS NULL AND "approved_at" IS NULL)
      OR ("status" = 'approved' AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "timesheet_tenant_id_id_key" ON "timesheet" ("tenant_id", "id");
CREATE UNIQUE INDEX "timesheet_one_per_site_week" ON "timesheet" ("tenant_id", "site_id", "week_start");

-- Approvals and reopenings (append-only for every role) --------------------------------
CREATE TABLE "timesheet_event" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "timesheet_id"  UUID NOT NULL,
    "kind"          TEXT NOT NULL,
    -- Why it was reopened. Kept here, never in the audit trail.
    "reason"        TEXT,
    "actor_user_id" UUID NOT NULL,
    "occurred_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "timesheet_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "timesheet_event_timesheet_fkey" FOREIGN KEY ("tenant_id", "timesheet_id")
      REFERENCES "timesheet"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "timesheet_event_kind" CHECK (
      ("kind" = 'approved' AND "reason" IS NULL)
      OR ("kind" = 'reopened' AND char_length("reason") BETWEEN 1 AND 300))
);
CREATE UNIQUE INDEX "timesheet_event_tenant_id_id_key" ON "timesheet_event" ("tenant_id", "id");
CREATE INDEX "timesheet_event_timesheet" ON "timesheet_event" ("tenant_id", "timesheet_id", "occurred_at");

CREATE FUNCTION "app"."timesheet_event_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$ BEGIN RAISE EXCEPTION 'timesheet_event is append-only'; END $$;
REVOKE ALL ON FUNCTION "app"."timesheet_event_immutable"() FROM PUBLIC;
CREATE TRIGGER "timesheet_event_no_update" BEFORE UPDATE OR DELETE ON "timesheet_event"
  FOR EACH ROW EXECUTE FUNCTION "app"."timesheet_event_immutable"();

-- Approved weeks are locked ---------------------------------------------------------------
-- Runs with the caller's rights (so RLS still applies) and a fixed search_path.
CREATE FUNCTION "app"."time_entry_week_lock"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  tz text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT s."timezone" INTO tz FROM public."site" s
      WHERE s."tenant_id" = OLD."tenant_id" AND s."id" = OLD."site_id";
    IF EXISTS (
      SELECT 1 FROM public."timesheet" t
      WHERE t."tenant_id" = OLD."tenant_id" AND t."site_id" = OLD."site_id"
        AND t."status" = 'approved'
        AND t."week_start" = date_trunc('week', OLD."clock_in_at" AT TIME ZONE tz)::date
    ) THEN
      RAISE EXCEPTION 'time_entry_week_locked' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT s."timezone" INTO tz FROM public."site" s
    WHERE s."tenant_id" = NEW."tenant_id" AND s."id" = NEW."site_id";
  IF EXISTS (
    SELECT 1 FROM public."timesheet" t
    WHERE t."tenant_id" = NEW."tenant_id" AND t."site_id" = NEW."site_id"
      AND t."status" = 'approved'
      AND t."week_start" = date_trunc('week', NEW."clock_in_at" AT TIME ZONE tz)::date
  ) THEN
    RAISE EXCEPTION 'time_entry_week_locked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION "app"."time_entry_week_lock"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."time_entry_week_lock"() TO teamhappi_app;
CREATE TRIGGER "time_entry_week_lock" BEFORE INSERT OR UPDATE ON "time_entry"
  FOR EACH ROW EXECUTE FUNCTION "app"."time_entry_week_lock"();

-- Row-level security ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['timesheet', 'timesheet_event']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE. The site and week never change.
GRANT SELECT, INSERT ON "timesheet", "timesheet_event" TO teamhappi_app;
GRANT UPDATE ("status", "approved_by", "approved_at", "updated_at") ON "timesheet" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('attendance.approve', 'Approve and reopen weekly timesheets'),
  ('attendance.export', 'Export approved hours (no pay)');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'attendance.approve'), ('owner', 'attendance.export'),
  ('admin', 'attendance.approve'), ('admin', 'attendance.export'),
  ('hr_manager', 'attendance.approve'), ('hr_manager', 'attendance.export'),
  ('site_manager', 'attendance.approve')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
