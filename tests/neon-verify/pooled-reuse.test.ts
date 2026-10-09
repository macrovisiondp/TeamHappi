// Neon only: tenant context through the PgBouncer pooled endpoint.
// Interleaves tenant-scoped transactions with context-free queries on a small
// pool, so server connections are reused across tenants, and checks that no
// query ever sees another tenant's rows or a leftover context.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { resolveTenantContext, withTenant } from "@/lib/tenancy";

import { appDb, createTenantFixture, type TenantFixture } from "../helpers/db";

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  db = appDb(2);
  A = await createTenantFixture(db, "verify-a");
  B = await createTenantFixture(db, "verify-b");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("pooled connection reuse on Neon", () => {
  it("200 interleaved transactions never leak context", async () => {
    const ctxA = (await resolveTenantContext(db, {
      userId: A.ownerUserId,
      tenantId: A.tenantId,
    }))!;
    const ctxB = (await resolveTenantContext(db, {
      userId: B.ownerUserId,
      tenantId: B.tenantId,
    }))!;
    const backends = new Set<number>();
    let leaks = 0;

    for (let i = 0; i < 100; i++) {
      for (const [ctx, fx] of [
        [ctxA, A],
        [ctxB, B],
      ] as const) {
        const rows = await withTenant(db, ctx, async (tx) => {
          const [r] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          backends.add(r!.pid);
          return tx.employee.findMany({ select: { tenantId: true } });
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.tenantId === fx.tenantId)).toBe(true);

        const [plain] = await db.$queryRaw<{ t: string | null; n: number }[]>`
          SELECT app.current_tenant_id()::text AS t, (SELECT count(*)::int FROM employee) AS n`;
        if (plain!.t !== null || plain!.n !== 0) leaks++;
      }
    }

    expect(leaks).toBe(0);
    // Evidence that server connections really were shared across tenants.
    console.log(`server backends used for 200 transactions: ${backends.size}`);
    expect(backends.size).toBeLessThan(200);
  });
});
