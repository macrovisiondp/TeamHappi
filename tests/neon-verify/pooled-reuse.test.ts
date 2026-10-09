// Neon only: tenant context through the PgBouncer pooled endpoint.
//
// 200 tenant-scoped transactions alternate between two tenants on a pool of two
// client connections, each followed by a context-free query. Every iteration is
// recorded (failures are classified, not thrown immediately) so the report shows
// how many transactions completed, any cross-tenant visibility, any leaked
// context, and how server backends were shared. All security assertions are
// evaluated at the end over the full run.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import {
  resolveTenantContext,
  withTenant,
  type TenantContext,
} from "@/lib/tenancy";

import { appDb, createTenantFixture, type TenantFixture } from "../helpers/db";
import {
  classifyFailure,
  type FailureCategory,
} from "../helpers/verify-diagnostics";

const TRANSACTIONS = 200;

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
  it(
    `${TRANSACTIONS} interleaved transactions never leak context`,
    { timeout: 45 * 60_000 },
    async () => {
      const ctx: Record<string, TenantContext> = {
        [A.tenantId]: (await resolveTenantContext(db, {
          userId: A.ownerUserId,
          tenantId: A.tenantId,
        }))!,
        [B.tenantId]: (await resolveTenantContext(db, {
          userId: B.ownerUserId,
          tenantId: B.tenantId,
        }))!,
      };

      let completed = 0;
      let crossTenantVisibility = 0; // rows from the other tenant inside a scoped transaction
      let emptyScopedResults = 0; // a scoped transaction that saw none of its own rows
      let leakedContext = 0; // a context-free query that saw a tenant or any rows
      const errors: Partial<Record<FailureCategory, number>> = {};
      const tenantsPerBackend = new Map<number, Set<string>>();
      const plainBackends = new Set<number>();
      const started = Date.now();

      for (let i = 0; i < TRANSACTIONS; i++) {
        const tenantId = i % 2 === 0 ? A.tenantId : B.tenantId;
        try {
          const { pid, rows } = await withTenant(
            db,
            ctx[tenantId]!,
            async (tx) => {
              const [r] = await tx.$queryRaw<
                { pid: number }[]
              >`SELECT pg_backend_pid() AS pid`;
              const found = await tx.employee.findMany({
                select: { tenantId: true },
              });
              return { pid: r!.pid, rows: found };
            },
          );
          if (!tenantsPerBackend.has(pid))
            tenantsPerBackend.set(pid, new Set());
          tenantsPerBackend.get(pid)!.add(tenantId);
          if (rows.length === 0) emptyScopedResults++;
          crossTenantVisibility += rows.filter(
            (r) => r.tenantId !== tenantId,
          ).length;

          const [plain] = await db.$queryRaw<
            { pid: number; t: string | null; n: number }[]
          >`SELECT pg_backend_pid() AS pid, app.current_tenant_id()::text AS t,
                   (SELECT count(*)::int FROM employee) AS n`;
          plainBackends.add(plain!.pid);
          if (plain!.t !== null || plain!.n !== 0) leakedContext++;
          completed++;
        } catch (error) {
          const category = classifyFailure(error);
          errors[category] = (errors[category] ?? 0) + 1;
        }
      }

      const sharedAcrossTenants = [...tenantsPerBackend.values()].filter(
        (tenants) => tenants.size > 1,
      ).length;
      const summary = {
        transactions: TRANSACTIONS,
        completed,
        crossTenantVisibility,
        emptyScopedResults,
        leakedContext,
        errors,
        scopedBackends: tenantsPerBackend.size,
        backendsServingBothTenants: sharedAcrossTenants,
        plainQueryBackends: plainBackends.size,
        seconds: Math.round((Date.now() - started) / 1000),
      };
      console.log(`[pooled-reuse] ${JSON.stringify(summary)}`);

      // Security assertions over the whole run.
      expect(summary.errors).toEqual({});
      expect(completed).toBe(TRANSACTIONS);
      expect(crossTenantVisibility).toBe(0);
      expect(emptyScopedResults).toBe(0);
      expect(leakedContext).toBe(0);
      // The test is only meaningful if server connections really were reused,
      // including by both tenants.
      expect(tenantsPerBackend.size).toBeLessThan(TRANSACTIONS);
      expect(sharedAcrossTenants).toBeGreaterThan(0);
    },
  );
});
