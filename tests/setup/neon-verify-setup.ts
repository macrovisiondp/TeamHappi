// Post-migration verification against the Neon DEVELOPMENT database.
//
// Runs ONLY when the product owner has approved it and the operator sets
// TEAMHAPPI_NEON_VERIFY=approved (the project does not exist otherwise; see
// vitest.config.mts). It never runs bootstrap SQL or migrations; those are
// separate, approved steps. It reads connection strings from .env.local and
// never prints them. It creates synthetic tenants and users, which remain in
// the development database unless the owner removes them.

import { existsSync } from "node:fs";

import pg from "pg";
import type { TestProject } from "vitest/node";

function hostOf(url: string) {
  return new URL(url).hostname;
}

export default async function setup(project: TestProject) {
  if (process.env.TEAMHAPPI_NEON_VERIFY !== "approved") {
    throw new Error(
      "Neon verification requires TEAMHAPPI_NEON_VERIFY=approved",
    );
  }
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const appUrl = process.env.DATABASE_URL;
  const ownerUrl = process.env.DATABASE_MIGRATION_URL;
  if (!appUrl || !ownerUrl) {
    throw new Error(
      "DATABASE_URL and DATABASE_MIGRATION_URL must be set in .env.local",
    );
  }

  // Guard rails: Neon only, app on the pooled endpoint, owner on the direct one,
  // and the database must already be migrated.
  const appHost = hostOf(appUrl);
  const ownerHost = hostOf(ownerUrl);
  if (!appHost.endsWith(".neon.tech") || !ownerHost.endsWith(".neon.tech")) {
    throw new Error("Neon verification only runs against *.neon.tech hosts");
  }
  if (!appHost.includes("-pooler")) {
    throw new Error("DATABASE_URL must use Neon's pooled endpoint");
  }
  if (ownerHost.includes("-pooler")) {
    throw new Error("DATABASE_MIGRATION_URL must use Neon's direct endpoint");
  }
  if (new URL(appUrl).username !== "teamhappi_app") {
    throw new Error("DATABASE_URL must connect as teamhappi_app");
  }

  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const migrated = await owner.query(
      `SELECT count(*)::int AS n FROM _prisma_migrations
       WHERE migration_name = '20261009120000_foundation_tenancy' AND finished_at IS NOT NULL`,
    );
    if (migrated.rows[0].n !== 1) throw new Error("Migration not applied");
  } finally {
    await owner.end();
  }

  project.provide("db", {
    adminUrl: ownerUrl,
    appUrl,
    // The M2 verification suites do not use the auth role.
    authUrl: process.env.AUTH_DATABASE_URL ?? "",
    migratorUrl: ownerUrl,
    migratorRole: decodeURIComponent(new URL(ownerUrl).username),
    pooled: true,
  });
}
