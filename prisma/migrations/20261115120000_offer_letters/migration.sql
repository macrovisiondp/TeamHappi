-- M14.3: offer letters (docs/architecture/m14-joining-flow.md, D1; approved by the
-- product owner on 19 November 2026).
--
-- Additive. No existing rows change.
--
-- At the Offer stage, someone with recruitment.hire at the vacancy's site
-- uploads the offer letter (PDF) and TeamHappi emails the applicant a private
-- link. The applicant, with no login, reads it and accepts (typed name and
-- agreement, a simple electronic signature) or declines. A signature page is
-- added and the signed copy kept privately.
--
-- The public link never gets general access: two SECURITY DEFINER functions do
-- one narrow job each, found only by the SHA-256 of the link's token:
--   app.offer_view    - what the applicant may see;
--   app.offer_respond - records accept or decline, once, before expiry.
-- The app role can't record a response itself (no UPDATE on those columns),
-- so nothing but the applicant's link can mark an offer as signed.
--
-- Rollback (only while the table is empty; see the record):
--   DROP FUNCTION app.offer_respond(text, text, text, text, text, text);
--   DROP FUNCTION app.offer_view(text);
--   DROP TABLE offer_letter;

CREATE TABLE "offer_letter" (
    "id"                 UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"          UUID NOT NULL,
    "application_id"     UUID NOT NULL,
    "title"              TEXT NOT NULL,
    "file_name"          TEXT NOT NULL,
    "size_bytes"         INTEGER NOT NULL,
    "sha256"             TEXT NOT NULL,
    "provider_id"        TEXT NOT NULL,
    "storage_key"        TEXT NOT NULL,
    -- Where the link was sent (the applicant's email at the time).
    "sent_to"            TEXT NOT NULL,
    "token_hash"         TEXT NOT NULL,
    "expires_at"         TIMESTAMPTZ NOT NULL,
    "status"             TEXT NOT NULL DEFAULT 'sent',
    "sent_by"            UUID NOT NULL,
    "sent_at"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at"       TIMESTAMPTZ,
    "signed_name"        TEXT,
    "final_provider_id"  TEXT,
    "final_storage_key"  TEXT,
    "final_sha256"       TEXT,
    "withdrawn_by"       UUID,
    "withdrawn_at"       TIMESTAMPTZ,
    CONSTRAINT "offer_letter_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_letter_application_fkey" FOREIGN KEY ("tenant_id", "application_id")
      REFERENCES "application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "offer_letter_title" CHECK (char_length("title") BETWEEN 1 AND 120),
    CONSTRAINT "offer_letter_file" CHECK (
      char_length("file_name") BETWEEN 1 AND 200
      AND "size_bytes" BETWEEN 1 AND 4194304
      AND "sha256" ~ '^[0-9a-f]{64}$'
      AND "storage_key" LIKE 'tenants/' || "tenant_id"::text || '/objects/%'),
    CONSTRAINT "offer_letter_token" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "offer_letter_sent_to" CHECK (char_length("sent_to") BETWEEN 3 AND 254),
    CONSTRAINT "offer_letter_flow" CHECK (
      ("status" = 'sent' AND "responded_at" IS NULL AND "signed_name" IS NULL
         AND "final_storage_key" IS NULL AND "withdrawn_at" IS NULL)
      OR ("status" = 'accepted' AND "responded_at" IS NOT NULL
          AND char_length("signed_name") BETWEEN 2 AND 100
          AND "final_provider_id" IS NOT NULL AND "final_sha256" ~ '^[0-9a-f]{64}$'
          AND "final_storage_key" LIKE 'tenants/' || "tenant_id"::text || '/objects/%')
      OR ("status" = 'declined' AND "responded_at" IS NOT NULL AND "final_storage_key" IS NULL)
      OR ("status" = 'withdrawn' AND "withdrawn_at" IS NOT NULL AND "withdrawn_by" IS NOT NULL))
);
CREATE UNIQUE INDEX "offer_letter_tenant_id_id_key" ON "offer_letter" ("tenant_id", "id");
CREATE UNIQUE INDEX "offer_letter_token_hash_key" ON "offer_letter" ("token_hash");
CREATE UNIQUE INDEX "offer_letter_storage_key_key" ON "offer_letter" ("storage_key");
-- One open offer per application.
CREATE UNIQUE INDEX "offer_letter_one_open" ON "offer_letter" ("tenant_id", "application_id")
  WHERE "status" = 'sent';
CREATE INDEX "offer_letter_application" ON "offer_letter" ("tenant_id", "application_id");

ALTER TABLE "offer_letter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offer_letter" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "offer_letter" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- Staff send and withdraw; only app.offer_respond records a response.
GRANT SELECT, INSERT ON "offer_letter" TO teamhappi_app;
GRANT UPDATE ("status", "withdrawn_by", "withdrawn_at") ON "offer_letter" TO teamhappi_app;

-- What the applicant may see, found only by the token's hash ---------------------------
CREATE FUNCTION "app"."offer_view"("p_hash" text)
  RETURNS TABLE (
    "state" text, "organisation" text, "title" text, "first_name" text,
    "expires_at" timestamptz, "file_name" text, "provider_id" text, "storage_key" text,
    "sha256" text, "final_provider_id" text, "final_storage_key" text, "final_sha256" text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE o record;
  BEGIN
    IF "p_hash" IS NULL OR "p_hash" !~ '^[0-9a-f]{64}$' THEN
      RETURN QUERY SELECT 'missing'::text, NULL, NULL, NULL, NULL::timestamptz, NULL, NULL, NULL, NULL, NULL, NULL, NULL;
      RETURN;
    END IF;
    SELECT ol.*, t."legal_name" AS org, t."status" AS tenant_status, c."given_name" AS first
      INTO o
      FROM "public"."offer_letter" ol
      JOIN "public"."tenant" t ON t."id" = ol."tenant_id"
      JOIN "public"."application" a ON a."tenant_id" = ol."tenant_id" AND a."id" = ol."application_id"
      JOIN "public"."candidate" c ON c."tenant_id" = a."tenant_id" AND c."id" = a."candidate_id"
      WHERE ol."token_hash" = "p_hash";
    IF NOT FOUND OR o.tenant_status <> 'active' THEN
      RETURN QUERY SELECT 'missing'::text, NULL, NULL, NULL, NULL::timestamptz, NULL, NULL, NULL, NULL, NULL, NULL, NULL;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      CASE WHEN o.status = 'sent' AND o.expires_at <= now() THEN 'expired'
           WHEN o.status = 'sent' THEN 'open' ELSE o.status END,
      o.org, o.title, o.first, o.expires_at, o.file_name, o.provider_id, o.storage_key,
      o.sha256, o.final_provider_id, o.final_storage_key, o.final_sha256;
  END $$;
REVOKE ALL ON FUNCTION "app"."offer_view"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."offer_view"(text) TO teamhappi_app;

-- Records the applicant's answer, once, before expiry -----------------------------------
CREATE FUNCTION "app"."offer_respond"(
    "p_hash" text, "p_decision" text, "p_signed_name" text,
    "p_final_provider" text, "p_final_key" text, "p_final_sha" text)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE o record;
  BEGIN
    IF "p_hash" IS NULL OR "p_hash" !~ '^[0-9a-f]{64}$'
       OR "p_decision" NOT IN ('accept', 'decline') THEN
      RETURN 'missing';
    END IF;
    SELECT ol."id", ol."tenant_id", ol."application_id", ol."status", ol."expires_at", t."status" AS tenant_status
      INTO o
      FROM "public"."offer_letter" ol JOIN "public"."tenant" t ON t."id" = ol."tenant_id"
      WHERE ol."token_hash" = "p_hash"
      FOR UPDATE OF ol;
    IF NOT FOUND OR o.tenant_status <> 'active' THEN RETURN 'missing'; END IF;
    IF o.status <> 'sent' THEN RETURN 'already'; END IF;
    IF o.expires_at <= now() THEN RETURN 'expired'; END IF;
    IF "p_decision" = 'accept' THEN
      UPDATE "public"."offer_letter" SET
        "status" = 'accepted', "responded_at" = now(), "signed_name" = "p_signed_name",
        "final_provider_id" = "p_final_provider", "final_storage_key" = "p_final_key",
        "final_sha256" = "p_final_sha"
        WHERE "id" = o.id;
    ELSE
      UPDATE "public"."offer_letter" SET "status" = 'declined', "responded_at" = now()
        WHERE "id" = o.id;
    END IF;
    INSERT INTO "public"."audit_event" ("tenant_id", "action", "target_type", "target_id", "detail")
      VALUES (o.tenant_id,
              CASE WHEN "p_decision" = 'accept' THEN 'recruitment.offer_accepted' ELSE 'recruitment.offer_declined' END,
              'application', o.application_id, jsonb_build_object('offerId', o.id));
    RETURN CASE WHEN "p_decision" = 'accept' THEN 'accepted' ELSE 'declined' END;
  END $$;
REVOKE ALL ON FUNCTION "app"."offer_respond"(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."offer_respond"(text, text, text, text, text, text) TO teamhappi_app;
