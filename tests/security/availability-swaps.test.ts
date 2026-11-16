// M10.3 availability, drops and swaps, run as the real application role: staff
// manage only their own unavailability, which warns managers when assigning
// (and shows on the week); staff ask to drop or swap only their own published,
// future shifts; a swap goes to a linked colleague at the site, who accepts
// before a manager can approve; approval runs every assignment check; other
// changes to the shift cancel open requests; isolation and database posture.

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
let manager: Ready;
let anaW: Ready;
let benW: Ready;
let calW: Ready;
let otherOwner: Ready;
let ana: string;
let ben: string; // no right-to-work check
let cal: string;
let unlinked: string; // staff record without a login
let farAway: string; // linked, at another site
const TODAY = rota.todayIn("Europe/London");
const WEEK = rota.addDays(rota.mondayOf(TODAY), 7);
const day = (n: number) => rota.addDays(WEEK, n);

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
         VALUES ($1, $2, $3, 'Swaps', $4, 'Bartender', '2026-10-01', 'active', $5) RETURNING id`,
        [A.tenantId, `AS-${link}`, link, siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}
const rtw = (employeeId: string) =>
  run(owner, (tx, a) =>
    ob.recordRtwCheck(tx, a, employeeId, TODAY, {
      method: "manual_document",
      listType: "list_a",
      checkedOn: TODAY,
      personPresent: true,
      outcome: "confirmed",
    }),
  );
const add = (d: string, start = "10:00", end = "16:00") =>
  run(manager, (tx, a) =>
    rota.saveShift(tx, a, A.siteId, WEEK, null, {
      day: d,
      start,
      end,
      breakMinutes: "30",
    }),
  );
const assign = (shiftId: string, employeeId: string, reason = "") =>
  run(manager, (tx, a) => rota.assignShift(tx, a, shiftId, employeeId, reason));
const status = (id: string) =>
  admin(
    async (c) =>
      (
        await c.query(`SELECT status FROM shift_change_request WHERE id = $1`, [
          id,
        ])
      ).rows[0].status as string,
  );
const assignee = (shiftId: string) =>
  admin(
    async (c) =>
      ((
        await c.query(
          `SELECT employee_id FROM shift_assignment WHERE shift_id = $1 AND removed_at IS NULL`,
          [shiftId],
        )
      ).rows[0]?.employee_id as string | undefined) ?? null,
  );
const isoWeekday = (iso: string) =>
  ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "victor");
  B = await createTenantFixture(db, "whiskey");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  manager = (await member("site_manager", A.siteId)).w;
  const a = await member("worker", A.siteId, "Ana");
  const b = await member("worker", A.siteId, "Ben");
  const c = await member("worker", A.siteId, "Cal");
  [anaW, ana, benW, ben, calW, cal] = [
    a.w,
    a.employeeId!,
    b.w,
    b.employeeId!,
    c.w,
    c.employeeId!,
  ];
  const site2 = await admin(
    async (x) =>
      (
        await x.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'V2', 'victor North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  farAway = (await member("worker", site2, "Fay")).employeeId!;
  unlinked = await admin(
    async (x) =>
      (
        await x.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
           VALUES ($1, 'AS-U', 'Una', 'Swaps', $2, 'active') RETURNING id`,
          [A.tenantId, A.siteId],
        )
      ).rows[0]!.id,
  );
  for (const id of [ana, cal]) ok(await rtw(id));
});

afterAll(async () => {
  await db.$disconnect();
});

describe("unavailability", () => {
  let entry: string;
  let mon: string;

  it("is checked: dates must be today or later, times in order", async () => {
    expect(
      await run(anaW, (tx, a) =>
        rota.addUnavailability(tx, a, {
          kind: "dates",
          startsOn: "2020-01-01",
          allDay: "on",
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { startsOn: expect.any(String) },
    });
    expect(
      await run(anaW, (tx, a) =>
        rota.addUnavailability(tx, a, {
          kind: "weekly",
          weekday: "2",
          startTime: "20:00",
          endTime: "18:00",
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { endTime: expect.any(String) },
    });
  });

  it("warns managers when assigning on that day, and shows on the week", async () => {
    entry = ok(
      await run(anaW, (tx, a) =>
        rota.addUnavailability(tx, a, {
          kind: "weekly",
          weekday: String(isoWeekday(day(0))),
          allDay: "on",
          note: "College",
        }),
      ),
    ).id;
    mon = ok(await add(day(0))).id;
    const r = await assign(mon, ana);
    expect(r).toMatchObject({ ok: false, code: "needs_reason" });
    expect(!r.ok && r.warnings?.map((w) => w.code)).toEqual(["unavailable"]);
    const week = (await run(manager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    expect(week.unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          day: day(0),
          employeeId: ana,
          when: "all day",
        }),
      ]),
    );
    // Only the person can remove their own entry.
    expect(
      await run(benW, (tx, a) => rota.removeUnavailability(tx, a, entry)),
    ).toMatchObject({ ok: false, code: "not_found" });
    ok(await run(anaW, (tx, a) => rota.removeUnavailability(tx, a, entry)));
    ok(await assign(mon, ana));
    expect(
      (await run(anaW, (tx, a) => rota.myShifts(tx, a)))!.unavailability,
    ).toEqual([]);
  });
});

describe("drops and swaps", () => {
  let drop: string;
  let swapCal: string;
  let swapBen: string;
  let reqDrop: string;

  beforeAll(async () => {
    drop = ok(await add(day(1))).id;
    swapCal = ok(await add(day(2))).id;
    swapBen = ok(await add(day(3))).id;
    for (const id of [drop, swapCal, swapBen]) ok(await assign(id, ana));
    ok(await run(manager, (tx, a) => rota.publishWeek(tx, a, A.siteId, WEEK)));
  });

  it("drop: only your own shift, once; the manager approves and it becomes open", async () => {
    expect(
      await run(benW, (tx, a) => rota.requestChange(tx, a, drop, "drop", null)),
    ).toMatchObject({ ok: false, code: "not_found" });
    reqDrop = ok(
      await run(anaW, (tx, a) => rota.requestChange(tx, a, drop, "drop", null)),
    ).id;
    expect(
      await run(anaW, (tx, a) => rota.requestChange(tx, a, drop, "drop", null)),
    ).toMatchObject({ ok: false, code: "conflict" });
    const week = (await run(manager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    expect(week.shifts.find((s) => s.id === drop)!.change).toMatchObject({
      id: reqDrop,
      kind: "drop",
      from: "Ana Swaps",
    });
    expect(
      await run(otherOwner, (tx, a) =>
        rota.decideChange(tx, a, reqDrop, "approve", ""),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(anaW, (tx, a) =>
        rota.decideChange(tx, a, reqDrop, "approve", ""),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    ok(
      await run(manager, (tx, a) =>
        rota.decideChange(tx, a, reqDrop, "approve", ""),
      ),
    );
    expect(await status(reqDrop)).toBe("approved");
    expect(await assignee(drop)).toBeNull();
    const me = (await run(anaW, (tx, a) => rota.myShifts(tx, a)))!;
    expect(me.shifts.map((s) => s.id)).not.toContain(drop);
  });

  it("swap: a linked colleague at the site only; they accept, then a manager approves", async () => {
    for (const target of [unlinked, farAway, ana])
      expect(
        await run(anaW, (tx, a) =>
          rota.requestChange(tx, a, swapCal, "swap", target),
        ),
      ).toMatchObject({ ok: false, code: "invalid" });
    const r = ok(
      await run(anaW, (tx, a) =>
        rota.requestChange(tx, a, swapCal, "swap", cal),
      ),
    ).id;
    // Not accepted yet: the manager can't approve; only Cal can answer.
    expect(
      await run(manager, (tx, a) => rota.decideChange(tx, a, r, "approve", "")),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await run(benW, (tx, a) => rota.respondToSwap(tx, a, r, true)),
    ).toMatchObject({ ok: false, code: "not_found" });
    const calView = (await run(calW, (tx, a) => rota.myShifts(tx, a)))!;
    expect(calView.swapOffers).toMatchObject([
      { requestId: r, from: "Ana Swaps", id: swapCal },
    ]);
    ok(await run(calW, (tx, a) => rota.respondToSwap(tx, a, r, true)));
    expect(await status(r)).toBe("accepted");
    ok(
      await run(manager, (tx, a) => rota.decideChange(tx, a, r, "approve", "")),
    );
    expect(await status(r)).toBe("approved");
    expect(await assignee(swapCal)).toBe(cal);
  });

  it("approving a swap runs every check: someone without a right-to-work check is blocked", async () => {
    const r = ok(
      await run(anaW, (tx, a) =>
        rota.requestChange(tx, a, swapBen, "swap", ben),
      ),
    ).id;
    ok(await run(benW, (tx, a) => rota.respondToSwap(tx, a, r, true)));
    const res = await run(manager, (tx, a) =>
      rota.decideChange(tx, a, r, "approve", ""),
    );
    expect(res).toMatchObject({ ok: false, code: "conflict" });
    expect(await assignee(swapBen)).toBe(ana);
    ok(
      await run(manager, (tx, a) => rota.decideChange(tx, a, r, "decline", "")),
    );
    expect(await status(r)).toBe("declined");
  });

  it("withdrawing is yours only; a manager changing the shift cancels open requests", async () => {
    const r = ok(
      await run(anaW, (tx, a) =>
        rota.requestChange(tx, a, swapBen, "drop", null),
      ),
    ).id;
    expect(
      await run(calW, (tx, a) => rota.withdrawChange(tx, a, r)),
    ).toMatchObject({ ok: false, code: "not_found" });
    ok(await run(anaW, (tx, a) => rota.withdrawChange(tx, a, r)));
    expect(await status(r)).toBe("withdrawn");
    const again = ok(
      await run(anaW, (tx, a) =>
        rota.requestChange(tx, a, swapBen, "drop", null),
      ),
    ).id;
    ok(await run(manager, (tx, a) => rota.unassignShift(tx, a, swapBen)));
    expect(await status(again)).toBe("cancelled");
    const actions = await admin(
      async (c) =>
        (
          await c.query<{ action: string; detail: string }>(
            `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1 AND action LIKE 'rota.%' ORDER BY occurred_at, id`,
            [swapBen],
          )
        ).rows,
    );
    expect(actions.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "rota.swap_requested",
        "rota.swap_accepted",
        "rota.change_declined",
        "rota.drop_requested",
        "rota.change_withdrawn",
      ]),
    );
    for (const x of actions) expect(x.detail).not.toMatch(/College|Ana|Ben/);
  });
});

describe("the database itself", () => {
  it("has no DELETE and fixes who, which shift and what kind", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of ["unavailability", "shift_change_request"])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      for (const col of [
        "shift_id",
        "employee_id",
        "kind",
        "target_employee_id",
      ])
        await expect(
          c.query(`UPDATE shift_change_request SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
      for (const col of ["employee_id", "weekday", "starts_on", "note"])
        await expect(
          c.query(`UPDATE unavailability SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO unavailability (tenant_id, employee_id, kind, weekday, starts_on, ends_on, created_by)
           VALUES ($1, $2, 'weekly', 9, NULL, NULL, $3)`,
          [A.tenantId, ana, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/unavailability_kind/);
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO shift_change_request (tenant_id, shift_id, employee_id, kind, target_employee_id, requested_by)
           SELECT tenant_id, id, $2, 'swap', $2, $3 FROM shift WHERE tenant_id = $1 LIMIT 1`,
          [A.tenantId, ana, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/shift_change_request_kind/);
  });
});
