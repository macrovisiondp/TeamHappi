-- M9.2a: vacancy share links and QR codes (docs/architecture/m9.2a-vacancy-sharing.md).
--
-- Additive. No existing rows change.
--
-- A vacancy can have an unlisted public link (/jobs/<public_code>) that shows
-- ONLY its published fields while it is open, plus a "how to apply" text the
-- manager writes. NO applicant data is collected (online applications are
-- M9.3, gate R5). Pay is shown only when the manager ticks "Show pay".
--
-- The public page has no signed-in organisation, so it reads through one
-- SECURITY DEFINER function, app.public_vacancy(code, source), which returns
-- only the published fields and counts views (link or QR, counts only; nothing
-- about who viewed). Regenerating or removing the code switches old links off.
--
-- Rollback (see the approval request):
--   DROP FUNCTION app.public_vacancy(text, text);
--   ALTER TABLE vacancy DROP CONSTRAINT vacancy_public_code_format, DROP CONSTRAINT vacancy_how_to_apply_length,
--     DROP COLUMN public_code, DROP COLUMN how_to_apply, DROP COLUMN show_pay,
--     DROP COLUMN share_views_link, DROP COLUMN share_views_qr;

ALTER TABLE "vacancy"
  ADD COLUMN "public_code"      TEXT,
  ADD COLUMN "how_to_apply"     TEXT,
  ADD COLUMN "show_pay"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "share_views_link" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "share_views_qr"   INTEGER NOT NULL DEFAULT 0;
-- 12 random base62 characters: unguessable, short enough for a poster.
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_public_code_format"
  CHECK ("public_code" IS NULL OR "public_code" ~ '^[A-Za-z0-9]{12}$');
ALTER TABLE "vacancy" ADD CONSTRAINT "vacancy_how_to_apply_length"
  CHECK ("how_to_apply" IS NULL OR char_length("how_to_apply") BETWEEN 1 AND 1000);
-- Codes are unique across all organisations (the public URL has no organisation in it).
CREATE UNIQUE INDEX "vacancy_public_code_key" ON "vacancy" ("public_code") WHERE "public_code" IS NOT NULL;

-- The app may set the code, the how-to-apply text and whether pay is shown.
-- View counters change only through app.public_vacancy (no app grant).
GRANT UPDATE ("public_code", "how_to_apply", "show_pay") ON "vacancy" TO teamhappi_app;

-- Public read: published fields of the vacancy with this code. "state" is
-- 'open' (details returned) or 'closed' (only the title and organisation, so
-- the page can say it's no longer accepting applications). Unknown or
-- malformed codes return no row. p_source 'link' or 'qr' counts one view of
-- an open vacancy; anything else (e.g. a manager's preview) counts nothing.
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
    "pay_period" text
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v record;
  BEGIN
    IF "p_code" IS NULL OR "p_code" !~ '^[A-Za-z0-9]{12}$' THEN RETURN; END IF;
    SELECT vac."id", vac."status", vac."title", vac."employment_type", vac."description", vac."how_to_apply",
           vac."closes_on", vac."show_pay", vac."pay_min", vac."pay_max", vac."pay_period",
           s."name" AS site_name, t."legal_name" AS organisation, t."status" AS tenant_status
      INTO v
      FROM "public"."vacancy" vac
      JOIN "public"."tenant" t ON t."id" = vac."tenant_id"
      JOIN "public"."site" s ON s."tenant_id" = vac."tenant_id" AND s."id" = vac."site_id"
      WHERE vac."public_code" = "p_code";
    IF NOT FOUND OR v.tenant_status <> 'active' THEN RETURN; END IF;
    IF v.status <> 'open' OR (v.closes_on IS NOT NULL AND v.closes_on < CURRENT_DATE) THEN
      RETURN QUERY SELECT 'closed'::text, v.organisation, v.title, NULL::text, NULL::text, NULL::text,
        NULL::text, NULL::date, NULL::numeric, NULL::numeric, NULL::text;
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
      CASE WHEN v.show_pay THEN v.pay_period::text END;
  END $$;

REVOKE ALL ON FUNCTION "app"."public_vacancy"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."public_vacancy"(text, text) TO teamhappi_app;
