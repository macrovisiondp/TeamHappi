// M4.2 organisation setup, run as the real application role: creating and
// editing sites, teams and employees; duplicates and invalid input;
// cross-tenant attempts; site-level permission boundaries; column-level
// privileges; dashboard accuracy.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant } from "@/lib/tenancy";
import * as m from "@/lib/workspace/mutations";
import { dashboardData, listPeople } from "@/lib/workspace/queries";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let hr: Ready; // HR manager scoped to A's first site
let siteManager: Ready; // site manager scoped to A's first site
let site2: string; // A's second site (outside the scoped roles)

const user = (userId: string) => ({
  userId,
  name: "U",
  email: "u@example.test",
});

async function ready(userId: string): Promise<Ready> {
  const ws = await resolveWorkspace(db, user(userId), undefined);
  if (ws.kind !== "ready") throw new Error(`expected ready, got ${ws.kind}`);
  return ws;
}

async function memberWithRole(
  tenantId: string,
  roleKey: string,
  siteId: string | null,
) {
  const userId = await createUser(roleKey.replace("_", ""));
  await admin(async (c) => {
    const mem = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $4 FROM role WHERE tenant_id = $1 AND key = $3`,
      [tenantId, mem.rows[0]!.id, roleKey, siteId],
    );
  });
  return userId;
}

const ok = <T>(r: m.MutationResult<T>) => {
  if (!r.ok)
    throw new Error(`${r.code}: ${r.message} ${JSON.stringify(r.fieldErrors)}`);
  return r.data;
};

const person = (extra: Record<string, unknown> = {}) => ({
  givenName: "Sam",
  familyName: "Okafor",
  status: "active",
  startDate: "2026-09-01",
  teamIds: [],
  ...extra,
});

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "golf");
  B = await createTenantFixture(db, "hotel");
  owner = await ready(A.ownerUserId);
  site2 = ok(
    await m.createSite(db, owner, {
      name: "Golf Harbour",
      timezone: "Europe/London",
    }),
  ).id;
  hr = await ready(await memberWithRole(A.tenantId, "hr_manager", A.siteId));
  siteManager = await ready(
    await memberWithRole(A.tenantId, "site_manager", A.siteId),
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("organisation settings", () => {
  it("an owner updates the name and time zone", async () => {
    ok(
      await m.updateOrganisation(db, owner, {
        name: "Golf Group",
        timezone: "Europe/Dublin",
      }),
    );
    const row = await admin((c) =>
      c.query(`SELECT legal_name, timezone FROM tenant WHERE id = $1`, [
        A.tenantId,
      ]),
    );
    expect(row.rows[0]).toEqual({
      legal_name: "Golf Group",
      timezone: "Europe/Dublin",
    });
  });

  it("rejects invalid values and roles without tenant.settings.manage", async () => {
    expect(
      await m.updateOrganisation(db, owner, {
        name: " ",
        timezone: "Mars/Base",
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid",
      fieldErrors: { name: expect.any(String), timezone: expect.any(String) },
    });
    expect(
      await m.updateOrganisation(db, hr, {
        name: "X",
        timezone: "Europe/London",
      }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("the app role cannot change an organisation's status or slug (column privileges)", async () => {
    await expect(
      withTenant(db, owner.ctx, (tx) =>
        tx.tenant.update({
          where: { id: A.tenantId },
          data: { status: "suspended" },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(db, owner.ctx, (tx) =>
        tx.tenant.update({
          where: { id: A.tenantId },
          data: { slug: "stolen" },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("sites", () => {
  it("creates a site with a generated, unique code and location", async () => {
    const id = ok(
      await m.createSite(db, owner, {
        name: "Golf Harbour",
        addressLine: "1 Quay Street",
        town: "Bristol",
        postcode: "bs1 4dj",
        timezone: "Europe/London",
      }),
    ).id;
    const row = await admin((c) =>
      c.query(`SELECT code, postcode, town FROM site WHERE id = $1`, [id]),
    );
    expect(row.rows[0]).toEqual({
      code: "GOLFHARB-2",
      postcode: "BS1 4DJ",
      town: "Bristol",
    });
  });

  it("reports a duplicate code and invalid fields", async () => {
    ok(
      await m.createSite(db, owner, {
        name: "Dup One",
        code: "DUP",
        timezone: "Europe/London",
      }),
    );
    expect(
      await m.createSite(db, owner, {
        name: "Dup Two",
        code: "dup",
        timezone: "Europe/London",
      }),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      fieldErrors: { code: expect.any(String) },
    });
    expect(
      await m.createSite(db, owner, {
        name: "",
        postcode: "!!",
        timezone: "Europe/London",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("site-scoped roles cannot add sites or edit sites they don't manage", async () => {
    expect(
      await m.createSite(db, siteManager, {
        name: "Rogue",
        timezone: "Europe/London",
      }),
    ).toMatchObject({
      code: "forbidden",
    });
    expect(
      await m.updateSite(db, siteManager, site2, {
        name: "Renamed",
        timezone: "Europe/London",
      }),
    ).toMatchObject({ code: "forbidden" });
    expect(await m.setSiteStatus(db, hr, A.siteId, "archived")).toMatchObject({
      code: "forbidden",
    });
  });

  it("another organisation's site looks missing, even to an owner", async () => {
    expect(
      await m.updateSite(db, owner, B.siteId, {
        name: "Hijack",
        timezone: "Europe/London",
      }),
    ).toMatchObject({ code: "not_found" });
    expect(
      await m.setSiteStatus(db, owner, B.siteId, "archived"),
    ).toMatchObject({ code: "not_found" });
    const b = await admin((c) =>
      c.query(`SELECT name, status FROM site WHERE id = $1`, [B.siteId]),
    );
    expect(b.rows[0].status).toBe("active");
  });

  it("archives and reactivates instead of deleting", async () => {
    const id = ok(
      await m.createSite(db, owner, {
        name: "Pop-up",
        timezone: "Europe/London",
      }),
    ).id;
    ok(await m.setSiteStatus(db, owner, id, "archived"));
    expect(
      await m.createTeam(db, owner, { name: "Bar", siteId: id }),
    ).toMatchObject({
      code: "invalid",
      fieldErrors: { siteId: expect.any(String) },
    });
    ok(await m.setSiteStatus(db, owner, id, "active"));
    ok(await m.createTeam(db, owner, { name: "Bar", siteId: id }));
  });
});

describe("teams", () => {
  it("a site manager adds and renames teams at their own site only", async () => {
    const team = ok(
      await m.createTeam(db, siteManager, { name: "Pastry", siteId: A.siteId }),
    ).id;
    ok(
      await m.updateTeam(db, siteManager, team, {
        name: "Pastry & Bakery",
        siteId: A.siteId,
      }),
    );
    expect(
      await m.createTeam(db, siteManager, { name: "Rogue", siteId: site2 }),
    ).toMatchObject({
      code: "forbidden",
    });
    expect(
      await m.updateTeam(db, siteManager, team, {
        name: "Moved",
        siteId: site2,
      }),
    ).toMatchObject({
      code: "forbidden",
    });
  });

  it("rejects duplicate names at a site and cross-organisation sites", async () => {
    ok(
      await m.createTeam(db, owner, { name: "Front of house", siteId: site2 }),
    );
    expect(
      await m.createTeam(db, owner, { name: "Front of house", siteId: site2 }),
    ).toMatchObject({
      code: "conflict",
    });
    expect(
      await m.createTeam(db, owner, { name: "Spy", siteId: B.siteId }),
    ).toMatchObject({
      code: "invalid",
    });
    expect(await m.setTeamArchived(db, owner, B.teamId, true)).toMatchObject({
      code: "not_found",
    });
  });
});

describe("employees", () => {
  it("creates people with generated numbers, job titles and teams", async () => {
    const id = ok(
      await m.createEmployee(
        db,
        owner,
        person({
          jobTitle: "Sous chef",
          primarySiteId: A.siteId,
          teamIds: [A.teamId],
        }),
      ),
    ).id;
    const row = await admin((c) =>
      c.query(
        `SELECT e.employee_number, e.job_title, e.membership_id, count(tm.*)::int AS teams
         FROM employee e LEFT JOIN team_member tm ON tm.employee_id = e.id
         WHERE e.id = $1 GROUP BY e.id`,
        [id],
      ),
    );
    expect(row.rows[0]).toMatchObject({
      job_title: "Sous chef",
      membership_id: null,
      teams: 1,
    });
    expect(row.rows[0].employee_number).toMatch(/^E\d{4}$/);
  });

  it("validates dates, status and duplicates", async () => {
    expect(
      await m.createEmployee(db, owner, person({ status: "left" })),
    ).toMatchObject({
      code: "invalid",
      fieldErrors: { endDate: expect.any(String) },
    });
    expect(
      await m.createEmployee(
        db,
        owner,
        person({
          startDate: "2026-09-10",
          endDate: "2026-09-01",
          status: "left",
        }),
      ),
    ).toMatchObject({ code: "invalid" });
    expect(
      await m.createEmployee(db, owner, person({ email: "not-an-email" })),
    ).toMatchObject({
      code: "invalid",
      fieldErrors: { email: expect.any(String) },
    });
    ok(
      await m.createEmployee(
        db,
        owner,
        person({ employeeNumber: "DUP-1", primarySiteId: A.siteId }),
      ),
    );
    expect(
      await m.createEmployee(
        db,
        owner,
        person({ employeeNumber: "DUP-1", primarySiteId: A.siteId }),
      ),
    ).toMatchObject({
      code: "conflict",
      fieldErrors: { employeeNumber: expect.any(String) },
    });
  });

  it("an HR manager scoped to one site can only add and edit people there", async () => {
    const mine = ok(
      await m.createEmployee(db, hr, person({ primarySiteId: A.siteId })),
    ).id;
    expect(
      await m.createEmployee(db, hr, person({ primarySiteId: site2 })),
    ).toMatchObject({ code: "forbidden" });
    expect(
      await m.createEmployee(db, hr, person({ primarySiteId: null })),
    ).toMatchObject({ code: "invalid" });
    expect(
      await m.updateEmployee(db, hr, mine, person({ primarySiteId: site2 })),
    ).toMatchObject({
      code: "forbidden",
    });
    const theirs = ok(
      await m.createEmployee(db, owner, person({ primarySiteId: site2 })),
    ).id;
    expect(
      await m.updateEmployee(
        db,
        hr,
        theirs,
        person({ primarySiteId: A.siteId }),
      ),
    ).toMatchObject({
      code: "not_found",
    });
  });

  it("roles without employee.manage cannot add or edit people", async () => {
    expect(
      await m.createEmployee(
        db,
        siteManager,
        person({ primarySiteId: A.siteId }),
      ),
    ).toMatchObject({
      code: "forbidden",
    });
    expect(
      await m.updateEmployee(
        db,
        siteManager,
        A.employeeId,
        person({ primarySiteId: A.siteId }),
      ),
    ).toMatchObject({
      code: "forbidden",
    });
  });

  it("cross-organisation people and teams are refused", async () => {
    expect(
      await m.updateEmployee(db, owner, B.employeeId, person()),
    ).toMatchObject({ code: "not_found" });
    expect(
      await m.createEmployee(
        db,
        owner,
        person({ primarySiteId: A.siteId, teamIds: [B.teamId] }),
      ),
    ).toMatchObject({
      code: "invalid",
      fieldErrors: { teamIds: expect.any(String) },
    });
    expect(
      await m.createEmployee(db, owner, person({ primarySiteId: B.siteId })),
    ).toMatchObject({
      code: "invalid",
    });
  });

  it("team edits by a scoped manager keep teams they don't manage", async () => {
    const otherTeam = ok(
      await m.createTeam(db, owner, { name: "Kitchen 2", siteId: site2 }),
    ).id;
    const id = ok(
      await m.createEmployee(
        db,
        owner,
        person({ primarySiteId: A.siteId, teamIds: [A.teamId, otherTeam] }),
      ),
    ).id;
    // HR (site 1 only) clears teams: only the site-1 team is removed.
    ok(
      await m.updateEmployee(
        db,
        hr,
        id,
        person({ primarySiteId: A.siteId, teamIds: [] }),
      ),
    );
    const teams = await admin((c) =>
      c.query(`SELECT team_id FROM team_member WHERE employee_id = $1`, [id]),
    );
    expect(teams.rows.map((r) => r.team_id)).toEqual([otherTeam]);
  });

  it("marks people as left instead of deleting, and never links logins", async () => {
    const id = ok(
      await m.createEmployee(db, owner, person({ primarySiteId: A.siteId })),
    ).id;
    ok(
      await m.updateEmployee(
        db,
        owner,
        id,
        person({
          primarySiteId: A.siteId,
          status: "left",
          endDate: "2026-10-01",
        }),
      ),
    );
    await expect(
      withTenant(db, owner.ctx, (tx) =>
        tx.employee.update({
          where: { id },
          data: { membershipId: null, tenantId: A.tenantId },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("dashboard and People reflect real records", () => {
  it("counts only this organisation's active records, within scope", async () => {
    const counts = await admin(async (c) => ({
      sites: (
        await c.query(
          `SELECT count(*)::int AS n FROM site WHERE tenant_id = $1 AND status = 'active'`,
          [A.tenantId],
        )
      ).rows[0].n,
      active: (
        await c.query(
          `SELECT count(*)::int AS n FROM employee WHERE tenant_id = $1 AND status = 'active'`,
          [A.tenantId],
        )
      ).rows[0].n,
    }));
    const dash = await dashboardData(db, await ready(A.ownerUserId));
    expect(dash.counts.sites).toBe(counts.sites);
    expect(dash.counts.active).toBe(counts.active);

    const scoped = await listPeople(db, hr);
    const siteIds = new Set(scoped!.people.map((p) => p.siteId));
    expect([...siteIds]).toEqual([A.siteId]);
  });

  it("a suspended membership can no longer obtain a workspace to write with", async () => {
    const u = await memberWithRole(A.tenantId, "owner", null);
    expect((await ready(u)).kind).toBe("ready");
    await admin((c) =>
      c.query(
        `UPDATE tenant_membership SET status = 'suspended' WHERE tenant_id = $1 AND user_id = $2`,
        [A.tenantId, u],
      ),
    );
    expect((await resolveWorkspace(db, user(u), A.tenantId)).kind).toBe("none");
  });
});
