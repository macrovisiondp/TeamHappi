-- M8.1: training foundation (docs/architecture/m8.1-training-foundation.md).
--
-- Additive. No existing rows change except that three new permissions are
-- added to the permission catalogue and to every organisation's BUILT-IN roles
-- (owner, admin, hr_manager: all three; site_manager: view and record at their
-- sites), matching src/lib/permissions/catalogue.ts. Custom roles are not touched.
--
-- 1. "training_course": the organisation's course catalogue (internal or
--    external). In-house content is versioned; editing it bumps content_version.
-- 2. "training_requirement": RULES (organisation, site, job title or named
--    person). Who needs what is worked out from the rules when read, so joining,
--    job-title changes, site moves and rule changes apply immediately (no jobs).
-- 3. "training_record": completions. Append-only facts; a mistake is VOIDED
--    (once, with a reason; trigger) and optionally replaced by a new record.
--
-- No app-role DELETE anywhere. No files: certificates are metadata only (G7).
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE training_record, training_requirement, training_course;
--   DROP FUNCTION app.training_record_void_once();
--   DROP TYPE training_record_method, training_requirement_scope, training_completion_method, training_course_kind;
--   DELETE FROM role_permission WHERE permission_code LIKE 'training.%';
--   DELETE FROM permission WHERE code LIKE 'training.%';

CREATE TYPE "training_course_kind" AS ENUM ('internal', 'external');
CREATE TYPE "training_completion_method" AS ENUM ('read_and_confirm', 'in_person', 'external_certificate');
CREATE TYPE "training_requirement_scope" AS ENUM ('organisation', 'site', 'job_title', 'employee');
CREATE TYPE "training_record_method" AS ENUM ('read_and_confirm', 'in_person', 'external_certificate');

-- Courses ---------------------------------------------------------------------------
CREATE TABLE "training_course" (
    "id"                   UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"            UUID NOT NULL,
    "name"                 TEXT NOT NULL,
    "description"          TEXT,
    "category"             TEXT NOT NULL DEFAULT 'other',
    "kind"                 "training_course_kind" NOT NULL,
    "completion_method"    "training_completion_method" NOT NULL,
    "certificate_expected" BOOLEAN NOT NULL DEFAULT false,
    "validity_months"      INTEGER,
    "warn_days"            INTEGER NOT NULL DEFAULT 60,
    "content"              TEXT,
    "content_version"      INTEGER NOT NULL DEFAULT 1,
    "is_suggested"         BOOLEAN NOT NULL DEFAULT false,
    "archived_at"          TIMESTAMPTZ,
    "created_by"           UUID,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_course_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_course_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_course_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "training_course_description_length" CHECK ("description" IS NULL OR char_length("description") <= 1000),
    CONSTRAINT "training_course_content_length" CHECK ("content" IS NULL OR char_length("content") <= 20000),
    CONSTRAINT "training_course_category" CHECK ("category" IN
      ('food_safety', 'allergens', 'health_safety', 'fire_safety', 'first_aid', 'manual_handling',
       'licensing', 'safeguarding', 'equality', 'customer_service', 'other')),
    -- Internal courses are read-and-confirm or in person; external ones end in a certificate.
    CONSTRAINT "training_course_method_matches_kind" CHECK (
      ("kind" = 'internal' AND "completion_method" IN ('read_and_confirm', 'in_person'))
      OR ("kind" = 'external' AND "completion_method" = 'external_certificate')),
    CONSTRAINT "training_course_validity_range" CHECK ("validity_months" IS NULL OR "validity_months" BETWEEN 1 AND 120),
    CONSTRAINT "training_course_warn_range" CHECK ("warn_days" BETWEEN 0 AND 365),
    CONSTRAINT "training_course_version_positive" CHECK ("content_version" > 0)
);
CREATE UNIQUE INDEX "training_course_tenant_id_id_key" ON "training_course" ("tenant_id", "id");
CREATE UNIQUE INDEX "training_course_active_name" ON "training_course" ("tenant_id", lower("name")) WHERE "archived_at" IS NULL;

-- Requirement rules -------------------------------------------------------------------
CREATE TABLE "training_requirement" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID NOT NULL,
    "course_id"      UUID NOT NULL,
    "scope"          "training_requirement_scope" NOT NULL,
    "site_id"        UUID,
    "job_title"      TEXT,
    "employee_id"    UUID,
    "mandatory"      BOOLEAN NOT NULL DEFAULT true,
    "due_days"       INTEGER NOT NULL DEFAULT 0,
    -- Existing staff are due this many days after the rule starts, not after their (earlier) start date.
    "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
    "archived_at"    TIMESTAMPTZ,
    "created_by"     UUID,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_requirement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_requirement_course_fkey" FOREIGN KEY ("tenant_id", "course_id")
      REFERENCES "training_course"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_requirement_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_requirement_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_requirement_job_title_length" CHECK ("job_title" IS NULL OR char_length("job_title") BETWEEN 1 AND 120),
    CONSTRAINT "training_requirement_due_range" CHECK ("due_days" BETWEEN 0 AND 365),
    CONSTRAINT "training_requirement_scope_target" CHECK (
      ("scope" = 'organisation' AND "site_id" IS NULL AND "job_title" IS NULL AND "employee_id" IS NULL)
      OR ("scope" = 'site' AND "site_id" IS NOT NULL AND "job_title" IS NULL AND "employee_id" IS NULL)
      OR ("scope" = 'job_title' AND "site_id" IS NULL AND "job_title" IS NOT NULL AND "employee_id" IS NULL)
      OR ("scope" = 'employee' AND "site_id" IS NULL AND "job_title" IS NULL AND "employee_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "training_requirement_tenant_id_id_key" ON "training_requirement" ("tenant_id", "id");
-- One active rule per course and target (overlaps between DIFFERENT targets are resolved when read).
CREATE UNIQUE INDEX "training_requirement_one_active" ON "training_requirement"
  ("tenant_id", "course_id", "scope", COALESCE("site_id"::text, "employee_id"::text, lower("job_title"), ''))
  WHERE "archived_at" IS NULL;
CREATE INDEX "training_requirement_course" ON "training_requirement" ("tenant_id", "course_id");

-- Completion records (append-only facts, void once) ------------------------------------
CREATE TABLE "training_record" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID NOT NULL,
    "employee_id"    UUID NOT NULL,
    "course_id"      UUID NOT NULL,
    "course_version" INTEGER NOT NULL,
    "method"         "training_record_method" NOT NULL,
    "completed_on"   DATE NOT NULL,
    "expires_on"     DATE,
    "provider"       TEXT,
    "reference"      TEXT,
    "self_completed" BOOLEAN NOT NULL DEFAULT false,
    "replaces_id"    UUID,
    "recorded_by"    UUID NOT NULL,
    "recorded_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at"      TIMESTAMPTZ,
    "voided_by"      UUID,
    "void_reason"    TEXT,
    CONSTRAINT "training_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_record_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_record_course_fkey" FOREIGN KEY ("tenant_id", "course_id")
      REFERENCES "training_course"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_record_provider_length" CHECK ("provider" IS NULL OR char_length("provider") BETWEEN 1 AND 120),
    CONSTRAINT "training_record_reference_length" CHECK ("reference" IS NULL OR char_length("reference") BETWEEN 1 AND 80),
    CONSTRAINT "training_record_expiry_after_completion" CHECK ("expires_on" IS NULL OR "expires_on" >= "completed_on"),
    CONSTRAINT "training_record_version_positive" CHECK ("course_version" > 0),
    -- A void always records who, when and why.
    CONSTRAINT "training_record_void_consistent" CHECK (
      ("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND char_length("void_reason") BETWEEN 3 AND 500))
);
CREATE UNIQUE INDEX "training_record_tenant_id_id_key" ON "training_record" ("tenant_id", "id");
CREATE UNIQUE INDEX "training_record_tenant_employee_id_key" ON "training_record" ("tenant_id", "employee_id", "id");
-- A correction replaces an earlier record of the SAME person.
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_replaces_fkey"
  FOREIGN KEY ("tenant_id", "employee_id", "replaces_id")
  REFERENCES "training_record"("tenant_id", "employee_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "training_record_employee_course" ON "training_record" ("tenant_id", "employee_id", "course_id");
CREATE INDEX "training_record_expiry" ON "training_record" ("tenant_id", "expires_on") WHERE "expires_on" IS NOT NULL AND "voided_at" IS NULL;

-- A record's facts never change (column grants), and a void happens once (any role).
CREATE FUNCTION "app"."training_record_void_once"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'training_record is append-only';
    END IF;
    IF OLD."voided_at" IS NOT NULL THEN
      RAISE EXCEPTION 'training_record: a voided record can''t change';
    END IF;
    IF (NEW."employee_id", NEW."course_id", NEW."course_version", NEW."method", NEW."completed_on",
        NEW."expires_on", NEW."provider", NEW."reference", NEW."self_completed", NEW."replaces_id",
        NEW."recorded_by", NEW."recorded_at", NEW."tenant_id", NEW."id")
       IS DISTINCT FROM
       (OLD."employee_id", OLD."course_id", OLD."course_version", OLD."method", OLD."completed_on",
        OLD."expires_on", OLD."provider", OLD."reference", OLD."self_completed", OLD."replaces_id",
        OLD."recorded_by", OLD."recorded_at", OLD."tenant_id", OLD."id") THEN
      RAISE EXCEPTION 'training_record: only a void can change a record';
    END IF;
    RETURN NEW;
  END $$;
REVOKE ALL ON FUNCTION "app"."training_record_void_once"() FROM PUBLIC;
CREATE TRIGGER "training_record_void_once" BEFORE UPDATE OR DELETE ON "training_record"
  FOR EACH ROW EXECUTE FUNCTION "app"."training_record_void_once"();

-- Row-level security: one tenant policy per table.
ALTER TABLE "training_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "training_course" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

ALTER TABLE "training_requirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_requirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "training_requirement" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

ALTER TABLE "training_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "training_record" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE.
GRANT SELECT, INSERT ON "training_course", "training_requirement", "training_record" TO teamhappi_app;
-- A course's type and completion method are fixed once created (records depend on them).
GRANT UPDATE ("name", "description", "category", "certificate_expected", "validity_months", "warn_days",
              "content", "content_version", "archived_at", "updated_at")
  ON "training_course" TO teamhappi_app;
-- A rule's course and target are fixed; change them by archiving and adding a new rule.
GRANT UPDATE ("mandatory", "due_days", "archived_at", "updated_at")
  ON "training_requirement" TO teamhappi_app;
-- Records: only the void columns.
GRANT UPDATE ("voided_at", "voided_by", "void_reason") ON "training_record" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('training.view', 'View training requirements, status and records'),
  ('training.record', 'Record and correct training completions'),
  ('training.manage', 'Manage training courses and requirement rules');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'training.view'), ('owner', 'training.record'), ('owner', 'training.manage'),
  ('admin', 'training.view'), ('admin', 'training.record'), ('admin', 'training.manage'),
  ('hr_manager', 'training.view'), ('hr_manager', 'training.record'), ('hr_manager', 'training.manage'),
  ('site_manager', 'training.view'), ('site_manager', 'training.record')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
