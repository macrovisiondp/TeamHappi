// M11.1 clocking, run as the real application role: staff clock only
// themselves (server time; matched to their published shift, or flagged with
// none); one open entry and one open break at a time; managers see and change
// times only at their sites, always with a reason kept in an append-only
// history; settings need tenant.settings.manage; isolation and database posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as att from "@/modules/attendance";
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
let site2: string;
let owner: Ready;
let manager: Ready; // site manager at A's main site only
let manager2: Ready; // site manager at site2 only
let anaW: Ready;
let calW: Ready;
let fayW: Ready;
let otherOwner: Ready;
let ana: string; // on a published shift
let cal: string; // no shift
let una: string; // staff record without a login
let shiftId: string;
const TODAY = rota.todayIn("Europe/London");
const WEEK = rota.addDays(rota.mondayOf(TODAY), 7);
const DAY = rota.addDays(WEEK, 1);
const local = (hhmm: string, day = DAY) =>
  rota.zonedToUtc(`${day}T${hhmm}`, "Europe/London")!;
const LATER = local("23:59", rota.addDays(WEEK, 6));

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
const run = <T>(w: Ready, fn: (tx: TenantTx, a: att.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(
  r: { ok: true; data: T } | { ok: false; message: string; code: string },
) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
async function member(roleKey: string, siteId: string, link?: string) {
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
         VALUES ($1, $2, $3, 'Clock', $4, 'Server', '2026-10-01', 'active', $5) RETURNING id`,
        [A.tenantId, `AT-${link}`, link, siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}
const entry = (id: string) =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT site_id, shift_id, source, clock_in_at, clock_out_at, removed_at FROM time_entry WHERE id = $1`,
          [id],
        )
      ).rows[0] as {
        site_id: string;
        shift_id: string | null;
        source: string;
        clock_in_at: Date;
        clock_out_at: Date | null;
        removed_at: Date | null;
      },
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "xray");
  B = await createTenantFixture(db, "yankee");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  site2 = await admin(
    async (x) =>
      (
        await x.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'X2', 'xray North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  manager = (await member("site_manager", A.siteId)).w;
  manager2 = (await member("site_manager", site2)).w;
  const a = await member("worker", A.siteId, "Ana");
  const c = await member("worker", A.siteId, "Cal");
  const f = await member("worker", site2, "Fay");
  [anaW, ana, calW, cal, fayW] = [a.w, a.employeeId!, c.w, c.employeeId!, f.w];
  una = await admin(
    async (x) =>
      (
        await x.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
           VALUES ($1, 'AT-U', 'Una', 'Clock', $2, 'active') RETURNING id`,
          [A.tenantId, A.siteId],
        )
      ).rows[0]!.id,
  );
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
  shiftId = ok(
    await run(manager, (tx, x) =>
      rota.saveShift(tx, x, A.siteId, WEEK, null, {
        day: DAY,
        start: "10:00",
        end: "16:00",
        breakMinutes: "30",
      }),
    ),
  ).id;
  ok(await run(manager, (tx, x) => rota.assignShift(tx, x, shiftId, ana, "")));
  ok(await run(manager, (tx, x) => rota.publishWeek(tx, x, A.siteId, WEEK)));
});

afterAll(async () => {
  await db.$disconnect();
});

describe("staff clocking", () => {
  let anaEntry: string;

  it("matches the published shift and uses the server's time", async () => {
    anaEntry = ok(
      await run(anaW, (tx, a) => att.clockIn(tx, a, local("09:55"))),
    ).id;
    expect(await entry(anaEntry)).toMatchObject({
      site_id: A.siteId,
      shift_id: shiftId,
      source: "self",
      clock_out_at: null,
    });
    expect((await entry(anaEntry)).clock_in_at.getTime()).toBe(
      local("09:55").getTime(),
    );
  });

  it("allows one open entry and one open break at a time", async () => {
    expect(
      await run(anaW, (tx, a) => att.clockIn(tx, a, local("10:00"))),
    ).toMatchObject({ ok: false, code: "conflict" });
    ok(
      await run(anaW, (tx, a) => att.toggleBreak(tx, a, true, local("12:00"))),
    );
    expect(
      await run(anaW, (tx, a) => att.toggleBreak(tx, a, true, local("12:05"))),
    ).toMatchObject({ ok: false, code: "conflict" });
    ok(
      await run(anaW, (tx, a) => att.toggleBreak(tx, a, false, local("12:30"))),
    );
    // The database refuses a second open entry even if the check is bypassed.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO time_entry (tenant_id, employee_id, site_id, clock_in_at, source, created_by)
           VALUES ($1, $2, $3, now(), 'self', $4)`,
          [A.tenantId, ana, A.siteId, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/time_entry_one_open/);
  });

  it("clocks out, ending an open break, and shows their own times", async () => {
    ok(
      await run(anaW, (tx, a) => att.toggleBreak(tx, a, true, local("15:00"))),
    );
    ok(await run(anaW, (tx, a) => att.clockOut(tx, a, local("16:02"))));
    const open = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM time_break b JOIN time_entry e ON e.id = b.time_entry_id
             WHERE e.id = $1 AND b.ends_at IS NULL`,
            [anaEntry],
          )
        ).rows[0].n as number,
    );
    expect(open).toBe(0);
    const mine = await run(anaW, (tx, a) => att.myClock(tx, a, local("17:00")));
    expect(mine?.open).toBeNull();
    expect(mine?.recent[0]).toMatchObject({
      id: anaEntry,
      clockIn: "09:55",
      clockOut: "16:02",
      breakMinutes: 92,
      workedMinutes: 6 * 60 + 7 - 92,
      flags: [],
    });
  });

  it("records no shift at the home site, and refuses clocking out after 24 hours", async () => {
    const id = ok(
      await run(calW, (tx, a) => att.clockIn(tx, a, local("08:00"))),
    ).id;
    expect(await entry(id)).toMatchObject({
      site_id: A.siteId,
      shift_id: null,
    });
    expect(
      await run(calW, (tx, a) =>
        att.clockOut(tx, a, local("08:01", rota.addDays(DAY, 1))),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("refuses members without a linked staff record", async () => {
    expect(
      await run(manager, (tx, a) => att.clockIn(tx, a, local("09:00"))),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await run(manager, (tx, a) => att.myClock(tx, a))).toBeNull();
  });
});

describe("managers", () => {
  let unaEntry: string;
  let fayEntry: string;

  it("see Who's in for their site with statuses and flags", async () => {
    const w = await run(manager, (tx, a) =>
      att.whosIn(tx, a, A.siteId, DAY, local("23:00")),
    );
    expect(w?.can).toEqual({ manage: true, settings: false });
    const anaRow = w!.rows.find((r) => r.employeeId === ana)!;
    expect(anaRow.status).toBe("done");
    // Cal's entry from 08:00 is still open with no shift, 15 hours later.
    const calRow = w!.rows.find((r) => r.employeeId === cal)!;
    expect(calRow.status).toBe("missed_clock_out");
    expect(calRow.entries[0]!.flags).toEqual(["no_shift", "missed_clock_out"]);
    // Una has no login but can have times recorded.
    expect(w!.staff.map((s) => s.id)).toContain(una);
  });

  it("record times with a reason; overlaps and future times are refused", async () => {
    const raw = {
      clockIn: `${DAY}T17:00`,
      clockOut: `${DAY}T22:00`,
      reason: "Paper sign-in sheet",
    };
    expect(
      await run(manager, (tx, a) =>
        att.recordEntry(tx, a, A.siteId, una, { ...raw, reason: " " }, LATER),
      ),
    ).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(
      await run(manager, (tx, a) =>
        att.recordEntry(tx, a, A.siteId, una, raw, local("12:00")),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { clockIn: expect.any(String) },
    });
    unaEntry = ok(
      await run(manager, (tx, a) =>
        att.recordEntry(tx, a, A.siteId, una, raw, LATER),
      ),
    ).id;
    expect(await entry(unaEntry)).toMatchObject({ source: "manager" });
    expect(
      await run(manager, (tx, a) =>
        att.recordEntry(
          tx,
          a,
          A.siteId,
          una,
          { ...raw, clockIn: `${DAY}T21:00`, clockOut: `${DAY}T23:00` },
          LATER,
        ),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("correct a missed clock-out and remove an entry, keeping the history", async () => {
    const cals = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT id FROM time_entry WHERE employee_id = $1 AND clock_out_at IS NULL`,
            [cal],
          )
        ).rows[0].id as string,
    );
    ok(
      await run(manager, (tx, a) =>
        att.correctEntry(
          tx,
          a,
          cals,
          {
            clockIn: `${DAY}T08:00`,
            clockOut: `${DAY}T14:00`,
            reason: "Forgot",
          },
          LATER,
        ),
      ),
    );
    expect((await entry(cals)).clock_out_at?.getTime()).toBe(
      local("14:00").getTime(),
    );
    ok(
      await run(manager, (tx, a) =>
        att.removeEntry(tx, a, unaEntry, "Wrong person", LATER),
      ),
    );
    expect((await entry(unaEntry)).removed_at).not.toBeNull();
    // A removed entry can't be changed again.
    expect(
      await run(manager, (tx, a) => att.removeEntry(tx, a, unaEntry, "Again")),
    ).toMatchObject({ ok: false, code: "not_found" });
    const w = await run(manager, (tx, a) =>
      att.whosIn(tx, a, A.siteId, DAY, LATER),
    );
    const calRow = w!.rows.find((r) => r.employeeId === cal)!;
    expect(calRow.entries[0]!.history).toMatchObject([
      { kind: "corrected", reason: "Forgot", to: `${DAY} 08:00–14:00` },
    ]);
    expect(calRow.entries[0]!.flags).toContain("corrected");
    expect(w!.rows.some((r) => r.employeeId === una)).toBe(false);
  });

  it("only at their own sites; staff can't manage; other organisations see nothing", async () => {
    fayEntry = ok(
      await run(fayW, (tx, a) => att.clockIn(tx, a, local("09:00"))),
    ).id;
    expect(await entry(fayEntry)).toMatchObject({ site_id: site2 });
    const fix = { clockIn: `${DAY}T09:30`, clockOut: "", reason: "x" };
    // Site manager at the main site: site2 doesn't exist for them.
    expect(
      await run(manager, (tx, a) => att.whosIn(tx, a, site2, DAY)),
    ).toBeNull();
    expect(
      await run(manager, (tx, a) =>
        att.correctEntry(tx, a, fayEntry, fix, LATER),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      (await run(manager, (tx, a) => att.attendanceSites(tx, a))).map(
        (s) => s.id,
      ),
    ).toEqual([A.siteId]);
    // ...but the site2 manager can.
    ok(
      await run(manager2, (tx, a) =>
        att.correctEntry(tx, a, fayEntry, fix, LATER),
      ),
    );
    // Staff have no attendance permission.
    expect(await run(anaW, (tx, a) => att.attendanceSites(tx, a))).toEqual([]);
    expect(
      await run(anaW, (tx, a) => att.whosIn(tx, a, A.siteId, DAY)),
    ).toBeNull();
    expect(
      await run(anaW, (tx, a) =>
        att.recordEntry(tx, a, A.siteId, ana, fix, LATER),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    // Another organisation.
    expect(
      await run(otherOwner, (tx, a) => att.whosIn(tx, a, A.siteId, DAY)),
    ).toBeNull();
    expect(
      await run(otherOwner, (tx, a) =>
        att.removeEntry(tx, a, fayEntry, "x", LATER),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("can't record times for someone not based or rostered at the site", async () => {
    expect(
      await run(manager2, (tx, a) =>
        att.recordEntry(
          tx,
          a,
          site2,
          una,
          { clockIn: `${DAY}T10:00`, clockOut: `${DAY}T11:00`, reason: "x" },
          LATER,
        ),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { employeeId: expect.any(String) },
    });
  });
});

describe("settings", () => {
  it("need tenant.settings.manage and stay within limits", async () => {
    expect(
      await run(manager, (tx, a) =>
        att.saveSettings(tx, a, {
          toleranceMinutes: 5,
          missedClockOutHours: 1,
        }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(owner, (tx, a) =>
        att.saveSettings(tx, a, {
          toleranceMinutes: 61,
          missedClockOutHours: 0,
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    ok(
      await run(owner, (tx, a) =>
        att.saveSettings(tx, a, {
          toleranceMinutes: 1,
          missedClockOutHours: 3,
        }),
      ),
    );
    // Ana clocked in at 09:55 for a 10:00 shift: now flagged early (tolerance 1 min).
    const w = await run(owner, (tx, a) =>
      att.whosIn(tx, a, A.siteId, DAY, LATER),
    );
    expect(w!.limits).toEqual({ toleranceMinutes: 1, missedClockOutHours: 3 });
    const anaRow = w!.rows.find((r) => r.employeeId === ana)!;
    expect(anaRow.entries[0]!.flags).toEqual(["early_in", "stayed_late"]);
  });
});

describe("audit and the database itself", () => {
  it("audits with ids only, never reasons", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS detail FROM audit_event
             WHERE tenant_id = $1 AND action LIKE 'attendance.%'`,
            [A.tenantId],
          )
        ).rows as { action: string; detail: string }[],
    );
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set([
        "attendance.clocked_in",
        "attendance.break_started",
        "attendance.break_ended",
        "attendance.clocked_out",
        "attendance.entry_recorded",
        "attendance.entry_corrected",
        "attendance.entry_removed",
        "attendance.settings_updated",
      ]),
    );
    for (const r of rows)
      expect(r.detail).not.toMatch(/Paper|Forgot|Wrong person/);
  });

  it("keeps history append-only and fixes who, where and how", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of ["time_entry", "time_break", "time_entry_change"])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      for (const col of ["employee_id", "site_id", "source", "created_by"])
        await expect(
          c.query(`UPDATE time_entry SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
    });
    // Even the owner role can't rewrite history.
    await expect(
      admin((c) => c.query(`UPDATE time_entry_change SET reason = 'x'`)),
    ).rejects.toThrow(/append-only/);
    // Over 24 hours, and a shift at another site, are refused.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO time_entry (tenant_id, employee_id, site_id, clock_in_at, clock_out_at, source, created_by)
           VALUES ($1, $2, $3, now() - interval '30 hours', now(), 'manager', $4)`,
          [A.tenantId, una, A.siteId, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/time_entry_times/);
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO time_entry (tenant_id, employee_id, site_id, shift_id, clock_in_at, clock_out_at, source, created_by)
           VALUES ($1, $2, $3, $4, now() - interval '1 hour', now(), 'manager', $5)`,
          [A.tenantId, una, site2, shiftId, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/time_entry_shift_fkey/);
  });
});
