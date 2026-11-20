// Local development database (no Docker, no cloud): a persistent PostgreSQL 18
// in .data/dev-pg on port 55432, with the same roles, bootstrap SQL and
// migrations as Neon. Never touches Neon.
//
//   npm run dev:db      start it (keep this terminal open), then `npm run dev`
//   npm run dev:seed    create synthetic demo accounts (in another terminal)
//
// Writes .env.development.local (gitignored), which `next dev` reads in
// preference to .env.local, so the dev server uses this database and a local
// auth secret. Generated passwords live only in .data/dev-db.json (gitignored).
// Set DEV_APP_URL (e.g. http://localhost:3105) if the dev server uses another port.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const DIR = ".data/dev-pg";
const STATE = ".data/dev-db.json";
const PORT = 55432;
const DB = "teamhappi";
const secret = (n = 18) => randomBytes(n).toString("base64url");

mkdirSync(".data", { recursive: true });
const firstRun = !existsSync(STATE);
const state = firstRun
  ? {
      superPassword: secret(),
      migratorPassword: secret(),
      appPassword: secret(),
      authPassword: secret(),
      authSecret: secret(32),
    }
  : JSON.parse(readFileSync(STATE, "utf8"));
// Roles added after a local database was first created (M5.2).
const addedState = !state.platformPassword;
state.platformPassword ??= secret();
if (firstRun || addedState)
  writeFileSync(STATE, JSON.stringify(state, null, 2));

const url = (user, password, db = DB) =>
  `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${PORT}/${db}`;

const server = new EmbeddedPostgres({
  databaseDir: DIR,
  user: "postgres",
  password: state.superPassword,
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

async function run(connectionString, sql) {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

if (!existsSync(`${DIR}/PG_VERSION`)) await server.initialise();
await server.start();

const serverAdmin = url("postgres", state.superPassword, "postgres");
if (firstRun) {
  for (const statement of [
    `CREATE ROLE teamhappi_migrator WITH LOGIN PASSWORD '${state.migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`,
    `CREATE ROLE teamhappi_app WITH LOGIN PASSWORD '${state.appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
    `CREATE ROLE teamhappi_auth WITH LOGIN PASSWORD '${state.authPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
  ]) {
    await run(serverAdmin, statement);
  }
}

// The database must be UTF-8 like Neon (course content has emoji, names have
// accents). Databases made before this check used the Windows code page: that
// one is renamed aside (kept, not deleted) and a fresh UTF-8 one is created.
let fresh = firstRun;
{
  const c = new pg.Client({ connectionString: serverAdmin });
  await c.connect();
  try {
    const row = (
      await c.query(
        `SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1`,
        [DB],
      )
    ).rows[0];
    if (row && row.enc !== "UTF8") {
      const aside = `${DB}_${row.enc.toLowerCase()}_${Date.now()}`;
      await c.query(`ALTER DATABASE ${DB} RENAME TO ${aside}`);
      console.log(
        `The local database used ${row.enc}; kept it as "${aside}" and created a fresh UTF-8 one. Run \`npm run dev:seed\` again.`,
      );
    }
    if (!row || row.enc !== "UTF8") {
      await c.query(
        `CREATE DATABASE ${DB} OWNER teamhappi_migrator ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
      );
      fresh = true;
    }
  } finally {
    await c.end();
  }
}

if (fresh) {
  const adminDb = url("postgres", state.superPassword);
  await run(adminDb, readFileSync("prisma/bootstrap/neon-dev.sql", "utf8"));
  await run(
    adminDb,
    readFileSync("prisma/bootstrap/neon-dev-auth-role.sql", "utf8"),
  );
}

// Platform console role (M5.2, ADR-0009): created on any local database that
// doesn't have it yet, then the same bootstrap steps as on Neon.
{
  const adminDb = url("postgres", state.superPassword);
  await run(
    adminDb,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'teamhappi_platform') THEN
         CREATE ROLE teamhappi_platform WITH LOGIN PASSWORD '${state.platformPassword}'
           NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
       END IF;
     END $$`,
  );
  await run(
    adminDb,
    readFileSync("prisma/bootstrap/neon-dev-platform-role.sql", "utf8"),
  );
}

execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: url("teamhappi_migrator", state.migratorPassword),
    },
    stdio: "inherit",
  },
);

writeFileSync(
  ".env.development.local",
  [
    "# Generated by scripts/dev-db.mjs for the LOCAL development database. Do not commit.",
    `APP_URL=${process.env.DEV_APP_URL ?? "http://localhost:3000"}`,
    `DATABASE_URL=${url("teamhappi_app", state.appPassword)}`,
    `AUTH_DATABASE_URL=${url("teamhappi_auth", state.authPassword)}`,
    `BETTER_AUTH_SECRET=${state.authSecret}`,
    `PLATFORM_DATABASE_URL=${url("teamhappi_platform", state.platformPassword)}`,
    "",
  ].join("\n"),
);

console.log(
  `Local PostgreSQL 18 running on 127.0.0.1:${PORT} (database "${DB}").\n` +
    "Wrote .env.development.local. Start the app with `npm run dev`; seed with `npm run dev:seed`.\n" +
    "Press Ctrl+C to stop the database.",
);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
