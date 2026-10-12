import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files. Load .env.local for local CLI use only when
// no migration URL was supplied explicitly (CI, Vercel and the test harness set
// it themselves, and must never fall back to the developer's Neon database).
if (!process.env.DATABASE_MIGRATION_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// Guard: commands that touch a database (migrate deploy/dev/reset/status/resolve,
// db push/pull/execute/seed) refuse any non-local host unless the operator sets
// TEAMHAPPI_REMOTE_MIGRATION=approved for a product-owner-approved run.
// Offline commands (generate, validate, format, migrate diff) are unaffected.
const DB_COMMANDS = new Set([
  "deploy",
  "dev",
  "reset",
  "status",
  "resolve",
  "push",
  "pull",
  "execute",
  "seed",
]);
const touchesDatabase =
  (process.argv.includes("migrate") || process.argv.includes("db")) &&
  process.argv.some((arg) => DB_COMMANDS.has(arg));
const target = process.env.DATABASE_MIGRATION_URL;
if (touchesDatabase && target) {
  const host = new URL(target).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && process.env.TEAMHAPPI_REMOTE_MIGRATION !== "approved") {
    throw new Error(
      `Refusing to run a Prisma database command against ${host}. Remote database ` +
        "changes need product-owner approval; set TEAMHAPPI_REMOTE_MIGRATION=approved only for an approved run.",
    );
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // The CLI (migrate) uses the migration role over a direct, unpooled connection.
  // The app never uses this URL; it connects as teamhappi_app (src/lib/db).
  datasource: { url: target },
});
