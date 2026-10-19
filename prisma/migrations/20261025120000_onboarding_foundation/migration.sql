-- M7.1: onboarding foundation (docs/architecture/m7.1-onboarding-foundation.md).
--
-- Additive. No existing rows change except that four new permissions are
-- added to the permission catalogue and to every organisation's BUILT-IN roles
-- (owner, admin, hr_manager, site_manager), matching
-- src/lib/permissions/catalogue.ts. Custom roles are not touched.
--
-- Onboarding belongs to the EMPLOYEE RECORD (no login needed). Templates are
-- copied into each case ("snapshot"), so editing a template never changes
-- onboarding already under way. Right-to-work is NOT part of this migration
-- (M7.2) and nothing here records or implies legal clearance.
--
-- No app-role DELETE anywhere: templates and tasks are archived, cases are
-- cancelled or signed off. UPDATE is column-level.
-- Rollback (only while the tables are empty; see the approval request):
--   DROP TABLE onboarding_task, onboarding_case, onboarding_template_task, onboarding_template;
--   DROP TYPE onboarding_task_status, onboarding_case_status, onboarding_owner_kind,
--             onboarding_task_category, onboarding_template_scope;
--   DELETE FROM role_permission WHERE permission_code LIKE 'onboarding.%';
--   DELETE FROM permission WHERE code LIKE 'onboarding.%';

CREATE TYPE "onboarding_template_scope" AS ENUM ('organisation', 'site', 'job_title');
CREATE TYPE "onboarding_task_category" AS ENUM ('task', 'document', 'induction', 'policy');
CREATE TYPE "onboarding_owner_kind" AS ENUM ('manager', 'hr', 'employee');
CREATE TYPE "onboarding_case_status" AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE "onboarding_task_status" AS ENUM ('to_do', 'done', 'waived');

-- Templates ---------------------------------------------------------------------
CREATE TABLE "onboarding_template" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "name"         TEXT NOT NULL,
    "description"  TEXT,
    "scope"        "onboarding_template_scope" NOT NULL DEFAULT 'organisation',
    "site_id"      UUID,
    "job_title"    TEXT,
    "is_suggested" BOOLEAN NOT NULL DEFAULT false,
    "version"      INTEGER NOT NULL DEFAULT 1,
    "archived_at"  TIMESTAMPTZ,
    "created_by"   UUID,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_template_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_template_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_template_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_template_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "onboarding_template_description_length" CHECK ("description" IS NULL OR char_length("description") <= 1000),
    CONSTRAINT "onboarding_template_job_title_length" CHECK ("job_title" IS NULL OR char_length("job_title") BETWEEN 1 AND 120),
    CONSTRAINT "onboarding_template_version_positive" CHECK ("version" > 0),
    CONSTRAINT "onboarding_template_scope_target" CHECK (
      ("scope" = 'organisation' AND "site_id" IS NULL AND "job_title" IS NULL)
      OR ("scope" = 'site' AND "site_id" IS NOT NULL AND "job_title" IS NULL)
      OR ("scope" = 'job_title' AND "site_id" IS NULL AND "job_title" IS NOT NULL))
);
CREATE UNIQUE INDEX "onboarding_template_tenant_id_id_key" ON "onboarding_template" ("tenant_id", "id");
CREATE UNIQUE INDEX "onboarding_template_active_name" ON "onboarding_template" ("tenant_id", lower("name")) WHERE "archived_at" IS NULL;

CREATE TABLE "onboarding_template_task" (
    "id"              UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"       UUID NOT NULL,
    "template_id"     UUID NOT NULL,
    "title"           TEXT NOT NULL,
    "guidance"        TEXT,
    "category"        "onboarding_task_category" NOT NULL DEFAULT 'task',
    "owner_kind"      "onboarding_owner_kind" NOT NULL DEFAULT 'manager',
    "due_offset_days" INTEGER NOT NULL DEFAULT 0,
    "required"        BOOLEAN NOT NULL DEFAULT true,
    "sort_order"      INTEGER NOT NULL DEFAULT 0,
    "archived_at"     TIMESTAMPTZ,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_template_task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_template_task_template_fkey" FOREIGN KEY ("tenant_id", "template_id")
      REFERENCES "onboarding_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_template_task_title_length" CHECK (char_length("title") BETWEEN 1 AND 160),
    CONSTRAINT "onboarding_template_task_guidance_length" CHECK ("guidance" IS NULL OR char_length("guidance") <= 2000),
    CONSTRAINT "onboarding_template_task_offset_range" CHECK ("due_offset_days" BETWEEN -90 AND 365)
);
CREATE UNIQUE INDEX "onboarding_template_task_tenant_id_id_key" ON "onboarding_template_task" ("tenant_id", "id");
CREATE INDEX "onboarding_template_task_template" ON "onboarding_template_task" ("tenant_id", "template_id");

-- Cases (one open case per employee) ---------------------------------------------
CREATE TABLE "onboarding_case" (
    "id"                  UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID NOT NULL,
    "employee_id"         UUID NOT NULL,
    "template_id"         UUID NOT NULL,
    "template_version"    INTEGER NOT NULL,
    "template_name"       TEXT NOT NULL,
    "site_id"             UUID,
    "status"              "onboarding_case_status" NOT NULL DEFAULT 'active',
    "start_date"          DATE NOT NULL,
    "owner_membership_id" UUID,
    "signed_off_by"       UUID,
    "signed_off_at"       TIMESTAMPTZ,
    "sign_off_note"       TEXT,
    "cancelled_by"        UUID,
    "cancelled_at"        TIMESTAMPTZ,
    "cancel_reason"       TEXT,
    "created_by"          UUID,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_case_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_case_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_case_template_fkey" FOREIGN KEY ("tenant_id", "template_id")
      REFERENCES "onboarding_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_case_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_case_owner_fkey" FOREIGN KEY ("tenant_id", "owner_membership_id")
      REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_case_note_length" CHECK ("sign_off_note" IS NULL OR char_length("sign_off_note") <= 500),
    CONSTRAINT "onboarding_case_reason_length" CHECK ("cancel_reason" IS NULL OR char_length("cancel_reason") BETWEEN 3 AND 500),
    -- Final sign-off and cancellation are recorded with who and when.
    CONSTRAINT "onboarding_case_completed_consistent" CHECK (
      ("status" = 'completed') = ("signed_off_at" IS NOT NULL AND "signed_off_by" IS NOT NULL)),
    CONSTRAINT "onboarding_case_cancelled_consistent" CHECK (
      ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "onboarding_case_tenant_id_id_key" ON "onboarding_case" ("tenant_id", "id");
CREATE UNIQUE INDEX "onboarding_case_one_active" ON "onboarding_case" ("tenant_id", "employee_id") WHERE "status" = 'active';
CREATE INDEX "onboarding_case_tenant_status" ON "onboarding_case" ("tenant_id", "status", "start_date");

-- Tasks (copied from the template when a case starts) -----------------------------
CREATE TABLE "onboarding_task" (
    "id"                     UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"              UUID NOT NULL,
    "case_id"                UUID NOT NULL,
    "template_task_id"       UUID,
    "title"                  TEXT NOT NULL,
    "guidance"               TEXT,
    "category"               "onboarding_task_category" NOT NULL,
    "owner_kind"             "onboarding_owner_kind" NOT NULL,
    "required"               BOOLEAN NOT NULL,
    "sort_order"             INTEGER NOT NULL DEFAULT 0,
    "due_on"                 DATE,
    "assignee_membership_id" UUID,
    "status"                 "onboarding_task_status" NOT NULL DEFAULT 'to_do',
    "completed_by"           UUID,
    "completed_at"           TIMESTAMPTZ,
    "on_behalf"              BOOLEAN NOT NULL DEFAULT false,
    "waived_reason"          TEXT,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_task_case_fkey" FOREIGN KEY ("tenant_id", "case_id")
      REFERENCES "onboarding_case"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_task_template_task_fkey" FOREIGN KEY ("tenant_id", "template_task_id")
      REFERENCES "onboarding_template_task"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_task_assignee_fkey" FOREIGN KEY ("tenant_id", "assignee_membership_id")
      REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_task_title_length" CHECK (char_length("title") BETWEEN 1 AND 160),
    CONSTRAINT "onboarding_task_guidance_length" CHECK ("guidance" IS NULL OR char_length("guidance") <= 2000),
    CONSTRAINT "onboarding_task_reason_length" CHECK ("waived_reason" IS NULL OR char_length("waived_reason") BETWEEN 3 AND 500),
    -- Done and waived tasks record who and when; a waiver always has a reason.
    CONSTRAINT "onboarding_task_status_consistent" CHECK (
      ("status" = 'to_do' AND "completed_at" IS NULL AND "completed_by" IS NULL AND "waived_reason" IS NULL AND NOT "on_behalf")
      OR ("status" = 'done' AND "completed_at" IS NOT NULL AND "completed_by" IS NOT NULL AND "waived_reason" IS NULL)
      OR ("status" = 'waived' AND "completed_at" IS NOT NULL AND "completed_by" IS NOT NULL AND "waived_reason" IS NOT NULL AND NOT "on_behalf"))
);
CREATE UNIQUE INDEX "onboarding_task_tenant_id_id_key" ON "onboarding_task" ("tenant_id", "id");
CREATE INDEX "onboarding_task_case" ON "onboarding_task" ("tenant_id", "case_id", "sort_order");
CREATE INDEX "onboarding_task_due" ON "onboarding_task" ("tenant_id", "status", "due_on");

-- Row-level security: one tenant policy per table (same as every tenant table).
ALTER TABLE "onboarding_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_template" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_template" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

ALTER TABLE "onboarding_template_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_template_task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_template_task" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

ALTER TABLE "onboarding_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_case" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

ALTER TABLE "onboarding_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_task" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE.
GRANT SELECT, INSERT ON "onboarding_template", "onboarding_template_task", "onboarding_case", "onboarding_task" TO teamhappi_app;
GRANT UPDATE ("name", "description", "scope", "site_id", "job_title", "version", "archived_at", "updated_at")
  ON "onboarding_template" TO teamhappi_app;
GRANT UPDATE ("title", "guidance", "category", "owner_kind", "due_offset_days", "required", "sort_order", "archived_at", "updated_at")
  ON "onboarding_template_task" TO teamhappi_app;
-- The employee, template snapshot and start date of a case never change.
GRANT UPDATE ("status", "owner_membership_id", "signed_off_by", "signed_off_at", "sign_off_note",
              "cancelled_by", "cancelled_at", "cancel_reason", "updated_at")
  ON "onboarding_case" TO teamhappi_app;
-- A task's copied content never changes; only its progress and assignment.
GRANT UPDATE ("due_on", "assignee_membership_id", "status", "completed_by", "completed_at",
              "on_behalf", "waived_reason", "updated_at")
  ON "onboarding_task" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('onboarding.view', 'View onboarding and its progress'),
  ('onboarding.manage', 'Start onboarding and work through tasks'),
  ('onboarding.template.manage', 'Create and edit onboarding templates'),
  ('onboarding.signoff', 'Give final onboarding sign-off and waive required tasks');

-- Built-in roles in every existing organisation get the same permissions a
-- new organisation would get. Site-scoped assignments stay site-scoped.
INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'onboarding.view'), ('owner', 'onboarding.manage'),
  ('owner', 'onboarding.template.manage'), ('owner', 'onboarding.signoff'),
  ('admin', 'onboarding.view'), ('admin', 'onboarding.manage'),
  ('admin', 'onboarding.template.manage'), ('admin', 'onboarding.signoff'),
  ('hr_manager', 'onboarding.view'), ('hr_manager', 'onboarding.manage'),
  ('hr_manager', 'onboarding.template.manage'), ('hr_manager', 'onboarding.signoff'),
  ('site_manager', 'onboarding.view'), ('site_manager', 'onboarding.manage')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
