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
      // UPDATE is column-level since M4.2 (see the next test).
      employee: "INSERT,SELECT",
      permission: "SELECT",
      role: "INSERT,SELECT,UPDATE",
      role_assignment: "DELETE,INSERT,SELECT",
      role_permission: "DELETE,INSERT,SELECT",
      site: "INSERT,SELECT,UPDATE",
      team: "INSERT,SELECT,UPDATE",
      team_member: "DELETE,INSERT,SELECT",
      tenant: "INSERT,SELECT",
      tenant_membership: "INSERT,SELECT,UPDATE",
      user: "SELECT",
    });
  });
});

describe("column-level UPDATE privileges (M4.2)", () => {
  it("the app may update only the reviewed columns of tenant and employee", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ table_name: string; columns: string }>(
            `SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS columns
             FROM information_schema.column_privileges
             WHERE grantee = 'teamhappi_app' AND privilege_type = 'UPDATE'
               AND table_name IN ('tenant', 'employee')
               AND NOT EXISTS (
                 SELECT 1 FROM information_schema.role_table_grants g
                 WHERE g.grantee = 'teamhappi_app' AND g.table_name = column_privileges.table_name
                   AND g.privilege_type = 'UPDATE')
             GROUP BY table_name ORDER BY table_name`,
          )
        ).rows,
    );
    expect(
      Object.fromEntries(rows.map((r) => [r.table_name, r.columns.split(",")])),
    ).toEqual({
      employee: [
        "email",
        "employee_number",
        "end_date",
        "family_name",
        "given_name",
        "job_title",
        "phone_number",
        "preferred_name",
        "primary_site_id",
        "start_date",
        "status",
        "updated_at",
      ],
      tenant: ["legal_name", "timezone", "updated_at"],
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

  it("every policy names exactly one known role (no PUBLIC policies)", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ table: string; roles: string }>(
            `SELECT tablename AS table, array_to_string(roles, ',') AS roles
             FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`,
          )
        ).rows,
    );
    const byRole: Record<string, string[]> = {};
    for (const r of rows) (byRole[r.roles] ??= []).push(r.table);
    // Tenant data and the tenant registry: application role only.
    // Identity tables: auth role only. "user": both (app read-only, scoped).
    expect(Object.keys(byRole).sort()).toEqual([
      "teamhappi_app",
      "teamhappi_auth",
    ]);
    expect(byRole.teamhappi_auth!.sort()).toEqual([
      "account",
      "rate_limit",
      "session",
      "user",
      "verification",
    ]);
    expect(byRole.teamhappi_app).not.toContain("session");
    expect(byRole.teamhappi_app).not.toContain("account");
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
