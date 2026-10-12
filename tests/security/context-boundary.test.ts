// Security boundary of the PostgreSQL custom settings that carry tenant context
// (design doc §5a). These tests pin down what RLS does and does not protect
// against, and check each compensating control.

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";

import {
  admin,
  appDb,
  createTenantFixture,
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "kilo");
  B = await createTenantFixture(db, "lima");
});

afterAll(async () => {
  await db.$disconnect();
});

const asApp = <T>(fn: (c: pg.Client) => Promise<T>) => withPg(urls.appUrl, fn);
const countEmployees = async (c: pg.Client) =>
  (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM employee`))
    .rows[0]!.n;

describe("documented boundary: arbitrary SQL as the application role", () => {
  // This is a characterisation test, not a desired property. RLS enforces tenant
  // scope for authorised application transactions; it cannot stop SQL that runs
  // as teamhappi_app from choosing a tenant for its own transaction. The
  // compensating controls are tested below and in tests/unit/static-guards.test.ts.
  it("a transaction that sets its own valid context can read that tenant", async () => {
    const n = await asApp(async (c) => {
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.tenant_id', $1, true),
                set_config('app.context_token', app.context_token(), true)`,
        [B.tenantId],
      );
      const count = await countEmployees(c);
      await c.query("ROLLBACK");
      return count;
    });
    expect(n).toBeGreaterThan(0);
  });
});

describe("session-level context is never honoured across transactions", () => {
  it("SET app.tenant_id without a token matches nothing", async () => {
    const n = await asApp(async (c) => {
      await c.query(`SET app.tenant_id = '${A.tenantId}'`);
      return countEmployees(c);
    });
    expect(n).toBe(0);
  });

  it("set_config(..., false) for tenant and token stops working at the next transaction", async () => {
    await asApp(async (c) => {
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.tenant_id', $1, false),
                set_config('app.context_token', app.context_token(), false)`,
        [A.tenantId],
      );
      expect(await countEmployees(c)).toBeGreaterThan(0); // same transaction
      await c.query("COMMIT");

      // Session-level values are still present on the connection...
      const leftover = await c.query<{ t: string; tok: string }>(
        `SELECT current_setting('app.tenant_id', true) AS t,
                current_setting('app.context_token', true) AS tok`,
      );
      expect(leftover.rows[0]!.t).toBe(A.tenantId);
      // ...but the token belongs to the finished transaction, so RLS ignores them.
      expect(await countEmployees(c)).toBe(0);
      const ctx = await c.query(`SELECT app.current_tenant_id() AS t`);
      expect(ctx.rows[0].t).toBeNull();
    });
  });

  it("the token differs for every transaction on the same connection", async () => {
    const tokens = await asApp(async (c) => {
      const seen: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await c.query<{ t: string }>(
          `SELECT app.context_token() AS t`,
        );
        seen.push(r.rows[0]!.t);
      }
      return seen;
    });
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("a stale token copied from an earlier transaction is rejected", async () => {
    await asApp(async (c) => {
      const old = (
        await c.query<{ t: string }>(`SELECT app.context_token() AS t`)
      ).rows[0]!.t;
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.tenant_id', $1, true),
                set_config('app.context_token', $2, true)`,
        [A.tenantId, old],
      );
      expect(await countEmployees(c)).toBe(0);
      await c.query("ROLLBACK");
    });
  });
});

describe("compensating controls on the application role", () => {
  it("cannot persist a tenant as its own login default", async () => {
    await expect(
      asApp((c) =>
        c.query(`ALTER ROLE teamhappi_app SET app.tenant_id = '${A.tenantId}'`),
      ),
    ).rejects.toThrow(/permission denied/);
    const defaults = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT unnest(setconfig) AS setting FROM pg_db_role_setting
             WHERE setrole = 'teamhappi_app'::regrole`,
          )
        ).rows as { setting: string }[],
    );
    expect(defaults.filter((d) => d.setting.startsWith("app."))).toEqual([]);
  });

  it("cannot switch to a more privileged role", async () => {
    for (const sql of [
      `SET ROLE "${urls.migratorRole}"`,
      `SET SESSION AUTHORIZATION "${urls.migratorRole}"`,
    ]) {
      await expect(asApp((c) => c.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("cannot create temporary tables or functions to stage data", async () => {
    await expect(
      asApp((c) => c.query(`CREATE TEMP TABLE stash (x text)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp((c) =>
        c.query(
          `CREATE FUNCTION public.stash() RETURNS int LANGUAGE sql AS 'select 1'`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("long-running statements are cut off by the role's statement timeout", async () => {
    const timeout = await asApp(
      async (c) =>
        (
          await c.query<{ t: string }>(
            `SELECT current_setting('statement_timeout') AS t`,
          )
        ).rows[0]!.t,
    );
    expect(timeout).toBe("15s");
  });

  it("cannot hard-delete people or tenants even inside a valid context", async () => {
    await expect(
      asApp(async (c) => {
        await c.query("BEGIN");
        await c.query(
          `SELECT set_config('app.tenant_id', $1, true),
                  set_config('app.context_token', app.context_token(), true)`,
          [A.tenantId],
        );
        return c.query(`DELETE FROM employee`);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
