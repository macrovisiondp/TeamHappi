// Cross-tenant isolation through the real application path:
// Prisma client as teamhappi_app -> withTenant() -> PostgreSQL RLS.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  resolveTenantContext,
  withTenant,
  type TenantContext,
} from "@/lib/tenancy";
import type { DbClient } from "@/lib/db/create-client";

import { appDb, createTenantFixture, type TenantFixture } from "../helpers/db";

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let ctxA: TenantContext;

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "alpha");
  B = await createTenantFixture(db, "bravo");
  const resolved = await resolveTenantContext(db, {
    userId: A.ownerUserId,
    tenantId: A.tenantId,
  });
  if (!resolved) throw new Error("fixture: owner of A must resolve");
  ctxA = resolved;
});

afterAll(async () => {
  await db.$disconnect();
});

const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, ctxA, fn);

describe("cross-tenant reads", () => {
  it("lists only the current tenant's rows in every tenant-owned table", async () => {
    const seen = await inA(async (tx) => ({
      tenants: await tx.tenant.findMany({ select: { id: true } }),
      memberships: await tx.tenantMembership.findMany({
        select: { tenantId: true },
      }),
      roles: await tx.role.findMany({ select: { tenantId: true } }),
      rolePermissions: await tx.rolePermission.findMany({
        select: { tenantId: true },
      }),
      roleAssignments: await tx.roleAssignment.findMany({
        select: { tenantId: true },
      }),
      sites: await tx.site.findMany({ select: { tenantId: true } }),
      teams: await tx.team.findMany({ select: { tenantId: true } }),
      teamMembers: await tx.teamMember.findMany({ select: { tenantId: true } }),
      employees: await tx.employee.findMany({ select: { tenantId: true } }),
      documents: await tx.document.findMany({ select: { tenantId: true } }),
    }));

    expect(seen.tenants).toEqual([{ id: A.tenantId }]);
    for (const [table, rows] of Object.entries(seen)) {
      if (table === "tenants") continue;
      expect(rows.length, table).toBeGreaterThan(0);
      expect(
        rows.every((r) => (r as { tenantId: string }).tenantId === A.tenantId),
        table,
      ).toBe(true);
    }
  });

  it("returns nothing when looking up another tenant's records by id", async () => {
    const found = await inA(async (tx) => ({
      tenant: await tx.tenant.findUnique({ where: { id: B.tenantId } }),
      site: await tx.site.findUnique({ where: { id: B.siteId } }),
      employee: await tx.employee.findUnique({ where: { id: B.employeeId } }),
      document: await tx.document.findUnique({ where: { id: B.documentId } }),
      count: await tx.employee.count({ where: { tenantId: B.tenantId } }),
    }));
    expect(found).toEqual({
      tenant: null,
      site: null,
      employee: null,
      document: null,
      count: 0,
    });
  });

  it("does not expose other tenants' users", async () => {
    const users = await inA((tx) => tx.user.findMany({ select: { id: true } }));
    expect(users.map((u) => u.id)).toEqual([A.ownerUserId]);
  });
});

describe("cross-tenant joins", () => {
  it("relation includes never pull another tenant's rows", async () => {
    const employees = await inA((tx) =>
      tx.employee.findMany({
        include: {
          primarySite: true,
          teams: { include: { team: true } },
          documents: true,
        },
      }),
    );
    for (const e of employees) {
      expect(e.primarySite?.tenantId ?? A.tenantId).toBe(A.tenantId);
      for (const t of e.teams) expect(t.team.tenantId).toBe(A.tenantId);
      for (const d of e.documents) expect(d.tenantId).toBe(A.tenantId);
    }
  });

  it("raw SQL joins are filtered by RLS on every joined table", async () => {
    const rows = await inA(
      (tx) => tx.$queryRaw<{ employee_tenant: string; site_tenant: string }[]>`
        SELECT e.tenant_id::text AS employee_tenant, s.tenant_id::text AS site_tenant
        FROM employee e CROSS JOIN site s`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) => r.employee_tenant === A.tenantId && r.site_tenant === A.tenantId,
      ),
    ).toBe(true);
  });

  it("a join keyed on another tenant's id finds nothing", async () => {
    const rows = await inA(
      (tx) => tx.$queryRaw<unknown[]>`
        SELECT 1 FROM team_member tm JOIN employee e
          ON e.tenant_id = tm.tenant_id AND e.id = tm.employee_id
        WHERE e.id = ${B.employeeId}::uuid`,
    );
    expect(rows).toEqual([]);
  });
});

describe("cross-tenant writes", () => {
  it("cannot update another tenant's rows (looks like not found)", async () => {
    await expect(
      inA((tx) =>
        tx.employee.update({
          where: { id: B.employeeId },
          data: { givenName: "X" },
        }),
      ),
    ).rejects.toMatchObject({ code: "P2025" });
    const many = await inA((tx) =>
      tx.site.updateMany({
        where: { id: B.siteId },
        data: { name: "Hijacked" },
      }),
    );
    expect(many.count).toBe(0);
  });

  it("cannot delete another tenant's rows", async () => {
    const deleted = await inA((tx) =>
      tx.roleAssignment.deleteMany({ where: { id: B.roleAssignmentId } }),
    );
    expect(deleted.count).toBe(0);
  });

  it("cannot insert rows carrying another tenant's id", async () => {
    await expect(
      inA((tx) =>
        tx.site.create({
          data: { tenantId: B.tenantId, code: "EVIL", name: "Evil" },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot move a row into another tenant", async () => {
    await expect(
      inA((tx) =>
        tx.site.update({
          where: { id: A.siteId },
          data: { tenantId: B.tenantId },
        }),
      ),
    ).rejects.toThrow(/row-level security|foreign key/i);
  });

  it("cannot rename another tenant", async () => {
    const res = await inA((tx) =>
      tx.tenant.updateMany({
        where: { id: B.tenantId },
        data: { legalName: "Hijacked" },
      }),
    );
    expect(res.count).toBe(0);
  });
});

describe("cross-tenant references (composite foreign keys)", () => {
  it("cannot link a tenant's employee to another tenant's site", async () => {
    await expect(
      inA((tx) =>
        tx.employee.create({
          data: {
            tenantId: A.tenantId,
            employeeNumber: "X-1",
            givenName: "Eve",
            familyName: "Mallory",
            primarySiteId: B.siteId,
          },
        }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("cannot assign a role scoped to another tenant's site", async () => {
    const [membership, role] = await inA(async (tx) => [
      await tx.tenantMembership.findFirstOrThrow(),
      await tx.role.findFirstOrThrow({ where: { key: "site_manager" } }),
    ]);
    await expect(
      inA((tx) =>
        tx.roleAssignment.create({
          data: {
            tenantId: A.tenantId,
            membershipId: membership.id,
            roleId: role.id,
            siteId: B.siteId,
          },
        }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("cannot add another tenant's employee to a team", async () => {
    await expect(
      inA((tx) =>
        tx.teamMember.create({
          data: {
            tenantId: A.tenantId,
            teamId: A.teamId,
            employeeId: B.employeeId,
          },
        }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe("file references", () => {
  const doc = (overrides: Record<string, unknown>) => ({
    tenantId: A.tenantId,
    ownerEmployeeId: A.employeeId,
    docType: "certificate",
    sensitivity: "standard" as const,
    storageKey: `tenants/${A.tenantId}/documents/ok-${Date.now()}`,
    mimeType: "application/pdf",
    sizeBytes: 10,
    ...overrides,
  });

  it("accepts a document inside the tenant's own storage prefix", async () => {
    const created = await inA((tx) => tx.document.create({ data: doc({}) }));
    expect(created.tenantId).toBe(A.tenantId);
  });

  it("rejects a storage key pointing into another tenant's prefix", async () => {
    await expect(
      inA((tx) =>
        tx.document.create({
          data: doc({ storageKey: `tenants/${B.tenantId}/documents/stolen` }),
        }),
      ),
    ).rejects.toThrow(/document_storage_key_tenant_prefix|check constraint/i);
  });

  it("rejects path tricks that only start with the tenant's prefix text", async () => {
    await expect(
      inA((tx) =>
        tx.document.create({
          data: doc({ storageKey: `tenants/${A.tenantId}../${B.tenantId}/x` }),
        }),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects a document attached to another tenant's employee", async () => {
    await expect(
      inA((tx) =>
        tx.document.create({ data: doc({ ownerEmployeeId: B.employeeId }) }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("cannot re-point an existing document to another tenant's file", async () => {
    await expect(
      inA((tx) =>
        tx.document.update({
          where: { id: A.documentId },
          data: { storageKey: `tenants/${B.tenantId}/documents/stolen` },
        }),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("manipulated identifiers", () => {
  it("resolveTenantContext rejects malformed ids without querying", async () => {
    for (const tenantId of [
      "",
      "not-a-uuid",
      "' OR 1=1 --",
      `${A.tenantId}'`,
      "00000000",
    ]) {
      expect(
        await resolveTenantContext(db, { userId: A.ownerUserId, tenantId }),
      ).toBeNull();
    }
  });

  it("asking for another tenant's id as a non-member yields no context", async () => {
    expect(
      await resolveTenantContext(db, {
        userId: A.ownerUserId,
        tenantId: B.tenantId,
      }),
    ).toBeNull();
  });

  it("withTenant refuses a forged context object", async () => {
    const forged = {
      tenantId: B.tenantId,
      userId: A.ownerUserId,
    } as unknown as TenantContext;
    await expect(withTenant(db, forged, async () => "ran")).rejects.toThrow(
      /TenantContext/,
    );
  });

  it("an injected value in a filter is treated as data, not SQL", async () => {
    const rows = await inA((tx) =>
      tx.site.findMany({ where: { code: `' OR tenant_id = '${B.tenantId}` } }),
    );
    expect(rows).toEqual([]);
  });
});
