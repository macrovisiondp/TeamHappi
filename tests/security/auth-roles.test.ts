// Role separation between teamhappi_app (tenant data) and teamhappi_auth
// (identity: users, sessions, credentials, tokens, rate limits). ADR-0008.

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestAuth, type TestAuth } from "../helpers/auth";
import { admin, urls, withPg } from "../helpers/db";

const asApp = <T>(fn: (c: pg.Client) => Promise<T>) => withPg(urls.appUrl, fn);
const asAuth = <T>(fn: (c: pg.Client) => Promise<T>) =>
  withPg(urls.authUrl, fn);

const AUTH_TABLES = ["session", "account", "verification", "rate_limit"];
const TENANT_TABLES = [
  "tenant",
  "tenant_membership",
  "role",
  "role_permission",
  "role_assignment",
  "site",
  "team",
  "team_member",
  "employee",
  "document",
  "permission",
];

let t: TestAuth;

beforeAll(async () => {
  t = createTestAuth();
  // Make sure every auth table has at least one row to (fail to) read.
  const u = await t.provision({ verified: false });
  await t.call("/sign-in/email", {
    body: { email: u.email, password: u.password },
    ip: "192.0.2.80",
  });
  const v = await t.provision();
  await t.call("/sign-in/email", {
    body: { email: v.email, password: v.password },
    ip: "192.0.2.81",
  });
});

afterAll(async () => {
  await t.close();
});

describe("application role cannot see authentication data", () => {
  it.each(AUTH_TABLES)("teamhappi_app cannot read %s", async (table) => {
    await expect(
      asApp((c) => c.query(`SELECT * FROM "${table}" LIMIT 1`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("teamhappi_app cannot read password hashes even via the user table", async () => {
    // "user" has no password column; hashes live only in account.
    const cols = await admin(async (c) =>
      (
        await c.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'user'`,
        )
      ).rows.map((r) => r.column_name),
    );
    expect(cols).not.toContain("password");
  });

  it("stored passwords are hashes, never the submitted value", async () => {
    const u = await t.provision();
    const hash = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT password FROM account WHERE user_id = $1 AND provider_id = 'credential'`,
            [u.userId],
          )
        ).rows[0].password as string,
    );
    expect(hash).not.toContain(u.password);
    expect(hash.length).toBeGreaterThan(40);
  });
});

describe("authentication role cannot see tenant data", () => {
  it.each(TENANT_TABLES)("teamhappi_auth cannot read %s", async (table) => {
    await expect(
      asAuth((c) => c.query(`SELECT * FROM "${table}" LIMIT 1`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("teamhappi_auth cannot use the tenant-context functions or read migration history", async () => {
    await expect(
      asAuth((c) => c.query(`SELECT app.current_tenant_id()`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuth((c) => c.query(`SELECT * FROM _prisma_migrations`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("teamhappi_auth cannot delete users, create objects or switch role", async () => {
    await expect(asAuth((c) => c.query(`DELETE FROM "user"`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asAuth((c) => c.query(`CREATE TABLE public.stash (x int)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuth((c) => c.query(`CREATE TEMP TABLE stash (x int)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuth((c) => c.query(`SET ROLE "${urls.migratorRole}"`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuth((c) => c.query(`SET ROLE teamhappi_app`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("authentication role posture", () => {
  it("is not superuser, cannot bypass RLS, create roles or databases, and is in no other role", async () => {
    const row = await asAuth(
      async (c) =>
        (
          await c.query(
            `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication,
                    (SELECT count(*)::int FROM pg_auth_members WHERE member = r.oid) AS memberships
             FROM pg_roles r WHERE rolname = current_user`,
          )
        ).rows[0],
    );
    expect(row).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      memberships: 0,
    });
  });

  it("owns nothing", async () => {
    const owned = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT relname FROM pg_class WHERE relowner = 'teamhappi_auth'::regrole
             UNION ALL SELECT nspname FROM pg_namespace WHERE nspowner = 'teamhappi_auth'::regrole
             UNION ALL SELECT proname FROM pg_proc WHERE proowner = 'teamhappi_auth'::regrole`,
          )
        ).rows,
    );
    expect(owned).toEqual([]);
  });

  it("has exactly the reviewed table privileges", async () => {
    const grants = await admin(
      async (c) =>
        (
          await c.query<{ table_name: string; privileges: string }>(
            `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
             FROM information_schema.role_table_grants
             WHERE grantee = 'teamhappi_auth' AND table_schema = 'public'
             GROUP BY table_name ORDER BY table_name`,
          )
        ).rows,
    );
    expect(
      Object.fromEntries(grants.map((g) => [g.table_name, g.privileges])),
    ).toEqual({
      account: "INSERT,SELECT,UPDATE",
      rate_limit: "DELETE,INSERT,SELECT,UPDATE",
      session: "DELETE,INSERT,SELECT,UPDATE",
      user: "INSERT,SELECT,UPDATE",
      verification: "DELETE,INSERT,SELECT,UPDATE",
    });
  });

  it("authentication tables have RLS enabled and forced, with a policy for the auth role only", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
                    (SELECT string_agg(DISTINCT array_to_string(p.roles, ','), ';')
                       FROM pg_policies p WHERE p.tablename = c.relname AND p.schemaname = 'public') AS roles
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY 1`,
            [AUTH_TABLES],
          )
        ).rows,
    );
    expect(rows).toHaveLength(AUTH_TABLES.length);
    for (const r of rows) {
      expect(r, r.table).toMatchObject({
        enabled: true,
        forced: true,
        roles: "teamhappi_auth",
      });
    }
  });
});

describe("timestamps are stored correctly (UTC sessions)", () => {
  it.each([
    ["teamhappi_app", () => urls.appUrl],
    ["teamhappi_auth", () => urls.authUrl],
  ])("%s connections run in UTC", async (_role, url) => {
    const tz = await withPg(
      url(),
      async (c) =>
        (
          await c.query<{ tz: string }>(
            `SELECT current_setting('TimeZone') AS tz`,
          )
        ).rows[0]!.tz,
    );
    expect(tz).toBe("UTC");
  });

  it("a session expiry written by the application matches the database clock", async () => {
    const u = await t.provision();
    const before = Date.now();
    await t.call("/sign-in/email", {
      body: { email: u.email, password: u.password },
      ip: "192.0.2.82",
    });
    const row = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT extract(epoch FROM expires_at) * 1000 AS expires_ms,
                    extract(epoch FROM updated_at) * 1000 AS updated_ms
             FROM session WHERE user_id = $1`,
            [u.userId],
          )
        ).rows[0],
    );
    // Written by Prisma (updatedAt) must be within seconds of real time, not hours.
    expect(Math.abs(Number(row.updated_ms) - before)).toBeLessThan(60_000);
    expect(Number(row.expires_ms) - before).toBeGreaterThan(
      6.9 * 24 * 3600 * 1000,
    );
    expect(Number(row.expires_ms) - before).toBeLessThan(
      7.1 * 24 * 3600 * 1000,
    );
  });
});
