import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { resolveTenantContext, withTenant } from "@/lib/tenancy";
import { createTenant } from "@/platform/tenancy/create-tenant";

import {
  issuePlatformStaffActorForTests,
  PlatformAuthorisationError,
  type PlatformStaffActor,
} from "@/platform/authz/internal";

import { admin, appDb, createUser, platformStaff } from "../helpers/db";

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
    const { tenant } = await createTenant(db, platformStaff, {
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
      createTenant(db, platformStaff, {
        slug: "Not A Slug!",
        legalName: "X",
        ownerUserId: owner,
      }),
    ).rejects.toThrow();
    await expect(
      createTenant(db, platformStaff, {
        slug: "valid-slug",
        legalName: "X",
        ownerUserId: "nope",
      }),
    ).rejects.toThrow();
  });

  it("rolls back completely when any step fails (unknown owner)", async () => {
    const slug = `ghost-${Date.now()}`;
    await expect(
      createTenant(db, platformStaff, {
        slug,
        legalName: "Ghost Ltd",
        ownerUserId: "01900000-0000-7000-8000-000000000000",
      }),
    ).rejects.toThrow(/foreign key/i);
    const owner = await createUser("retry");
    // The slug is free again because nothing was committed.
    await expect(
      createTenant(db, platformStaff, {
        slug,
        legalName: "Ghost Ltd",
        ownerUserId: owner,
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects a duplicate slug", async () => {
    const slug = `golf-${Date.now()}`;
    await createTenant(db, platformStaff, {
      slug,
      legalName: "Golf",
      ownerUserId: await createUser("g1"),
    });
    await expect(
      createTenant(db, platformStaff, {
        slug,
        legalName: "Golf 2",
        ownerUserId: await createUser("g2"),
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("createTenant authorisation (platform staff only)", () => {
  const tenantsWithSlug = (slug: string) =>
    admin(
      async (c) =>
        (await c.query(`SELECT 1 FROM tenant WHERE slug = $1`, [slug]))
          .rowCount,
    );

  const cases: [string, unknown][] = [
    ["no actor", undefined],
    ["null actor", null],
    [
      "plain object posing as staff",
      { userId: "x", grants: ["tenant.create"] },
    ],
    [
      "staff without the tenant.create grant",
      issuePlatformStaffActorForTests(
        "01900000-0000-7000-8000-000000000002",
        [],
      ),
    ],
  ];

  it.each(cases)(
    "rejects %s before touching the database",
    async (_label, actor) => {
      const slug = `denied-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await expect(
        createTenant(db, actor as PlatformStaffActor, {
          slug,
          legalName: "Should Not Exist Ltd",
          ownerUserId: await createUser("denied"),
        }),
      ).rejects.toBeInstanceOf(PlatformAuthorisationError);
      expect(await tenantsWithSlug(slug)).toBe(0);
    },
  );

  it("the test issuer refuses to work outside the test runner", () => {
    const previous = process.env.VITEST;
    process.env.VITEST = "false";
    try {
      expect(() =>
        issuePlatformStaffActorForTests("x", ["tenant.create"]),
      ).toThrow(PlatformAuthorisationError);
    } finally {
      process.env.VITEST = previous;
    }
  });
});
