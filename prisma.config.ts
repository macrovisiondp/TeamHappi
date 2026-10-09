import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files. Load .env.local for local CLI use only when
// no migration URL was supplied explicitly (CI, Vercel and the test harness set
// it themselves, and must never fall back to the developer's Neon database).
if (!process.env.DATABASE_MIGRATION_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // The CLI (migrate) uses the migration role over a direct, unpooled connection.
  // The app never uses this URL; it connects as teamhappi_app (src/lib/db).
  datasource: { url: process.env.DATABASE_MIGRATION_URL },
});
