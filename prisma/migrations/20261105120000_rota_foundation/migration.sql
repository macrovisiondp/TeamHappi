-- M10.1: rota foundation (docs/architecture/m10.1-rota-foundation.md; scope approved
-- in docs/architecture/m10-rota-scope.md, D1-D10).
--
-- Additive. No existing rows change except that three new permissions are added to
-- the permission catalogue and to every organisation's BUILT-IN roles (owner,
-- admin, hr_manager and site_manager: all three; site managers at their sites),
-- matching src/lib/permissions/catalogue.ts. Custom roles are not touched.
--
-- One rota week per site (Monday start, D1). Shifts belong to a week and its
-- site; times are timestamptz (the site's time zone is applied on the server).
-- A shift has at most one current assignment (one person) or none (open). Hours
-- only: there are no pay or cost columns (D6). Workers see nothing until a week
-- is published (D2, M10.2). Changes to a published week are kept in shift_change,
-- which is append-only. No app-role DELETE anywhere.
--
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE shift_change, shift_assignment, shift, rota_week;
--   DROP FUNCTION app.shift_change_immutable();
--   DELETE FROM role_permission WHERE permission_code LIKE 'rota.%';
--   DELETE FROM permission WHERE code LIKE 'rota.%';

-- Rota weeks ------------------------------------------------------------------------
CREATE TABLE "rota_week" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "site_id"      UUID NOT NULL,
    "week_start"   DATE NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "created_by"   UUID,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rota_week_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rota_week_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- Weeks start on Monday (ISO day 1).
    CONSTRAINT "rota_week_monday" CHECK (extract(isodow FROM "week_start") = 1),
    CONSTRAINT "rota_week_status" CHECK (
      ("status" = 'draft' AND "published_at" IS NULL AND "published_by" IS NULL)
      OR ("status" = 'published' AND "published_at" IS NOT NULL AND "published_by" IS NOT NULL))
);
CREATE UNIQUE INDEX "rota_week_tenant_id_id_key" ON "rota_week" ("tenant_id", "id");
-- Lets shifts prove they belong to the same site as their week.
CREATE UNIQUE INDEX "rota_week_tenant_id_id_site_id_key" ON "rota_week" ("tenant_id", "id", "site_id");
CREATE UNIQUE INDEX "rota_week_one_per_site_week" ON "rota_week" ("tenant_id", "site_id", "week_start");

-- Shifts ------------------------------------------------------------------------------
CREATE TABLE "shift" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "rota_week_id"  UUID NOT NULL,
    "site_id"       UUID NOT NULL,
    "team_id"       UUID,
    "role_label"    TEXT,
    "starts_at"     TIMESTAMPTZ NOT NULL,
    "ends_at"       TIMESTAMPTZ NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "note"          TEXT,
    "status"        TEXT NOT NULL DEFAULT 'active',
    "cancelled_at"  TIMESTAMPTZ,
    "cancelled_by"  UUID,
    "created_by"    UUID,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by"    UUID,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_week_fkey" FOREIGN KEY ("tenant_id", "rota_week_id", "site_id")
      REFERENCES "rota_week"("tenant_id", "id", "site_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_team_fkey" FOREIGN KEY ("tenant_id", "team_id")
      REFERENCES "team"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- A shift lasts more than nothing and at most 16 hours.
    CONSTRAINT "shift_times" CHECK ("ends_at" > "starts_at" AND "ends_at" - "starts_at" <= interval '16 hours'),
    CONSTRAINT "shift_break" CHECK ("break_minutes" BETWEEN 0 AND 240
      AND "break_minutes" * interval '1 minute' < "ends_at" - "starts_at"),
    CONSTRAINT "shift_role_label" CHECK ("role_label" IS NULL OR char_length("role_label") BETWEEN 1 AND 60),
    CONSTRAINT "shift_note" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500),
    CONSTRAINT "shift_status" CHECK (
      ("status" = 'active' AND "cancelled_at" IS NULL AND "cancelled_by" IS NULL)
      OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL))
);
CREATE UNIQUE INDEX "shift_tenant_id_id_key" ON "shift" ("tenant_id", "id");
CREATE INDEX "shift_week" ON "shift" ("tenant_id", "rota_week_id", "starts_at");
CREATE INDEX "shift_site_time" ON "shift" ("tenant_id", "site_id", "starts_at");

-- Assignments (one current person per shift; none = open) -----------------------------
CREATE TABLE "shift_assignment" (
    "id"              UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"       UUID NOT NULL,
    "shift_id"        UUID NOT NULL,
    "employee_id"     UUID NOT NULL,
    "assigned_by"     UUID NOT NULL,
    "assigned_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Why the manager went ahead despite warnings (D4/D5). Never copied to the audit trail.
    "override_reason" TEXT,
    "removed_at"      TIMESTAMPTZ,
    "removed_by"      UUID,
    CONSTRAINT "shift_assignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_assignment_shift_fkey" FOREIGN KEY ("tenant_id", "shift_id")
      REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_assignment_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_assignment_reason" CHECK ("override_reason" IS NULL OR char_length("override_reason") BETWEEN 1 AND 300),
    CONSTRAINT "shift_assignment_removed" CHECK (("removed_at" IS NULL) = ("removed_by" IS NULL))
);
CREATE UNIQUE INDEX "shift_assignment_tenant_id_id_key" ON "shift_assignment" ("tenant_id", "id");
CREATE UNIQUE INDEX "shift_assignment_one_current" ON "shift_assignment" ("tenant_id", "shift_id") WHERE "removed_at" IS NULL;
CREATE INDEX "shift_assignment_employee" ON "shift_assignment" ("tenant_id", "employee_id") WHERE "removed_at" IS NULL;

-- Changes to published weeks (append-only for every role) -----------------------------
CREATE TABLE "shift_change" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "shift_id"      UUID NOT NULL,
    "kind"          TEXT NOT NULL,
    -- Ids and times only (never notes or override reasons).
    "detail"        JSONB NOT NULL DEFAULT '{}'::jsonb,
    "actor_user_id" UUID,
    "occurred_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shift_change_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_change_shift_fkey" FOREIGN KEY ("tenant_id", "shift_id")
      REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shift_change_kind" CHECK ("kind" IN ('created', 'updated', 'cancelled', 'assigned', 'unassigned')),
    CONSTRAINT "shift_change_detail_object" CHECK (jsonb_typeof("detail") = 'object')
);
CREATE UNIQUE INDEX "shift_change_tenant_id_id_key" ON "shift_change" ("tenant_id", "id");
CREATE INDEX "shift_change_shift" ON "shift_change" ("tenant_id", "shift_id", "occurred_at");

CREATE FUNCTION "app"."shift_change_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$ BEGIN RAISE EXCEPTION 'shift_change is append-only'; END $$;
REVOKE ALL ON FUNCTION "app"."shift_change_immutable"() FROM PUBLIC;
CREATE TRIGGER "shift_change_no_update" BEFORE UPDATE OR DELETE ON "shift_change"
  FOR EACH ROW EXECUTE FUNCTION "app"."shift_change_immutable"();

-- Row-level security ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rota_week', 'shift', 'shift_assignment', 'shift_change']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT everywhere, column-level UPDATE, no DELETE.
GRANT SELECT, INSERT ON "rota_week", "shift", "shift_assignment", "shift_change" TO teamhappi_app;
GRANT UPDATE ("status", "published_at", "published_by", "updated_at") ON "rota_week" TO teamhappi_app;
-- The week and site of a shift never change.
GRANT UPDATE ("team_id", "role_label", "starts_at", "ends_at", "break_minutes", "note", "status",
              "cancelled_at", "cancelled_by", "updated_by", "updated_at")
  ON "shift" TO teamhappi_app;
GRANT UPDATE ("removed_at", "removed_by") ON "shift_assignment" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('rota.view', 'View rotas and shifts'),
  ('rota.manage', 'Create and change shifts and assign people'),
  ('rota.publish', 'Publish rotas so staff can see them');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'rota.view'), ('owner', 'rota.manage'), ('owner', 'rota.publish'),
  ('admin', 'rota.view'), ('admin', 'rota.manage'), ('admin', 'rota.publish'),
  ('hr_manager', 'rota.view'), ('hr_manager', 'rota.manage'), ('hr_manager', 'rota.publish'),
  ('site_manager', 'rota.view'), ('site_manager', 'rota.manage'), ('site_manager', 'rota.publish')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
