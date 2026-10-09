import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { resolveTenantContext, withTenant } from "@/lib/tenancy";
import { createTenant } from "@/platform/tenancy/create-tenant";

import { appDb, createUser } from "../helpers/db";

let db: DbClient;

beforeAll(() => {
  db = appDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("createTenant", () => {
  it("creates the tenant, default roles and an owner membership in one transaction", async () => {
    const owner = await createUser("founder");
    const { tenant } = await createTenant(db, {
      slug: `foxtrot-${Date.now()}`,
      legalName: "Foxtrot Dining Ltd",
      ownerUserId: owner,
    });

    const ctx = await resolveTenantContext(db, {
      userId: owner,
      tenantId: tenant.id,
    });
    expect(ctx).not.toBeNull();

    const state = await withTenant(db, ctx!, async (tx) => ({
      roles: await tx.role.findMany({
        include: { permissions: true },
        orderBy: { key: "asc" },
      }),
      assignments: await tx.roleAssignment.findMany({
        include: { role: true },
      }),
    }));

    expect(state.roles.map((r) => r.key).sort()).toEqual(
      SYSTEM_ROLES.map((r) => r.key).sort(),
    );
    for (const def of SYSTEM_ROLES) {
      const role = state.roles.find((r) => r.key === def.key)!;
      expect(role.permissions.map((p) => p.permissionCode).sort()).toEqual(
        [...def.permissions].sort(),
      );
    }
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0]!.role.key).toBe("owner");
    expect(state.assignments[0]!.siteId).toBeNull();
  });

  it("rejects invalid input before touching the database", async () => {
    const owner = await createUser("bad-input");
    await expect(
      createTenant(db, {
        slug: "Not A Slug!",
        legalName: "X",
        ownerUserId: owner,
      }),
    ).rejects.toThrow();
    await expect(
      createTenant(db, {
        slug: "valid-slug",
        legalName: "X",
        ownerUserId: "nope",
      }),
    ).rejects.toThrow();
  });

  it("rolls back completely when any step fails (unknown owner)", async () => {
    const slug = `ghost-${Date.now()}`;
    await expect(
      createTenant(db, {
        slug,
        legalName: "Ghost Ltd",
        ownerUserId: "01900000-0000-7000-8000-000000000000",
      }),
    ).rejects.toThrow(/foreign key/i);
    const owner = await createUser("retry");
    // The slug is free again because nothing was committed.
    await expect(
      createTenant(db, { slug, legalName: "Ghost Ltd", ownerUserId: owner }),
    ).resolves.toBeTruthy();
  });

  it("rejects a duplicate slug", async () => {
    const slug = `golf-${Date.now()}`;
    await createTenant(db, {
      slug,
      legalName: "Golf",
      ownerUserId: await createUser("g1"),
    });
    await expect(
      createTenant(db, {
        slug,
        legalName: "Golf 2",
        ownerUserId: await createUser("g2"),
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
