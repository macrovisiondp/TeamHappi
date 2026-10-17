-- M5.3: platform integration configuration (ADR-0011 stage 1, ADR-0012).
--
-- Additive. Stores NON-SECRET provider settings as numbered, append-only
-- versions, the active provider per service and environment, and platform
-- settings such as the AI kill switch and budgets. Credential VALUES are never
-- stored here (they live in the hosting provider's encrypted environment).
-- Used only by teamhappi_platform; teamhappi_app has no access.

CREATE TABLE "integration_config" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "category"     TEXT NOT NULL,
    "provider_id"  TEXT NOT NULL,
    "environment"  TEXT NOT NULL,
    "version"      INTEGER NOT NULL,
    "settings"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "validated_at" TIMESTAMPTZ,
    "created_by"   UUID,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_config_category" CHECK ("category" IN ('email', 'storage', 'payments', 'ai')),
    CONSTRAINT "integration_config_environment" CHECK ("environment" IN ('local', 'preview', 'production')),
    CONSTRAINT "integration_config_provider_format" CHECK ("provider_id" ~ '^[a-z0-9-]{2,40}$'),
    CONSTRAINT "integration_config_version_positive" CHECK ("version" > 0),
    CONSTRAINT "integration_config_settings_object" CHECK (jsonb_typeof("settings") = 'object')
);
CREATE UNIQUE INDEX "integration_config_version_key"
  ON "integration_config" ("category", "provider_id", "environment", "version");

CREATE TABLE "integration_active" (
    "category"     TEXT NOT NULL,
    "environment"  TEXT NOT NULL,
    "provider_id"  TEXT NOT NULL,
    "config_id"    UUID,
    "activated_by" UUID,
    "activated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_active_pkey" PRIMARY KEY ("category", "environment"),
    CONSTRAINT "integration_active_config_fkey" FOREIGN KEY ("config_id")
      REFERENCES "integration_config"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "integration_active_category" CHECK ("category" IN ('email', 'storage', 'payments', 'ai')),
    CONSTRAINT "integration_active_environment" CHECK ("environment" IN ('local', 'preview', 'production'))
);

CREATE TABLE "platform_setting" (
    "key"        TEXT NOT NULL,
    "value"      JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "platform_setting_key_format" CHECK ("key" ~ '^[a-z_.]{2,60}$')
);

-- RLS: platform role only.
ALTER TABLE "integration_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY "platform_only" ON "integration_config" FOR ALL TO teamhappi_platform
  USING (true) WITH CHECK (true);
ALTER TABLE "integration_active" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_active" FORCE ROW LEVEL SECURITY;
CREATE POLICY "platform_only" ON "integration_active" FOR ALL TO teamhappi_platform
  USING (true) WITH CHECK (true);
ALTER TABLE "platform_setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_setting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "platform_only" ON "platform_setting" FOR ALL TO teamhappi_platform
  USING (true) WITH CHECK (true);

-- Versions are append-only (only the validation time can be set later).
-- No DELETE anywhere.
GRANT SELECT, INSERT ON "integration_config" TO teamhappi_platform;
GRANT UPDATE ("validated_at") ON "integration_config" TO teamhappi_platform;
GRANT SELECT, INSERT, UPDATE ON "integration_active" TO teamhappi_platform;
GRANT SELECT, INSERT, UPDATE ON "platform_setting" TO teamhappi_platform;
