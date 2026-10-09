import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/lib/permissions/catalogue";

import { admin, urls, withPg } from "../helpers/db";

const asApp = <T>(fn: Parameters<typeof withPg<T>>[1]) =>
  withPg(urls.appUrl, fn);

describe("application role posture", () => {
  it("is not superuser, cannot bypass RLS, cannot create roles or databases", async () => {
    const row = await asApp(
      async (c) =>
        (
          await c.query(
            `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
           FROM pg_roles WHERE rolname = current_user`,
          )
        ).rows[0],
    );
    expect(row).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it("is not a member of any other role (e.g. neon_superuser)", async () => {
    const memberships = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
             WHERE m.member = 'teamhappi_app'::regrole`,
          )
        ).rows,
    );
    expect(memberships).toEqual([]);
  });

  it("owns no tables, schemas or functions", async () => {
    const owned = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT relname AS name FROM pg_class WHERE relowner = 'teamhappi_app'::regrole
             UNION ALL SELECT nspname FROM pg_namespace WHERE nspowner = 'teamhappi_app'::regrole
             UNION ALL SELECT proname FROM pg_proc WHERE proowner = 'teamhappi_app'::regrole`,
          )
        ).rows,
    );
    expect(owned).toEqual([]);
  });

  it("cannot create tables or functions", async () => {
    await expect(
      asApp((c) => c.query(`CREATE TABLE public.sneaky (id int)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp((c) =>
        c.query(
          `CREATE FUNCTION app.sneaky() RETURNS int LANGUAGE sql AS 'select 1'`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot disable RLS, read migration history or truncate", async () => {
    await expect(
      asApp((c) => c.query(`ALTER TABLE employee DISABLE ROW LEVEL SECURITY`)),
    ).rejects.toThrow(/must be owner/);
    await expect(
      asApp((c) => c.query(`SELECT * FROM _prisma_migrations`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asApp((c) => c.query(`TRUNCATE employee`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cannot hard-delete people, tenants or documents", async () => {
    for (const table of [
      "employee",
      "tenant",
      "document",
      "site",
      "tenant_membership",
    ]) {
      await expect(
        asApp((c) => c.query(`DELETE FROM ${table}`)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("has exactly the reviewed table privileges", async () => {
    const grants = await admin(
      async (c) =>
        (
          await c.query<{ table_name: string; privileges: string }>(
            `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
             FROM information_schema.role_table_grants
             WHERE grantee = 'teamhappi_app' AND table_schema = 'public'
             GROUP BY table_name ORDER BY table_name`,
          )
        ).rows,
    );
    expect(
      Object.fromEntries(grants.map((g) => [g.table_name, g.privileges])),
    ).toEqual({
      document: "INSERT,SELECT,UPDATE",
      employee: "INSERT,SELECT,UPDATE",
      permission: "SELECT",
      role: "INSERT,SELECT,UPDATE",
      role_assignment: "DELETE,INSERT,SELECT",
      role_permission: "DELETE,INSERT,SELECT",
      site: "INSERT,SELECT,UPDATE",
      team: "INSERT,SELECT,UPDATE",
      team_member: "DELETE,INSERT,SELECT",
      tenant: "INSERT,SELECT,UPDATE",
      tenant_membership: "INSERT,SELECT,UPDATE",
      user: "SELECT",
    });
  });
});

describe("row-level security coverage", () => {
  it("every table with tenant_id, plus tenant and user, has RLS enabled, forced and a policy", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{
            table: string;
            enabled: boolean;
            forced: boolean;
            policies: number;
          }>(
            `SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
                    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r'
               AND (c.relname IN ('tenant', 'user') OR EXISTS (
                 SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                   AND NOT a.attisdropped))
             ORDER BY 1`,
          )
        ).rows,
    );
    expect(rows.map((r) => r.table)).toEqual([
      "document",
      "employee",
      "role",
      "role_assignment",
      "role_permission",
      "site",
      "team",
      "team_member",
      "tenant",
      "tenant_membership",
      "user",
    ]);
    for (const r of rows) {
      expect(r, r.table).toMatchObject({ enabled: true, forced: true });
      expect(r.policies, r.table).toBeGreaterThan(0);
    }
  });

  it("policies apply only to the application role (no PUBLIC policies)", async () => {
    const roles = await admin(
      async (c) =>
        (
          await c.query<{ roles: string }>(
            `SELECT DISTINCT array_to_string(roles, ',') AS roles FROM pg_policies WHERE schemaname = 'public'`,
          )
        ).rows,
    );
    expect(roles).toEqual([{ roles: "teamhappi_app" }]);
  });
});

describe("permission catalogue", () => {
  it("database catalogue matches the code catalogue", async () => {
    const codes = await asApp(
      async (c) =>
        (await c.query<{ code: string }>(`SELECT code FROM permission`)).rows,
    );
    expect(codes.map((r) => r.code).sort()).toEqual(
      Object.keys(PERMISSIONS).sort(),
    );
  });
});
