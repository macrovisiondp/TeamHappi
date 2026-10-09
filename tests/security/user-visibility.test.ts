// The `user_visible` policy: the app sees the signed-in user and ACTIVE members
// of the current tenant only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import {
  resolveTenantContext,
  withTenant,
  type TenantContext,
} from "@/lib/tenancy";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  type TenantFixture,
} from "../helpers/db";

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let ctxA: TenantContext;
const members: Record<string, string> = {};

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "mike");
  B = await createTenantFixture(db, "november");
  for (const status of ["active", "invited", "suspended", "left"] as const) {
    const user = await createUser(`vis-${status}`);
    members[status] = user;
    await admin((c) =>
      c.query(
        `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, $3)`,
        [A.tenantId, user, status],
      ),
    );
  }
  ctxA = (await resolveTenantContext(db, {
    userId: A.ownerUserId,
    tenantId: A.tenantId,
  }))!;
});

afterAll(async () => {
  await db.$disconnect();
});

const visibleIds = (ctx: TenantContext) =>
  withTenant(db, ctx, async (tx) =>
    (await tx.user.findMany({ select: { id: true } })).map((u) => u.id),
  );

describe("user_visible policy", () => {
  it("shows active members of the current tenant", async () => {
    const ids = await visibleIds(ctxA);
    expect(ids).toContain(A.ownerUserId);
    expect(ids).toContain(members.active);
  });

  it.each(["invited", "suspended", "left"])(
    "hides %s members' user records",
    async (status) => {
      expect(await visibleIds(ctxA)).not.toContain(members[status]);
    },
  );

  it("still shows the membership row itself to the tenant (for administration)", async () => {
    const statuses = await withTenant(db, ctxA, async (tx) =>
      (
        await tx.tenantMembership.findMany({
          where: { userId: { in: Object.values(members) } },
          select: { status: true },
        })
      ).map((m) => m.status),
    );
    expect(statuses.sort()).toEqual(["active", "invited", "left", "suspended"]);
  });

  it("never shows another tenant's members", async () => {
    expect(await visibleIds(ctxA)).not.toContain(B.ownerUserId);
  });

  it("a member whose membership becomes suspended disappears from view", async () => {
    const user = await createUser("vis-transition");
    await admin((c) =>
      c.query(
        `INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1, $2)`,
        [A.tenantId, user],
      ),
    );
    expect(await visibleIds(ctxA)).toContain(user);
    await admin((c) =>
      c.query(
        `UPDATE tenant_membership SET status = 'suspended' WHERE tenant_id = $1 AND user_id = $2`,
        [A.tenantId, user],
      ),
    );
    expect(await visibleIds(ctxA)).not.toContain(user);
  });
});
