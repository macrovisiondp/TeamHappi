// M4.1 organisation workspaces, run as the real application role:
// membership discovery, organisation selection, suspension and revocation,
// and site-scoped permission boundaries.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withUserContext } from "@/lib/tenancy";
import { dashboardData, getPerson, listPeople } from "@/lib/workspace/queries";
import {
  listMemberships,
  resolveWorkspace,
  type Workspace,
} from "@/lib/workspace/resolve";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let bSite2: string;
let bEmployeeAtSite2: string;
let workerUser: string;

const user = (userId: string) => ({
  userId,
  name: "Test User",
  email: "t@example.test",
});

async function ready(userId: string, preferred?: string): Promise<Ready> {
  const ws = await resolveWorkspace(db, user(userId), preferred);
  if (ws.kind !== "ready") throw new Error(`expected ready, got ${ws.kind}`);
  return ws;
}

async function addMember(
  tenantId: string,
  userId: string,
  roleKey: string,
  siteId: string | null,
  status = "active",
) {
  await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, userId, status],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $4 FROM role WHERE tenant_id = $1 AND key = $3`,
      [tenantId, m.rows[0]!.id, roleKey, siteId],
    );
  });
}

const setMembership = (tenantId: string, userId: string, status: string) =>
  admin((c) =>
    c.query(
      `UPDATE tenant_membership SET status = $3 WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId, status],
    ),
  );
const setTenant = (tenantId: string, status: string) =>
  admin((c) =>
    c.query(`UPDATE tenant SET status = $2 WHERE id = $1`, [tenantId, status]),
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "echo");
  B = await createTenantFixture(db, "foxtrot");
  // A second site in B with its own employee.
  ({ bSite2, bEmployeeAtSite2 } = await admin(async (c) => {
    const site = await c.query<{ id: string }>(
      `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'S2', 'Foxtrot Riverside') RETURNING id`,
      [B.tenantId],
    );
    const emp = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id)
       VALUES ($1, 'E-S2', 'Rae', 'Riverside', $2) RETURNING id`,
      [B.tenantId, site.rows[0]!.id],
    );
    return { bSite2: site.rows[0]!.id, bEmployeeAtSite2: emp.rows[0]!.id };
  }));
  // A's owner is also a site manager in B, scoped to B's first site only.
  await addMember(B.tenantId, A.ownerUserId, "site_manager", B.siteId);
  // A worker in A with no staff permissions.
  workerUser = await createUser("worker");
  await addMember(A.tenantId, workerUser, "worker", null);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("membership discovery: app.my_memberships()", () => {
  it("lists only the signed-in user's own memberships", async () => {
    const mine = await listMemberships(db, A.ownerUserId);
    expect(mine.map((m) => m.tenantId).sort()).toEqual(
      [A.tenantId, B.tenantId].sort(),
    );
    const theirs = await listMemberships(db, B.ownerUserId);
    expect(theirs.map((m) => m.tenantId)).toEqual([B.tenantId]);
  });

  it("returns nothing without a server-set user context", async () => {
    await withPg(urls.appUrl, async (c) => {
      const r = await c.query(`SELECT * FROM app.my_memberships()`);
      expect(r.rowCount).toBe(0);
      // A session-level setting without the transaction token is ignored too.
      await c.query(`SELECT set_config('app.user_id', $1, false)`, [
        A.ownerUserId,
      ]);
      expect(
        (await c.query(`SELECT * FROM app.my_memberships()`)).rowCount,
      ).toBe(0);
    });
  });

  it("exposes only the reviewed columns", async () => {
    const r = await withUserContext(
      db,
      A.ownerUserId,
      (tx) =>
        tx.$queryRaw<
          Record<string, unknown>[]
        >`SELECT * FROM app.my_memberships()`,
    );
    expect(Object.keys(r[0]!).sort()).toEqual(
      [
        "membership_status",
        "tenant_id",
        "tenant_name",
        "tenant_slug",
        "tenant_status",
      ].sort(),
    );
  });

  it("excludes left and invited memberships; reports suspended ones", async () => {
    const u = await createUser("statuses");
    await addMember(A.tenantId, u, "worker", null, "left");
    await addMember(B.tenantId, u, "worker", null, "invited");
    expect(await listMemberships(db, u)).toEqual([]);
    await setMembership(A.tenantId, u, "suspended");
    expect(
      (await listMemberships(db, u)).map((m) => m.membershipStatus),
    ).toEqual(["suspended"]);
  });

  it("only the application role may execute it", async () => {
    const rows = await admin((c) =>
      c.query<{ role: string; ok: boolean }>(
        `SELECT r AS role, has_function_privilege(r, 'app.my_memberships()', 'EXECUTE') AS ok
         FROM unnest(ARRAY['teamhappi_app', 'teamhappi_auth']) r`,
      ),
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.role, r.ok]))).toEqual({
      teamhappi_app: true,
      teamhappi_auth: false,
    });
    const publicCanExecute = await admin((c) =>
      c.query<{ ok: boolean }>(
        `SELECT bool_or(acl.grantee = 0) AS ok FROM pg_proc p, aclexplode(p.proacl) acl
         WHERE p.proname = 'my_memberships'`,
      ),
    );
    expect(publicCanExecute.rows[0]!.ok).toBe(false);
  });

  it("a user context alone sees no tenant data (default deny unchanged)", async () => {
    const counts = await withUserContext(db, A.ownerUserId, async (tx) => ({
      tenants: await tx.tenant.count(),
      employees: await tx.employee.count(),
      memberships: await tx.tenantMembership.count(),
    }));
    expect(counts).toEqual({ tenants: 0, employees: 0, memberships: 0 });
  });
});

describe("organisation selection", () => {
  it("one organisation is selected automatically", async () => {
    expect((await ready(B.ownerUserId)).tenant.id).toBe(B.tenantId);
  });

  it("several organisations without a valid preference ask the user to choose", async () => {
    const ws = await resolveWorkspace(db, user(A.ownerUserId), undefined);
    expect(ws.kind).toBe("choose");
  });

  it("honours a preference only for the user's own usable memberships", async () => {
    expect((await ready(A.ownerUserId, B.tenantId)).tenant.id).toBe(B.tenantId);
    // B's owner forging A's id (not a member) is ignored: stays in B.
    expect((await ready(B.ownerUserId, A.tenantId)).tenant.id).toBe(B.tenantId);
    expect((await ready(B.ownerUserId, "not-a-uuid")).tenant.id).toBe(
      B.tenantId,
    );
  });

  it("users with no organisation get the no-organisation state", async () => {
    const loner = await createUser("loner");
    expect(await resolveWorkspace(db, user(loner), A.tenantId)).toMatchObject({
      kind: "none",
      blocked: [],
    });
  });
});

describe("suspension and revocation take effect on the next request", () => {
  it("a suspended organisation is not usable", async () => {
    await setTenant(B.tenantId, "suspended");
    try {
      const ws = await resolveWorkspace(db, user(B.ownerUserId), B.tenantId);
      expect(ws.kind).toBe("none");
      if (ws.kind === "none")
        expect(ws.blocked[0]?.tenantStatus).toBe("suspended");
      // A's owner still has A (B is no longer a choice).
      expect((await ready(A.ownerUserId, B.tenantId)).tenant.id).toBe(
        A.tenantId,
      );
    } finally {
      await setTenant(B.tenantId, "active");
    }
  });

  it("a membership revoked between requests loses access", async () => {
    const u = await createUser("revoked");
    await addMember(A.tenantId, u, "hr_manager", null);
    expect((await ready(u)).tenant.id).toBe(A.tenantId);
    await setMembership(A.tenantId, u, "suspended");
    const ws = await resolveWorkspace(db, user(u), A.tenantId);
    expect(ws.kind).toBe("none");
    await setMembership(A.tenantId, u, "left");
    expect(await resolveWorkspace(db, user(u), A.tenantId)).toMatchObject({
      kind: "none",
      blocked: [],
    });
  });
});

describe("permission boundaries", () => {
  it("an organisation-wide role sees all of its organisation's people, and only those", async () => {
    const ws = await ready(B.ownerUserId);
    const result = await listPeople(db, ws);
    const ids = result!.people.map((p) => p.id).sort();
    expect(ids).toEqual([B.employeeId, bEmployeeAtSite2].sort());
    expect(ids).not.toContain(A.employeeId);
  });

  it("a site-scoped role sees only people at its sites, in lists and by id", async () => {
    const ws = await ready(A.ownerUserId, B.tenantId);
    expect(ws.roles).toEqual(["Site manager"]);
    const result = await listPeople(db, ws);
    expect(result!.people.map((p) => p.id)).toEqual([B.employeeId]);
    expect(await getPerson(db, ws, B.employeeId)).not.toBeNull();
    expect(await getPerson(db, ws, bEmployeeAtSite2)).toBeNull();
    const dash = await dashboardData(db, ws);
    expect(dash.sites.map((s) => s.id)).toEqual([B.siteId]);
    expect(dash.sites.map((s) => s.id)).not.toContain(bSite2);
  });

  it("another organisation's person is not found, even with a guessed id", async () => {
    const ws = await ready(B.ownerUserId);
    expect(await getPerson(db, ws, A.employeeId)).toBeNull();
    expect(await getPerson(db, ws, "../../etc")).toBeNull();
  });

  it("a role without employee.view sees no people", async () => {
    const ws = await ready(workerUser);
    expect(await listPeople(db, ws)).toBeNull();
    expect(await getPerson(db, ws, A.employeeId)).toBeNull();
    const dash = await dashboardData(db, ws);
    expect(dash).toMatchObject({
      canViewPeople: false,
      canViewSites: false,
      sites: [],
    });
  });

  it("the owner's dashboard counts only its own organisation", async () => {
    const ws = await ready(B.ownerUserId);
    const dash = await dashboardData(db, ws);
    expect(dash.counts.sites).toBe(2);
    expect(dash.canViewPeople).toBe(true);
  });
});
