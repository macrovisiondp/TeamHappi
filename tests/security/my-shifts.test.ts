// M10.2 My shifts and requests, run as the real application role: staff see
// only their own PUBLISHED shifts (never drafts or anyone else's), with new,
// changed and removed shifts flagged since they last looked; they can ask for
// open shifts at their own site, withdraw, and a manager approves (every
// assignment check runs) or declines; filling a shift answers every other
// request; isolation and database posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";
import * as rota from "@/modules/rota";

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
let owner: Ready;
let manager: Ready; // site manager at A's first site
let anaW: Ready; // worker, linked, right to work recorded
let benW: Ready; // worker, linked, no right-to-work check
let loose: Ready; // worker with no linked record
let otherOwner: Ready;
let ana: string;
let ben: string;
let site2: string;
const TODAY = rota.todayIn("Europe/London");
const WEEK = rota.addDays(rota.mondayOf(TODAY), 7); // next week
const DRAFT_WEEK = rota.addDays(WEEK, 7);

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready) => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: rota.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(
  r: { ok: true; data: T } | { ok: false; message: string; code: string },
) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
/** A member with a role; optionally linked to a new employee record at a site. */
async function member(roleKey: string, siteId: string | null, link?: string) {
  const userId = await createUser(roleKey.replace("_", ""));
  const employeeId = await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $4 FROM role WHERE tenant_id = $1 AND key = $3`,
      [
        A.tenantId,
        m.rows[0]!.id,
        roleKey,
        roleKey === "worker" ? null : siteId,
      ],
    );
    if (!link) return null;
    return (
      await c.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, start_date, status, membership_id)
         VALUES ($1, $2, $3, 'Shifts', $4, 'Bartender', '2026-10-01', 'active', $5) RETURNING id`,
        [A.tenantId, `MS-${link}`, link, siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}
const add = (
  day: string,
  start: string,
  end: string,
  week = WEEK,
  site?: string,
) =>
  run(manager, (tx, a) =>
    rota.saveShift(tx, a, site ?? A.siteId, week, null, {
      day,
      start,
      end,
      breakMinutes: "30",
    }),
  );
const mine = (w: Ready) => run(w, (tx, a) => rota.myShifts(tx, a));
const requestRow = (id: string) =>
  admin(
    async (c) =>
      (await c.query(`SELECT status FROM shift_request WHERE id = $1`, [id]))
        .rows[0].status as string,
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "tango");
  B = await createTenantFixture(db, "uniform");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  site2 = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'T2', 'tango North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  manager = (await member("site_manager", A.siteId)).w;
  const a = await member("worker", A.siteId, "Ana");
  const b = await member("worker", A.siteId, "Ben");
  anaW = a.w;
  ana = a.employeeId!;
  benW = b.w;
  ben = b.employeeId!;
  loose = (await member("worker", null)).w;
  ok(
    await run(owner, (tx, x) =>
      ob.recordRtwCheck(tx, x, ana, TODAY, {
        method: "manual_document",
        listType: "list_a",
        checkedOn: TODAY,
        personPresent: true,
        outcome: "confirmed",
      }),
    ),
  );
  // Manager access to the second site, for the "other site" open shift.
  await admin((c) =>
    c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $3 FROM role WHERE tenant_id = $1 AND key = 'site_manager'`,
      [A.tenantId, manager.membershipId, site2],
    ),
  );
  manager = await ws(manager.ctx.userId!);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("My shifts", () => {
  let tue: string;

  it("is empty without a linked record", async () => {
    expect(await mine(loose)).toBeNull();
    expect(await run(loose, rota.markShiftsSeen)).toMatchObject({ ok: false });
  });

  it("never shows drafts", async () => {
    tue = ok(await add(rota.addDays(WEEK, 1), "10:00", "18:00")).id;
    ok(await run(manager, (tx, a) => rota.assignShift(tx, a, tue, ana, "")));
    const draftShift = ok(
      await add(rota.addDays(DRAFT_WEEK, 2), "10:00", "18:00", DRAFT_WEEK),
    ).id;
    ok(
      await run(manager, (tx, a) =>
        rota.assignShift(tx, a, draftShift, ana, ""),
      ),
    );
    expect((await mine(anaW))!.shifts).toEqual([]);
  });

  it("shows published shifts as new until seen, then changes and removals", async () => {
    ok(await run(manager, (tx, a) => rota.publishWeek(tx, a, A.siteId, WEEK)));
    let me = (await mine(anaW))!;
    expect(me.shifts).toMatchObject([
      {
        id: tue,
        day: rota.addDays(WEEK, 1),
        start: "10:00",
        end: "18:00",
        flag: "new",
        minutes: 450,
      },
    ]);
    expect(me.updates).toBe(1);
    expect(await run(anaW, rota.myShiftUpdates)).toBe(1);
    ok(await run(anaW, rota.markShiftsSeen));
    me = (await mine(anaW))!;
    expect(me.shifts[0]!.flag).toBeNull();
    expect(me.updates).toBe(0);

    // The manager moves it: changed.
    await new Promise((r) => setTimeout(r, 20));
    ok(
      await run(manager, (tx, a) =>
        rota.saveShift(tx, a, A.siteId, WEEK, tue, {
          day: rota.addDays(WEEK, 1),
          start: "11:00",
          end: "18:00",
          breakMinutes: "30",
        }),
      ),
    );
    me = (await mine(anaW))!;
    expect(me.shifts[0]).toMatchObject({ start: "11:00", flag: "changed" });
    ok(await run(anaW, rota.markShiftsSeen));

    // Then takes her off it: listed as no longer hers.
    await new Promise((r) => setTimeout(r, 20));
    ok(await run(manager, (tx, a) => rota.unassignShift(tx, a, tue)));
    me = (await mine(anaW))!;
    expect(me.shifts).toEqual([]);
    expect(me.removed).toMatchObject([{ shiftId: tue, kind: "removed" }]);
    expect(me.updates).toBe(1);
    // Ben never sees Ana's shifts.
    expect((await mine(benW))!.shifts).toEqual([]);
  });
});

describe("asking for open shifts", () => {
  let open1: string;
  let open2: string;
  let other: string;
  let reqAna: string;
  let reqBen: string;

  beforeAll(async () => {
    // The shift Ana was taken off is open again; add two more and one at another site.
    open1 = ok(await add(rota.addDays(WEEK, 3), "12:00", "20:00")).id;
    open2 = ok(await add(rota.addDays(WEEK, 4), "12:00", "20:00")).id;
    other = ok(
      await add(rota.addDays(WEEK, 3), "12:00", "20:00", WEEK, site2),
    ).id;
    ok(await run(manager, (tx, a) => rota.publishWeek(tx, a, site2, WEEK)));
  });

  it("lists open, published, future shifts at their own site only, without names", async () => {
    const me = (await mine(anaW))!;
    const ids = me.openShifts.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([open1, open2]));
    expect(ids).not.toContain(other);
    expect(JSON.stringify(me)).not.toMatch(/Ben/);
  });

  it("asks once per shift; other sites, drafts and filled shifts are refused", async () => {
    reqAna = ok(await run(anaW, (tx, a) => rota.requestShift(tx, a, open1))).id;
    expect(
      await run(anaW, (tx, a) => rota.requestShift(tx, a, open1)),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    reqBen = ok(await run(benW, (tx, a) => rota.requestShift(tx, a, open1))).id;
    expect(
      await run(anaW, (tx, a) => rota.requestShift(tx, a, other)),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await run(loose, (tx, a) => rota.requestShift(tx, a, open1)),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      (await mine(anaW))!.openShifts.find((s) => s.id === open1)!.requestId,
    ).toBe(reqAna);
  });

  it("managers see requests; approving runs every check; filling answers the rest", async () => {
    const week = (await run(manager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    expect(week.pendingRequests).toBe(2);
    expect(
      week.shifts
        .find((s) => s.id === open1)!
        .requests.map((r) => r.employeeId),
    ).toEqual(expect.arrayContaining([ana, ben]));
    expect(
      week.shifts
        .find((s) => s.id === open1)!
        .requests.map((r) => r.name)
        .sort(),
    ).toEqual(["Ana Shifts", "Ben Shifts"]);
    // Workers and other organisations can't answer.
    expect(
      await run(benW, (tx, a) =>
        rota.decideRequest(tx, a, reqBen, "approve", ""),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(otherOwner, (tx, a) =>
        rota.decideRequest(tx, a, reqBen, "approve", ""),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    // Ben has no right-to-work check: blocked.
    expect(
      await run(manager, (tx, a) =>
        rota.decideRequest(tx, a, reqBen, "approve", ""),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    ok(
      await run(manager, (tx, a) =>
        rota.decideRequest(tx, a, reqAna, "approve", ""),
      ),
    );
    expect(await requestRow(reqAna)).toBe("approved");
    expect(await requestRow(reqBen)).toBe("declined");
    const me = (await mine(anaW))!;
    expect(me.shifts.map((s) => s.id)).toContain(open1);
    expect(me.openShifts.map((s) => s.id)).not.toContain(open1);
    expect(
      await run(benW, (tx, a) => rota.requestShift(tx, a, open1)),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("withdraws your own request only; declines are audited", async () => {
    const r = ok(
      await run(benW, (tx, a) => rota.requestShift(tx, a, open2)),
    ).id;
    expect(
      await run(anaW, (tx, a) => rota.withdrawRequest(tx, a, r)),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
    ok(await run(benW, (tx, a) => rota.withdrawRequest(tx, a, r)));
    expect(await requestRow(r)).toBe("withdrawn");
    const again = ok(
      await run(benW, (tx, a) => rota.requestShift(tx, a, open2)),
    ).id;
    ok(
      await run(manager, (tx, a) =>
        rota.decideRequest(tx, a, again, "decline", ""),
      ),
    );
    expect(await requestRow(again)).toBe("declined");
    expect(
      await run(manager, (tx, a) =>
        rota.decideRequest(tx, a, again, "approve", ""),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const actions = await admin(async (c) =>
      (
        await c.query<{ action: string }>(
          `SELECT action FROM audit_event WHERE target_id = $1 ORDER BY occurred_at, id`,
          [open2],
        )
      ).rows.map((x) => x.action),
    );
    expect(actions).toEqual([
      "rota.shift_requested",
      "rota.shift_request_withdrawn",
      "rota.shift_requested",
      "rota.shift_request_declined",
    ]);
  });
});

describe("the database itself", () => {
  it("has no DELETE and fixes the shift and person on a request", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of ["shift_request", "rota_seen"])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        c.query(`UPDATE shift_request SET employee_id = employee_id`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE shift_request SET shift_id = shift_id`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE rota_seen SET employee_id = employee_id`),
      ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO shift_request (tenant_id, shift_id, employee_id, requested_by, status) SELECT tenant_id, id, $2, $3, 'approved' FROM shift WHERE tenant_id = $1 LIMIT 1`,
          [A.tenantId, ana, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/shift_request_status/);
  });
});
