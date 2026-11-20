-- M15 step 2: imported course content and attempts
-- (docs/architecture/m15-training-courses.md, T1 to T4; approved by the
-- product owner on 20 November 2026).
--
-- Additive. Two new tables. One existing CHECK is replaced by a wider one that
-- also allows internal courses to be 'interactive'; every existing row still
-- satisfies it. No rows change.
--
-- training_course_package: a course's imported content, one row per version,
-- insert-only. It holds the answer key, so the application only ever sends
-- learners the questions, and grades answers on the server.
--
-- training_attempt: every module quiz and final assessment attempt. Final
-- questions are drawn by the server when the attempt starts (question_ids);
-- the answers are graded against that draw. Once submitted an attempt can't
-- change (trigger). No app-role DELETE on either table.
--
-- Rollback (only while both tables are empty; see the record):
--   DROP TABLE training_attempt, training_course_package;
--   DROP FUNCTION app.training_attempt_submit_once();
--   ALTER TABLE training_course DROP CONSTRAINT training_course_method_matches_kind;
--   ALTER TABLE training_course ADD CONSTRAINT training_course_method_matches_kind CHECK (
--     ("kind" = 'internal' AND "completion_method" IN ('read_and_confirm', 'in_person'))
--     OR ("kind" = 'external' AND "completion_method" = 'external_certificate'));

ALTER TABLE "training_course" DROP CONSTRAINT "training_course_method_matches_kind";
ALTER TABLE "training_course" ADD CONSTRAINT "training_course_method_matches_kind" CHECK (
  ("kind" = 'internal' AND "completion_method" IN ('read_and_confirm', 'in_person', 'interactive'))
  OR ("kind" = 'external' AND "completion_method" = 'external_certificate'));

CREATE TABLE "training_course_package" (
    "id"                  UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID NOT NULL,
    "course_id"           UUID NOT NULL,
    "version"             INTEGER NOT NULL,
    "code"                TEXT NOT NULL,
    "format"              TEXT NOT NULL,
    "content"             JSONB NOT NULL,
    "final_count"         INTEGER NOT NULL,
    "pass_percent"        INTEGER NOT NULL,
    "module_pass_percent" INTEGER NOT NULL,
    "practical"           TEXT,
    "created_by"          UUID NOT NULL,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_course_package_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_course_package_course_fkey" FOREIGN KEY ("tenant_id", "course_id")
      REFERENCES "training_course"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_course_package_version" CHECK ("version" > 0),
    CONSTRAINT "training_course_package_code" CHECK ("code" ~ '^[A-Za-z0-9._-]{1,20}$'),
    CONSTRAINT "training_course_package_format" CHECK ("format" IN ('hotrock-course')),
    CONSTRAINT "training_course_package_size" CHECK (octet_length("content"::text) <= 600000),
    CONSTRAINT "training_course_package_rules" CHECK (
      "final_count" BETWEEN 1 AND 100
      AND "pass_percent" BETWEEN 50 AND 100
      AND "module_pass_percent" BETWEEN 50 AND 100),
    CONSTRAINT "training_course_package_practical" CHECK (
      "practical" IS NULL OR char_length("practical") BETWEEN 1 AND 1000)
);
CREATE UNIQUE INDEX "training_course_package_tenant_id_id_key" ON "training_course_package" ("tenant_id", "id");
CREATE UNIQUE INDEX "training_course_package_course_version" ON "training_course_package" ("tenant_id", "course_id", "version");
CREATE INDEX "training_course_package_code_idx" ON "training_course_package" ("tenant_id", "code");

CREATE TABLE "training_attempt" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "employee_id"   UUID NOT NULL,
    "course_id"     UUID NOT NULL,
    "package_id"    UUID NOT NULL,
    "part"          TEXT NOT NULL,
    "module_index"  INTEGER,
    "question_ids"  INTEGER[] NOT NULL,
    "started_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at"  TIMESTAMPTZ,
    "correct"       INTEGER,
    "score_percent" INTEGER,
    "passed"        BOOLEAN,
    CONSTRAINT "training_attempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_attempt_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_attempt_course_fkey" FOREIGN KEY ("tenant_id", "course_id")
      REFERENCES "training_course"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_attempt_package_fkey" FOREIGN KEY ("tenant_id", "package_id")
      REFERENCES "training_course_package"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "training_attempt_part" CHECK (
      ("part" = 'module' AND "module_index" BETWEEN 0 AND 49)
      OR ("part" = 'final' AND "module_index" IS NULL)),
    CONSTRAINT "training_attempt_questions" CHECK (cardinality("question_ids") BETWEEN 1 AND 200),
    CONSTRAINT "training_attempt_result" CHECK (
      ("submitted_at" IS NULL AND "correct" IS NULL AND "score_percent" IS NULL AND "passed" IS NULL)
      OR ("submitted_at" IS NOT NULL AND "correct" BETWEEN 0 AND cardinality("question_ids")
          AND "score_percent" BETWEEN 0 AND 100 AND "passed" IS NOT NULL))
);
CREATE UNIQUE INDEX "training_attempt_tenant_id_id_key" ON "training_attempt" ("tenant_id", "id");
CREATE INDEX "training_attempt_person_course" ON "training_attempt" ("tenant_id", "employee_id", "course_id");

-- A submitted attempt is final: no changes to it, and no deletes at all.
CREATE FUNCTION "app"."training_attempt_submit_once"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'training attempts are never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."submitted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a submitted training attempt can not change' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW."tenant_id", NEW."employee_id", NEW."course_id", NEW."package_id", NEW."part",
      NEW."module_index", NEW."question_ids", NEW."started_at")
     IS DISTINCT FROM
     (OLD."tenant_id", OLD."employee_id", OLD."course_id", OLD."package_id", OLD."part",
      OLD."module_index", OLD."question_ids", OLD."started_at") THEN
    RAISE EXCEPTION 'only the result of a training attempt can be recorded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION "app"."training_attempt_submit_once"() FROM PUBLIC;
CREATE TRIGGER "training_attempt_submit_once" BEFORE UPDATE OR DELETE ON "training_attempt"
  FOR EACH ROW EXECUTE FUNCTION "app"."training_attempt_submit_once"();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_course_package', 'training_attempt']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON "training_course_package", "training_attempt" TO teamhappi_app;
GRANT UPDATE ("submitted_at", "correct", "score_percent", "passed") ON "training_attempt" TO teamhappi_app;
