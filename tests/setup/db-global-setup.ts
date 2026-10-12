// Disposable PostgreSQL 18 for database tests. Never touches Neon.
//
// - CI: uses the Postgres service container via TEST_DATABASE_ADMIN_URL.
// - Locally: starts an embedded PostgreSQL (real binaries, no Docker) in a temp
//   directory and deletes it afterwards.
// Then: creates the same two roles as Neon (migrator with BYPASSRLS, app without),
// runs the committed bootstrap SQL and `prisma migrate deploy` exactly as they
// would run against Neon, and hands connection URLs to the tests.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { TestProject } from "vitest/node";

const DB = "teamhappi";

declare module "vitest" {
  export interface ProvidedContext {
    db: {
      adminUrl: string;
      appUrl: string;
      /** Connection as teamhappi_auth (Better Auth's role). */
      authUrl: string;
      migratorUrl: string;
      migratorRole: string;
      /** True when the app URL goes through a connection pooler (Neon). */
      pooled: boolean;
    };
  }
}

const secret = () => randomBytes(18).toString("base64url");

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function withCredentials(
  url: string,
  user: string,
  password: string,
  database: string,
) {
  const u = new URL(withDatabase(url, database));
  u.username = user;
  u.password = password;
  return u.toString();
}

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `Refusing to run database tests against non-local host "${host}"`,
    );
  }
}

async function run(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  let adminServerUrl = process.env.TEST_DATABASE_ADMIN_URL;
  let stopServer = async () => {};

  if (!adminServerUrl) {
    const dir = mkdtempSync(join(tmpdir(), "teamhappi-pg-"));
    const password = secret();
    const port = 55000 + Math.floor(Math.random() * 2000);
    const server = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password,
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    adminServerUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    stopServer = async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }
  assertLocal(adminServerUrl);

  try {
    const appPassword = secret();
    const authPassword = secret();
    const migratorPassword = secret();

    // Roles mirror Neon: neondb_owner (BYPASSRLS) -> teamhappi_migrator here.
    // One statement per call: DROP/CREATE DATABASE cannot run in a transaction block.
    for (const statement of [
      `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`,
      `DROP ROLE IF EXISTS teamhappi_app`,
      `DROP ROLE IF EXISTS teamhappi_auth`,
      `DROP ROLE IF EXISTS teamhappi_migrator`,
      `CREATE ROLE teamhappi_migrator WITH LOGIN PASSWORD '${migratorPassword}'
         NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`,
      `CREATE ROLE teamhappi_app WITH LOGIN PASSWORD '${appPassword}'
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
      `CREATE ROLE teamhappi_auth WITH LOGIN PASSWORD '${authPassword}'
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`,
      `CREATE DATABASE ${DB} OWNER teamhappi_migrator`,
    ]) {
      await run(adminServerUrl, statement);
    }

    const adminUrl = withDatabase(adminServerUrl, DB);
    // The same bootstrap SQL the product owner runs on Neon (steps 2–4).
    await run(adminUrl, readFileSync("prisma/bootstrap/neon-dev.sql", "utf8"));
    await run(
      adminUrl,
      readFileSync("prisma/bootstrap/neon-dev-auth-role.sql", "utf8"),
    );

    const migratorUrl = withCredentials(
      adminServerUrl,
      "teamhappi_migrator",
      migratorPassword,
      DB,
    );
    const authUrl = withCredentials(
      adminServerUrl,
      "teamhappi_auth",
      authPassword,
      DB,
    );
    const appUrl = withCredentials(
      adminServerUrl,
      "teamhappi_app",
      appPassword,
      DB,
    );

    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_MIGRATION_URL: migratorUrl },
        stdio: "pipe",
      },
    );

    project.provide("db", {
      adminUrl,
      appUrl,
      authUrl,
      migratorUrl,
      migratorRole: "teamhappi_migrator",
      pooled: false,
    });
  } catch (error) {
    await stopServer();
    throw error;
  }

  return async () => {
    await stopServer();
  };
}
