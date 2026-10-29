-- M9.1: recruitment foundation (docs/architecture/m9.1-recruitment-foundation.md).
--
-- Additive. No existing rows change except that four new permissions are
-- added to the permission catalogue and to every organisation's BUILT-IN roles
-- (owner, admin, hr_manager: all four; recruiter and site_manager: view and
-- manage, site managers at their sites), matching src/lib/permissions/catalogue.ts.
-- Custom roles are not touched.
--
-- Candidates are people; applications are a candidate applying to a vacancy.
-- Candidates are never merged automatically (decision D1). The pipeline uses
-- eight fixed system stages with renamable labels (D2). "Hire" links one
-- employee record to one application (unique), so retries can't duplicate.
-- Stage history is append-only (trigger). Notes are append-only; only
-- anonymisation may blank a note's body (trigger). Candidate data is
-- anonymised, never deleted, by the app. No app-role DELETE anywhere.
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE interview_interviewer, interview, application_note, application_event,
--              application, candidate, vacancy, recruitment_settings;
--   DROP FUNCTION app.application_event_immutable(), app.application_note_redact_only();
--   DROP TYPE (the eleven recruitment types below);
--   DELETE FROM role_permission WHERE permission_code LIKE 'recruitment.%';
--   DELETE FROM permission WHERE code LIKE 'recruitment.%';

CREATE TYPE "vacancy_status" AS ENUM ('draft', 'open', 'paused', 'filled', 'closed');
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'casual', 'fixed_term', 'seasonal');
CREATE TYPE "pay_period" AS ENUM ('hour', 'year');
CREATE TYPE "candidate_source" AS ENUM ('manual', 'referral', 'agency', 'careers_page');
CREATE TYPE "application_stage" AS ENUM
  ('applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn');
CREATE TYPE "application_outcome" AS ENUM ('active', 'hired', 'rejected', 'withdrawn');
CREATE TYPE "rejection_reason" AS ENUM ('not_suitable', 'role_filled', 'no_response', 'other');
CREATE TYPE "interview_format" AS ENUM ('in_person', 'phone', 'video');
CREATE TYPE "interview_status" AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE "interview_outcome" AS ENUM ('progress', 'hold', 'do_not_progress');

-- Settings (one row per organisation) ---------------------------------------------
CREATE TABLE "recruitment_settings" (
    "id"               UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"        UUID NOT NULL,
    -- Renamed labels for the five working stages, e.g. {"screening": "Phone screen"}.
    "stage_labels"     JSONB NOT NULL DEFAULT '{}',
    "retention_months" INTEGER NOT NULL DEFAULT 6,
    "updated_by"       UUID,
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recruitment_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recruitment_settings_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "recruitment_settings_labels_object" CHECK (jsonb_typeof("stage_labels") = 'object'),
    CONSTRAINT "recruitment_settings_retention_range" CHECK ("retention_months" BETWEEN 3 AND 12)
);
CREATE UNIQUE INDEX "recruitment_settings_tenant_id_id_key" ON "recruitment_settings" ("tenant_id", "id");
CREATE UNIQUE INDEX "recruitment_settings_one_per_tenant" ON "recruitment_settings" ("tenant_id");

-- Vacancies -------------------------------------------------------------------------
CREATE TABLE "vacancy" (
    "id"                           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"                    UUID NOT NULL,
    "title"                        TEXT NOT NULL,
    "job_title"                    TEXT NOT NULL,
    "site_id"                      UUID NOT NULL,
    "team_id"                      UUID,
    "employment_type"              "employment_type" NOT NULL,
    "description"                  TEXT,
    "openings"                     INTEGER NOT NULL DEFAULT 1,
    "status"                       "vacancy_status" NOT NULL DEFAULT 'draft',
    "closes_on"                    DATE,
    "hiring_manager_membership_id" UUID,
    "pay_min"                      NUMERIC(10, 2),
    "pay_max"                      NUMERIC(10, 2),
    "pay_period"                   "pay_period",
    "created_by"                   UUID,
    "created_at"                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vacancy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vacancy_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "vacancy_team_fkey" FOREIGN KEY ("tenant_id", "team_id")
      REFERENCES "team"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "vacancy_hiring_manager_fkey" FOREIGN KEY ("tenant_id", "hiring_manager_membership_id")
      REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "vacancy_title_length" CHECK (char_length("title") BETWEEN 1 AND 120),
    CONSTRAINT "vacancy_job_title_length" CHECK (char_length("job_title") BETWEEN 1 AND 120),
    CONSTRAINT "vacancy_description_length" CHECK ("description" IS NULL OR char_length("description") <= 5000),
    CONSTRAINT "vacancy_openings_range" CHECK ("openings" BETWEEN 1 AND 100),
    -- Pay is optional; when given it's a non-negative range with a period.
    CONSTRAINT "vacancy_pay_consistent" CHECK (
      ("pay_min" IS NULL AND "pay_max" IS NULL AND "pay_period" IS NULL)
      OR ("pay_period" IS NOT NULL AND "pay_min" IS NOT NULL AND "pay_min" >= 0
          AND ("pay_max" IS NULL OR "pay_max" >= "pay_min")))
);
CREATE UNIQUE INDEX "vacancy_tenant_id_id_key" ON "vacancy" ("tenant_id", "id");
CREATE INDEX "vacancy_tenant_status" ON "vacancy" ("tenant_id", "status", "site_id");

-- Candidates (people) --------------------------------------------------------------
CREATE TABLE "candidate" (
    "id"                  UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID NOT NULL,
    "given_name"          TEXT NOT NULL,
    "family_name"         TEXT NOT NULL,
    "email"               TEXT,
    "phone"               TEXT,
    "source"              "candidate_source" NOT NULL DEFAULT 'manual',
    "anonymised_at"       TIMESTAMPTZ,
    "created_by"          UUID,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "candidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "candidate_name_length" CHECK (char_length("given_name") BETWEEN 1 AND 100 AND char_length("family_name") BETWEEN 1 AND 100),
    CONSTRAINT "candidate_email_format" CHECK ("email" IS NULL OR ("email" = lower("email") AND "email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length("email") <= 254)),
    CONSTRAINT "candidate_phone_length" CHECK ("phone" IS NULL OR char_length("phone") BETWEEN 5 AND 30),
    -- Anonymised candidates hold no contact details.
    CONSTRAINT "candidate_anonymised_blank" CHECK ("anonymised_at" IS NULL OR ("email" IS NULL AND "phone" IS NULL))
);
CREATE UNIQUE INDEX "candidate_tenant_id_id_key" ON "candidate" ("tenant_id", "id");
-- For "possible match" suggestions only: NOT unique (no automatic merging).
CREATE INDEX "candidate_email" ON "candidate" ("tenant_id", "email") WHERE "email" IS NOT NULL;

-- Applications ---------------------------------------------------------------------
CREATE TABLE "application" (
    "id"                UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"         UUID NOT NULL,
    "candidate_id"      UUID NOT NULL,
    "vacancy_id"        UUID NOT NULL,
    "stage"             "application_stage" NOT NULL DEFAULT 'applied',
    "outcome"           "application_outcome" NOT NULL DEFAULT 'active',
    "applied_on"        DATE NOT NULL DEFAULT CURRENT_DATE,
    "rejection_reason"  "rejection_reason",
    "closed_at"         TIMESTAMPTZ,
    "hired_employee_id" UUID,
    "hired_at"          TIMESTAMPTZ,
    "hired_by"          UUID,
    "created_by"        UUID,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_candidate_fkey" FOREIGN KEY ("tenant_id", "candidate_id")
      REFERENCES "candidate"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "application_vacancy_fkey" FOREIGN KEY ("tenant_id", "vacancy_id")
      REFERENCES "vacancy"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "application_employee_fkey" FOREIGN KEY ("tenant_id", "hired_employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- The stage and the outcome always agree; end stages record what they need.
    CONSTRAINT "application_state_consistent" CHECK (
      ("outcome" = 'active' AND "stage" IN ('applied', 'screening', 'shortlisted', 'interview', 'offer')
        AND "closed_at" IS NULL AND "rejection_reason" IS NULL AND "hired_employee_id" IS NULL)
      OR ("outcome" = 'hired' AND "stage" = 'hired' AND "closed_at" IS NOT NULL AND "rejection_reason" IS NULL
        AND "hired_employee_id" IS NOT NULL AND "hired_at" IS NOT NULL AND "hired_by" IS NOT NULL)
      OR ("outcome" = 'rejected' AND "stage" = 'rejected' AND "closed_at" IS NOT NULL
        AND "rejection_reason" IS NOT NULL AND "hired_employee_id" IS NULL)
      OR ("outcome" = 'withdrawn' AND "stage" = 'withdrawn' AND "closed_at" IS NOT NULL
        AND "rejection_reason" IS NULL AND "hired_employee_id" IS NULL))
);
CREATE UNIQUE INDEX "application_tenant_id_id_key" ON "application" ("tenant_id", "id");
-- One application per candidate per vacancy; one application per hired employee.
CREATE UNIQUE INDEX "application_one_per_vacancy" ON "application" ("tenant_id", "candidate_id", "vacancy_id");
CREATE UNIQUE INDEX "application_one_hire" ON "application" ("tenant_id", "hired_employee_id") WHERE "hired_employee_id" IS NOT NULL;
CREATE INDEX "application_vacancy" ON "application" ("tenant_id", "vacancy_id", "stage");

-- Stage history (append-only for every role) -------------------------------------------
CREATE TABLE "application_event" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_stage"     "application_stage",
    "to_stage"       "application_stage" NOT NULL,
    "actor_user_id"  UUID,
    "occurred_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_event_application_fkey" FOREIGN KEY ("tenant_id", "application_id")
      REFERENCES "application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "application_event_tenant_id_id_key" ON "application_event" ("tenant_id", "id");
CREATE INDEX "application_event_application" ON "application_event" ("tenant_id", "application_id", "occurred_at");

CREATE FUNCTION "app"."application_event_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$ BEGIN RAISE EXCEPTION 'application_event is append-only'; END $$;
REVOKE ALL ON FUNCTION "app"."application_event_immutable"() FROM PUBLIC;
CREATE TRIGGER "application_event_no_update" BEFORE UPDATE OR DELETE ON "application_event"
  FOR EACH ROW EXECUTE FUNCTION "app"."application_event_immutable"();

-- Notes (append-only; only anonymisation may blank the body) -----------------------------
CREATE TABLE "application_note" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body"           TEXT,
    "redacted_at"    TIMESTAMPTZ,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_note_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_note_application_fkey" FOREIGN KEY ("tenant_id", "application_id")
      REFERENCES "application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "application_note_body" CHECK (
      ("redacted_at" IS NULL AND char_length("body") BETWEEN 1 AND 2000)
      OR ("redacted_at" IS NOT NULL AND "body" IS NULL))
);
CREATE UNIQUE INDEX "application_note_tenant_id_id_key" ON "application_note" ("tenant_id", "id");
CREATE INDEX "application_note_application" ON "application_note" ("tenant_id", "application_id", "created_at");

CREATE FUNCTION "app"."application_note_redact_only"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'application_note is append-only'; END IF;
    IF OLD."redacted_at" IS NOT NULL OR NEW."redacted_at" IS NULL OR NEW."body" IS NOT NULL
       OR (NEW."application_id", NEW."author_user_id", NEW."created_at", NEW."tenant_id", NEW."id")
          IS DISTINCT FROM (OLD."application_id", OLD."author_user_id", OLD."created_at", OLD."tenant_id", OLD."id") THEN
      RAISE EXCEPTION 'application_note: a note can only be redacted (once)';
    END IF;
    RETURN NEW;
  END $$;
REVOKE ALL ON FUNCTION "app"."application_note_redact_only"() FROM PUBLIC;
CREATE TRIGGER "application_note_redact_only" BEFORE UPDATE OR DELETE ON "application_note"
  FOR EACH ROW EXECUTE FUNCTION "app"."application_note_redact_only"();

-- Interviews ---------------------------------------------------------------------------
CREATE TABLE "interview" (
    "id"               UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"        UUID NOT NULL,
    "application_id"   UUID NOT NULL,
    "scheduled_at"     TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "format"           "interview_format" NOT NULL DEFAULT 'in_person',
    "location"         TEXT,
    "status"           "interview_status" NOT NULL DEFAULT 'scheduled',
    "outcome"          "interview_outcome",
    "feedback"         TEXT,
    "feedback_by"      UUID,
    "feedback_at"      TIMESTAMPTZ,
    "created_by"       UUID,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interview_application_fkey" FOREIGN KEY ("tenant_id", "application_id")
      REFERENCES "application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "interview_duration_range" CHECK ("duration_minutes" BETWEEN 5 AND 480),
    CONSTRAINT "interview_location_length" CHECK ("location" IS NULL OR char_length("location") <= 200),
    CONSTRAINT "interview_feedback_length" CHECK ("feedback" IS NULL OR char_length("feedback") <= 4000),
    -- An outcome belongs to a completed interview, with who and when.
    CONSTRAINT "interview_outcome_consistent" CHECK (
      ("outcome" IS NULL OR ("status" = 'completed' AND "feedback_by" IS NOT NULL AND "feedback_at" IS NOT NULL)))
);
CREATE UNIQUE INDEX "interview_tenant_id_id_key" ON "interview" ("tenant_id", "id");
CREATE INDEX "interview_schedule" ON "interview" ("tenant_id", "scheduled_at");
CREATE INDEX "interview_application" ON "interview" ("tenant_id", "application_id");

CREATE TABLE "interview_interviewer" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "interview_id"  UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "removed_at"    TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interview_interviewer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interview_interviewer_interview_fkey" FOREIGN KEY ("tenant_id", "interview_id")
      REFERENCES "interview"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "interview_interviewer_membership_fkey" FOREIGN KEY ("tenant_id", "membership_id")
      REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "interview_interviewer_tenant_id_id_key" ON "interview_interviewer" ("tenant_id", "id");
CREATE UNIQUE INDEX "interview_interviewer_once" ON "interview_interviewer" ("tenant_id", "interview_id", "membership_id") WHERE "removed_at" IS NULL;
CREATE INDEX "interview_interviewer_member" ON "interview_interviewer" ("tenant_id", "membership_id") WHERE "removed_at" IS NULL;

-- Row-level security: one tenant policy per table -----------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recruitment_settings', 'vacancy', 'candidate', 'application',
                           'application_event', 'application_note', 'interview', 'interview_interviewer']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT everywhere, column-level UPDATE, no DELETE.
GRANT SELECT, INSERT ON "recruitment_settings", "vacancy", "candidate", "application",
  "application_event", "application_note", "interview", "interview_interviewer" TO teamhappi_app;
GRANT UPDATE ("stage_labels", "retention_months", "updated_by", "updated_at") ON "recruitment_settings" TO teamhappi_app;
GRANT UPDATE ("title", "job_title", "site_id", "team_id", "employment_type", "description", "openings", "status",
              "closes_on", "hiring_manager_membership_id", "pay_min", "pay_max", "pay_period", "updated_at")
  ON "vacancy" TO teamhappi_app;
-- Contact details can be corrected or anonymised; the source and creator never change.
GRANT UPDATE ("given_name", "family_name", "email", "phone", "anonymised_at", "updated_at") ON "candidate" TO teamhappi_app;
-- The candidate and vacancy of an application never change.
GRANT UPDATE ("stage", "outcome", "rejection_reason", "closed_at", "hired_employee_id", "hired_at", "hired_by", "updated_at")
  ON "application" TO teamhappi_app;
GRANT UPDATE ("body", "redacted_at") ON "application_note" TO teamhappi_app;
GRANT UPDATE ("scheduled_at", "duration_minutes", "format", "location", "status", "outcome", "feedback",
              "feedback_by", "feedback_at", "updated_at")
  ON "interview" TO teamhappi_app;
GRANT UPDATE ("removed_at") ON "interview_interviewer" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('recruitment.view', 'View vacancies, candidates and applications'),
  ('recruitment.manage', 'Manage vacancies, the pipeline, notes and interviews'),
  ('recruitment.hire', 'Hire candidates (creates employee records)'),
  ('recruitment.settings', 'Manage recruitment settings and candidate data retention');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'recruitment.view'), ('owner', 'recruitment.manage'), ('owner', 'recruitment.hire'), ('owner', 'recruitment.settings'),
  ('admin', 'recruitment.view'), ('admin', 'recruitment.manage'), ('admin', 'recruitment.hire'), ('admin', 'recruitment.settings'),
  ('hr_manager', 'recruitment.view'), ('hr_manager', 'recruitment.manage'), ('hr_manager', 'recruitment.hire'), ('hr_manager', 'recruitment.settings'),
  ('recruiter', 'recruitment.view'), ('recruiter', 'recruitment.manage'),
  ('site_manager', 'recruitment.view'), ('site_manager', 'recruitment.manage')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
