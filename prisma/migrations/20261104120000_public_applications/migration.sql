-- M9.3: online applications on the shared vacancy link (docs/architecture/m9.3-public-applications.md).
--
-- Additive. No existing rows change.
--
-- People who open a vacancy's share link (or scan its QR code) can apply:
-- name, email, optional phone, optional CV, and agreement to the privacy
-- notice. The public page has no signed-in organisation, so it writes only
-- through two SECURITY DEFINER functions (like app.public_vacancy):
--   app.public_apply(...)        creates the candidate, the application at
--                                "Applied", its first history entry and an
--                                audit event, after checking the vacancy is
--                                open, the rate limits and duplicates;
--   app.public_apply_attach(...) records the CV the server just stored, only
--                                for an application created that way in the
--                                last 10 minutes that has no CV yet.
-- Rate limits live in public_apply_throttle: a keyed hash of the device's
-- address (never the address itself) per hour, kept for two days. No role
-- has any privilege on it; only app.public_apply reads and writes it.
--
-- Rollback (see the approval request):
--   DROP FUNCTION app.public_apply_attach(uuid, uuid, text, text, text, integer, text, text);
--   DROP FUNCTION app.public_apply(text, text, text, text, text, text, text);
--   DROP TABLE public_apply_throttle;
--   ALTER TABLE application DROP CONSTRAINT application_privacy_notice,
--     DROP COLUMN privacy_notice_version, DROP COLUMN privacy_notice_at;
--   ALTER TABLE application_document ALTER COLUMN uploaded_by SET NOT NULL;  (only if no candidate uploads)
--   and recreate app.public_vacancy from 20261102120000_vacancy_sharing.

-- Which privacy notice an applicant agreed to, and when (online applications only).
ALTER TABLE "application"
  ADD COLUMN "privacy_notice_version" TEXT,
  ADD COLUMN "privacy_notice_at"      TIMESTAMPTZ;
ALTER TABLE "application" ADD CONSTRAINT "application_privacy_notice" CHECK (
  ("privacy_notice_version" IS NULL AND "privacy_notice_at" IS NULL)
  OR ("privacy_notice_version" ~ '^[a-z0-9.-]{1,20}$' AND "privacy_notice_at" IS NOT NULL));

-- CVs uploaded by the candidate have no TeamHappi uploader.
ALTER TABLE "application_document" ALTER COLUMN "uploaded_by" DROP NOT NULL;

-- Rate limits (not tenant data: one row per device hash per hour) ----------------------
CREATE TABLE "public_apply_throttle" (
    "client_hash"  TEXT NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "attempts"     INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "public_apply_throttle_pkey" PRIMARY KEY ("client_hash", "window_start"),
    CONSTRAINT "public_apply_throttle_hash" CHECK ("client_hash" ~ '^[0-9a-f]{64}$')
);
-- Deny-all for everyone but the owner (no policies, no grants).
ALTER TABLE "public_apply_throttle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public_apply_throttle" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "public_apply_throttle" FROM PUBLIC;

-- The public vacancy now also says how long the organisation keeps applicant
-- data (for the privacy notice). Same rules and grants as before.
DROP FUNCTION "app"."public_vacancy"(text, text);
CREATE FUNCTION "app"."public_vacancy"("p_code" text, "p_source" text)
  RETURNS TABLE (
    "state" text,
    "organisation" text,
    "title" text,
    "site_name" text,
    "employment_type" text,
    "description" text,
    "how_to_apply" text,
    "closes_on" date,
    "pay_min" numeric,
    "pay_max" numeric,
    "pay_period" text,
    "retention_months" integer
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v record;
  BEGIN
    IF "p_code" IS NULL OR "p_code" !~ '^[A-Za-z0-9]{12}$' THEN RETURN; END IF;
    SELECT vac."id", vac."tenant_id", vac."status", vac."title", vac."employment_type", vac."description",
           vac."how_to_apply", vac."closes_on", vac."show_pay", vac."pay_min", vac."pay_max", vac."pay_period",
           s."name" AS site_name, t."legal_name" AS organisation, t."status" AS tenant_status
      INTO v
      FROM "public"."vacancy" vac
      JOIN "public"."tenant" t ON t."id" = vac."tenant_id"
      JOIN "public"."site" s ON s."tenant_id" = vac."tenant_id" AND s."id" = vac."site_id"
      WHERE vac."public_code" = "p_code";
    IF NOT FOUND OR v.tenant_status <> 'active' THEN RETURN; END IF;
    IF v.status <> 'open' OR (v.closes_on IS NOT NULL AND v.closes_on < CURRENT_DATE) THEN
      RETURN QUERY SELECT 'closed'::text, v.organisation, v.title, NULL::text, NULL::text, NULL::text,
        NULL::text, NULL::date, NULL::numeric, NULL::numeric, NULL::text, NULL::integer;
      RETURN;
    END IF;
    IF "p_source" = 'link' THEN
      UPDATE "public"."vacancy" SET "share_views_link" = "share_views_link" + 1 WHERE "id" = v.id;
    ELSIF "p_source" = 'qr' THEN
      UPDATE "public"."vacancy" SET "share_views_qr" = "share_views_qr" + 1 WHERE "id" = v.id;
    END IF;
    RETURN QUERY SELECT 'open'::text, v.organisation, v.title, v.site_name, v.employment_type::text,
      v.description, v.how_to_apply, v.closes_on,
      CASE WHEN v.show_pay THEN v.pay_min END, CASE WHEN v.show_pay THEN v.pay_max END,
      CASE WHEN v.show_pay THEN v.pay_period::text END,
      COALESCE((SELECT rs."retention_months" FROM "public"."recruitment_settings" rs
                WHERE rs."tenant_id" = v.tenant_id), 6);
  END $$;
REVOKE ALL ON FUNCTION "app"."public_vacancy"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."public_vacancy"(text, text) TO teamhappi_app;

-- Apply ------------------------------------------------------------------------------
-- status: 'created' (tenant_id and application_id set), 'duplicate' (this email
-- already applied for this vacancy; nothing created), 'limited' (too many
-- attempts), 'closed' (no longer accepting) or 'missing' (no such open link).
-- Limits: 5 attempts per device per hour; 200 applications per vacancy per day.
CREATE FUNCTION "app"."public_apply"(
    "p_code" text, "p_given_name" text, "p_family_name" text, "p_email" text,
    "p_phone" text, "p_notice_version" text, "p_client_hash" text)
  RETURNS TABLE ("status" text, "tenant_id" uuid, "application_id" uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v record;
    tries integer;
    cand uuid;
    app_id uuid;
    win timestamptz := date_trunc('hour', now());
  BEGIN
    IF "p_code" IS NULL OR "p_code" !~ '^[A-Za-z0-9]{12}$'
       OR "p_client_hash" IS NULL OR "p_client_hash" !~ '^[0-9a-f]{64}$' THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    -- Count the attempt first, so failed and duplicate attempts are limited too.
    DELETE FROM "public"."public_apply_throttle" WHERE "window_start" < now() - interval '2 days';
    INSERT INTO "public"."public_apply_throttle" AS t ("client_hash", "window_start", "attempts")
      VALUES ("p_client_hash", win, 1)
      ON CONFLICT ("client_hash", "window_start") DO UPDATE SET "attempts" = t."attempts" + 1
      RETURNING t."attempts" INTO tries;
    IF tries > 5 THEN
      RETURN QUERY SELECT 'limited'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;

    SELECT vac."id", vac."tenant_id", vac."status", vac."closes_on", t."status" AS tenant_status
      INTO v
      FROM "public"."vacancy" vac JOIN "public"."tenant" t ON t."id" = vac."tenant_id"
      WHERE vac."public_code" = "p_code";
    IF NOT FOUND OR v.tenant_status <> 'active' THEN
      RETURN QUERY SELECT 'missing'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    IF v.status <> 'open' OR (v.closes_on IS NOT NULL AND v.closes_on < CURRENT_DATE) THEN
      RETURN QUERY SELECT 'closed'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    IF (SELECT count(*) FROM "public"."application" a
          WHERE a."tenant_id" = v.tenant_id AND a."vacancy_id" = v.id AND a."created_by" IS NULL
            AND a."created_at" > now() - interval '1 day') >= 200 THEN
      RETURN QUERY SELECT 'limited'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    -- Same email, same vacancy: don't create another (the page says the same thing either way).
    IF EXISTS (SELECT 1 FROM "public"."application" a
                 JOIN "public"."candidate" c ON c."tenant_id" = a."tenant_id" AND c."id" = a."candidate_id"
                WHERE a."tenant_id" = v.tenant_id AND a."vacancy_id" = v.id AND c."email" = lower("p_email")) THEN
      RETURN QUERY SELECT 'duplicate'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;

    INSERT INTO "public"."candidate" ("tenant_id", "given_name", "family_name", "email", "phone", "source")
      VALUES (v.tenant_id, "p_given_name", "p_family_name", lower("p_email"), NULLIF("p_phone", ''), 'careers_page')
      RETURNING "id" INTO cand;
    INSERT INTO "public"."application" ("tenant_id", "candidate_id", "vacancy_id", "privacy_notice_version", "privacy_notice_at")
      VALUES (v.tenant_id, cand, v.id, "p_notice_version", now())
      RETURNING "id" INTO app_id;
    INSERT INTO "public"."application_event" ("tenant_id", "application_id", "from_stage", "to_stage")
      VALUES (v.tenant_id, app_id, NULL, 'applied');
    INSERT INTO "public"."audit_event" ("tenant_id", "action", "target_type", "target_id", "detail")
      VALUES (v.tenant_id, 'recruitment.online_application', 'application', app_id,
              jsonb_build_object('vacancyId', v.id, 'noticeVersion', "p_notice_version"));
    RETURN QUERY SELECT 'created'::text, v.tenant_id, app_id;
  END $$;
REVOKE ALL ON FUNCTION "app"."public_apply"(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."public_apply"(text, text, text, text, text, text, text) TO teamhappi_app;

-- Attach the CV the server has just stored, to an application created online in
-- the last 10 minutes that has no CV yet. Returns the document id, or NULL.
CREATE FUNCTION "app"."public_apply_attach"(
    "p_tenant_id" uuid, "p_application_id" uuid, "p_object_id" text, "p_file_name" text,
    "p_content_type" text, "p_size_bytes" integer, "p_sha256" text, "p_provider_id" text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    doc uuid;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "public"."application" a
        JOIN "public"."candidate" c ON c."tenant_id" = a."tenant_id" AND c."id" = a."candidate_id"
       WHERE a."tenant_id" = "p_tenant_id" AND a."id" = "p_application_id"
         AND a."created_by" IS NULL AND a."privacy_notice_at" IS NOT NULL
         AND a."created_at" > now() - interval '10 minutes'
         AND c."source" = 'careers_page' AND c."anonymised_at" IS NULL)
     OR EXISTS (
      SELECT 1 FROM "public"."application_document" d
       WHERE d."tenant_id" = "p_tenant_id" AND d."application_id" = "p_application_id") THEN
      RETURN NULL;
    END IF;
    -- The table's CHECKs validate the key, type, size, hash and provider.
    INSERT INTO "public"."application_document"
      ("tenant_id", "application_id", "file_name", "content_type", "size_bytes", "sha256",
       "provider_id", "storage_key", "uploaded_by")
      VALUES ("p_tenant_id", "p_application_id", "p_file_name", "p_content_type", "p_size_bytes", "p_sha256",
              "p_provider_id", 'tenants/' || "p_tenant_id"::text || '/objects/' || "p_object_id", NULL)
      RETURNING "id" INTO doc;
    INSERT INTO "public"."audit_event" ("tenant_id", "action", "target_type", "target_id", "detail")
      VALUES ("p_tenant_id", 'recruitment.cv_uploaded', 'application', "p_application_id",
              jsonb_build_object('documentId', doc, 'contentType', "p_content_type",
                                 'sizeBytes', "p_size_bytes", 'by', 'candidate'));
    RETURN doc;
  END $$;
REVOKE ALL ON FUNCTION "app"."public_apply_attach"(uuid, uuid, text, text, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."public_apply_attach"(uuid, uuid, text, text, text, integer, text, text) TO teamhappi_app;
