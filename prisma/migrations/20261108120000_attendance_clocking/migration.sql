-- M11.1: clocking (docs/architecture/m11.1-clocking.md; scope in
-- docs/architecture/m11-attendance-scope.md, approved 19 November 2026).
--
-- Additive. No existing rows change except that two new permissions are added to
-- the permission catalogue and to every organisation's BUILT-IN roles (owner,
-- admin, hr_manager, site_manager), matching src/lib/permissions/catalogue.ts.
-- Custom roles are not touched. One unique index is added to "shift" so a time
-- entry's shift is always at the entry's site.
--
-- Staff with a linked login clock in and out (server time only) and record
-- breaks; managers record, correct and remove entries with a reason. Real times
-- are stored and never rounded (D4); flags are worked out when shown. No pay
-- columns. Every change is kept in time_entry_change (append-only). No app-role
-- DELETE anywhere.
--
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE time_entry_change, time_break, time_entry, attendance_settings;
--   DROP FUNCTION app.time_entry_change_immutable();
--   DROP INDEX shift_tenant_id_id_site_id_key;
--   DELETE FROM role_permission WHERE permission_code LIKE 'attendance.%';
--   DELETE FROM permission WHERE code LIKE 'attendance.%';

-- A shift's site, for composite keys ------------------------------------------------------
CREATE UNIQUE INDEX "shift_tenant_id_id_site_id_key" ON "shift" ("tenant_id", "id", "site_id");

-- Flag limits per organisation (D5, D7) -------------------------------------------------
CREATE TABLE "attendance_settings" (
    "id"                    UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"             UUID NOT NULL,
    "tolerance_minutes"     SMALLINT NOT NULL DEFAULT 10,
    "missed_clock_out_hours" SMALLINT NOT NULL DEFAULT 2,
    "updated_by"            UUID,
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_settings_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "attendance_settings_tolerance" CHECK ("tolerance_minutes" BETWEEN 0 AND 60),
    CONSTRAINT "attendance_settings_missed" CHECK ("missed_clock_out_hours" BETWEEN 1 AND 12)
);
CREATE UNIQUE INDEX "attendance_settings_one_per_tenant" ON "attendance_settings" ("tenant_id");
CREATE UNIQUE INDEX "attendance_settings_tenant_id_id_key" ON "attendance_settings" ("tenant_id", "id");

-- Clocked time ----------------------------------------------------------------------------
CREATE TABLE "time_entry" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "employee_id"  UUID NOT NULL,
    "site_id"      UUID NOT NULL,
    -- The published shift it was matched to; empty = no shift (flagged, D3).
    "shift_id"     UUID,
    "clock_in_at"  TIMESTAMPTZ NOT NULL,
    -- Empty while clocked in.
    "clock_out_at" TIMESTAMPTZ,
    -- self = the person clocked; manager = recorded for them.
    "source"       TEXT NOT NULL,
    "created_by"   UUID NOT NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by"   UUID,
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Made in error: kept, never deleted.
    "removed_at"   TIMESTAMPTZ,
    "removed_by"   UUID,
    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "time_entry_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "time_entry_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "time_entry_shift_fkey" FOREIGN KEY ("tenant_id", "shift_id", "site_id")
      REFERENCES "shift"("tenant_id", "id", "site_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "time_entry_source" CHECK ("source" IN ('self', 'manager')),
    CONSTRAINT "time_entry_times" CHECK (
      "clock_out_at" IS NULL
      OR ("clock_out_at" > "clock_in_at" AND "clock_out_at" - "clock_in_at" <= INTERVAL '24 hours')),
    CONSTRAINT "time_entry_removed" CHECK (("removed_at" IS NULL) = ("removed_by" IS NULL))
);
CREATE UNIQUE INDEX "time_entry_tenant_id_id_key" ON "time_entry" ("tenant_id", "id");
-- Nobody can be clocked in twice.
CREATE UNIQUE INDEX "time_entry_one_open" ON "time_entry" ("tenant_id", "employee_id")
  WHERE "clock_out_at" IS NULL AND "removed_at" IS NULL;
CREATE INDEX "time_entry_site_time" ON "time_entry" ("tenant_id", "site_id", "clock_in_at");
CREATE INDEX "time_entry_employee_time" ON "time_entry" ("tenant_id", "employee_id", "clock_in_at");
CREATE INDEX "time_entry_shift" ON "time_entry" ("tenant_id", "shift_id") WHERE "shift_id" IS NOT NULL;

-- Breaks ----------------------------------------------------------------------------------
CREATE TABLE "time_break" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "time_entry_id" UUID NOT NULL,
    "starts_at"     TIMESTAMPTZ NOT NULL,
    -- Empty while on break.
    "ends_at"       TIMESTAMPTZ,
    CONSTRAINT "time_break_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "time_break_entry_fkey" FOREIGN KEY ("tenant_id", "time_entry_id")
      REFERENCES "time_entry"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "time_break_times" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at")
);
CREATE UNIQUE INDEX "time_break_tenant_id_id_key" ON "time_break" ("tenant_id", "id");
CREATE UNIQUE INDEX "time_break_one_open" ON "time_break" ("tenant_id", "time_entry_id")
  WHERE "ends_at" IS NULL;
CREATE INDEX "time_break_entry" ON "time_break" ("tenant_id", "time_entry_id");

-- History of records, corrections and removals (append-only for every role) ---------------
CREATE TABLE "time_entry_change" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID NOT NULL,
    "time_entry_id"  UUID NOT NULL,
    "kind"           TEXT NOT NULL,
    "old_clock_in"   TIMESTAMPTZ,
    "old_clock_out"  TIMESTAMPTZ,
    "new_clock_in"   TIMESTAMPTZ,
    "new_clock_out"  TIMESTAMPTZ,
    -- Why a manager recorded, corrected or removed it. Kept here, never in the audit trail.
    "reason"         TEXT NOT NULL,
    "actor_user_id"  UUID NOT NULL,
    "occurred_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "time_entry_change_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "time_entry_change_entry_fkey" FOREIGN KEY ("tenant_id", "time_entry_id")
      REFERENCES "time_entry"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "time_entry_change_kind" CHECK ("kind" IN ('recorded', 'corrected', 'removed')),
    CONSTRAINT "time_entry_change_reason" CHECK (char_length("reason") BETWEEN 1 AND 300)
);
CREATE UNIQUE INDEX "time_entry_change_tenant_id_id_key" ON "time_entry_change" ("tenant_id", "id");
CREATE INDEX "time_entry_change_entry" ON "time_entry_change" ("tenant_id", "time_entry_id", "occurred_at");

CREATE FUNCTION "app"."time_entry_change_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$ BEGIN RAISE EXCEPTION 'time_entry_change is append-only'; END $$;
REVOKE ALL ON FUNCTION "app"."time_entry_change_immutable"() FROM PUBLIC;
CREATE TRIGGER "time_entry_change_no_update" BEFORE UPDATE OR DELETE ON "time_entry_change"
  FOR EACH ROW EXECUTE FUNCTION "app"."time_entry_change_immutable"();

-- Row-level security ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_settings', 'time_entry', 'time_break', 'time_entry_change']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE. Who, where and how an
-- entry was made never change; nor does the entry a break belongs to.
GRANT SELECT, INSERT ON "attendance_settings", "time_entry", "time_break", "time_entry_change"
  TO teamhappi_app;
GRANT UPDATE ("tolerance_minutes", "missed_clock_out_hours", "updated_by", "updated_at")
  ON "attendance_settings" TO teamhappi_app;
GRANT UPDATE ("shift_id", "clock_in_at", "clock_out_at", "updated_by", "updated_at",
              "removed_at", "removed_by")
  ON "time_entry" TO teamhappi_app;
GRANT UPDATE ("ends_at") ON "time_break" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('attendance.view', 'View who''s in and clocked times'),
  ('attendance.manage', 'Record and correct clocked times');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'attendance.view'), ('owner', 'attendance.manage'),
  ('admin', 'attendance.view'), ('admin', 'attendance.manage'),
  ('hr_manager', 'attendance.view'), ('hr_manager', 'attendance.manage'),
  ('site_manager', 'attendance.view'), ('site_manager', 'attendance.manage')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
