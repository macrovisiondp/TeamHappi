// Missing context, unauthorised membership and pooled-connection reuse.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { resolveTenantContext, withTenant } from "@/lib/tenancy";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "charlie");
  B = await createTenantFixture(db, "delta");
});

afterAll(async () => {
  await db.$disconnect();
});

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
  "user",
];

describe("missing tenant context (default deny)", () => {
  it("the application role sees zero rows in every protected table", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const table of TENANT_TABLES) {
        const r = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${table}"`,
        );
        expect(r.rows[0]!.n, table).toBe(0);
      }
    });
  });

  it("the context functions return NULL", async () => {
    const row = await withPg(
      urls.appUrl,
      async (c) =>
        (
          await c.query(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u`,
          )
        ).rows[0],
    );
    expect(row).toEqual({ t: null, u: null });
  });

  it("inserts without context are rejected", async () => {
    await expect(
      withPg(urls.appUrl, (c) =>
        c.query(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'NOCTX', 'x')`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("updates without context affect nothing", async () => {
    const r = await withPg(urls.appUrl, (c) =>
      c.query(`UPDATE employee SET given_name = 'X'`),
    );
    expect(r.rowCount).toBe(0);
  });

  it("a malformed tenant setting fails closed with an error", async () => {
    await expect(
      withPg(urls.appUrl, async (c) => {
        await c.query(`BEGIN`);
        await c.query(`SELECT set_config('app.tenant_id', 'garbage', true)`);
        return c.query(`SELECT count(*) FROM site`);
      }),
    ).rejects.toThrow(/invalid input syntax for type uuid/);
  });
});

describe("unauthorised membership", () => {
  it("resolves for an active member", async () => {
    const ctx = await resolveTenantContext(db, {
      userId: A.ownerUserId,
      tenantId: A.tenantId,
    });
    expect(ctx?.tenantId).toBe(A.tenantId);
  });

  it("does not resolve for a user with no membership", async () => {
    const stranger = await createUser("stranger");
    expect(
      await resolveTenantContext(db, {
        userId: stranger,
        tenantId: A.tenantId,
      }),
    ).toBeNull();
  });

  it.each(["invited", "suspended", "left"] as const)(
    "does not resolve for a %s membership",
    async (status) => {
      const user = await createUser(`member-${status}`);
      await admin((c) =>
        c.query(
          `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, $3)`,
          [A.tenantId, user, status],
        ),
      );
      expect(
        await resolveTenantContext(db, { userId: user, tenantId: A.tenantId }),
      ).toBeNull();
    },
  );

  it("does not resolve when the tenant is suspended, even for its owner", async () => {
    const C = await createTenantFixture(db, "echo");
    await admin((c) =>
      c.query(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [
        C.tenantId,
      ]),
    );
    expect(
      await resolveTenantContext(db, {
        userId: C.ownerUserId,
        tenantId: C.tenantId,
      }),
    ).toBeNull();
  });

  it("a user in two tenants gets separate contexts that each see only their tenant", async () => {
    const both = await createUser("both");
    await admin(async (c) => {
      for (const t of [A.tenantId, B.tenantId]) {
        await c.query(
          `INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1, $2)`,
          [t, both],
        );
      }
    });
    for (const fx of [A, B]) {
      const ctx = await resolveTenantContext(db, {
        userId: both,
        tenantId: fx.tenantId,
      });
      expect(ctx).not.toBeNull();
      const tenants = await withTenant(db, ctx!, (tx) =>
        tx.employee.findMany(),
      );
      expect(tenants.every((e) => e.tenantId === fx.tenantId)).toBe(true);
    }
  });
});

describe("connection reuse (pool of one connection)", () => {
  let single: DbClient;

  beforeAll(() => {
    single = appDb(1);
  });

  afterAll(async () => {
    await single.$disconnect();
  });

  const ctxFor = async (fx: TenantFixture) => {
    const ctx = await resolveTenantContext(single, {
      userId: fx.ownerUserId,
      tenantId: fx.tenantId,
    });
    if (!ctx) throw new Error("fixture context");
    return ctx;
  };

  it("context does not survive the transaction on the same connection", async () => {
    const ctxA = await ctxFor(A);
    const pids = new Set<number>();

    const inside = await withTenant(single, ctxA, async (tx) => {
      const [r] = await tx.$queryRaw<{ pid: number; t: string }[]>`
        SELECT pg_backend_pid() AS pid, app.current_tenant_id()::text AS t`;
      pids.add(r!.pid);
      return r!.t;
    });
    expect(inside).toBe(A.tenantId);

    const [after] = await single.$queryRaw<
      { pid: number; t: string | null; n: number }[]
    >`
      SELECT pg_backend_pid() AS pid, app.current_tenant_id()::text AS t,
             (SELECT count(*)::int FROM employee) AS n`;
    pids.add(after!.pid);

    expect(pids.size).toBe(1); // genuinely the same pooled connection
    expect(after!.t).toBeNull();
    expect(after!.n).toBe(0);
  });

  it("alternating tenants on one connection never mixes data", async () => {
    const ctxA = await ctxFor(A);
    const ctxB = await ctxFor(B);
    for (let i = 0; i < 5; i++) {
      for (const [ctx, fx] of [
        [ctxA, A],
        [ctxB, B],
      ] as const) {
        const ids = await withTenant(single, ctx, (tx) =>
          tx.employee.findMany({ select: { tenantId: true } }),
        );
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every((r) => r.tenantId === fx.tenantId)).toBe(true);
      }
    }
  });

  it("a failed transaction does not leak its context to the next query", async () => {
    const ctxA = await ctxFor(A);
    await expect(
      withTenant(single, ctxA, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const [after] = await single.$queryRaw<{ t: string | null }[]>`
      SELECT app.current_tenant_id()::text AS t`;
    expect(after!.t).toBeNull();
  });

  it("a session-level SET by rogue code is not how context works, and is cleared by our pattern", async () => {
    // Demonstrates why the app never uses session-level SET: it would persist.
    await withPg(urls.appUrl, async (c) => {
      await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [
        A.tenantId,
      ]);
      const leaked = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM employee`,
      );
      expect(leaked.rows[0]!.n).toBeGreaterThan(0); // session setting persists on this connection
    });
    // The application's transaction-local pattern does not persist (tests above).
  });
});

describe("concurrent transactions on a shared pool", () => {
  it("parallel requests for different tenants stay isolated", async () => {
    const pool = appDb(3);
    try {
      const ctxA = await resolveTenantContext(pool, {
        userId: A.ownerUserId,
        tenantId: A.tenantId,
      });
      const ctxB = await resolveTenantContext(pool, {
        userId: B.ownerUserId,
        tenantId: B.tenantId,
      });
      const runs = Array.from({ length: 12 }, (_, i) => {
        const [ctx, fx] = i % 2 ? [ctxB!, B] : [ctxA!, A];
        return withTenant(pool, ctx, async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(0.02)`;
          const rows = await tx.site.findMany({ select: { tenantId: true } });
          return (
            rows.every((r) => r.tenantId === fx.tenantId) && rows.length > 0
          );
        });
      });
      expect(await Promise.all(runs)).toEqual(Array(12).fill(true));
    } finally {
      await pool.$disconnect();
    }
  });
});
