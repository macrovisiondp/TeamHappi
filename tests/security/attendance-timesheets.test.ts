// M11.2 timesheets and M11.3 export, run as the real application role:
// planned against worked per site and week; approval only after the week ends
// with nobody clocked in; approval locks the week (service AND database
// trigger); reopening needs a reason; the export is organisation-wide
// exporters only, approved weeks only, hours only, formulas neutralised,
// audited; isolation and database posture.

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
let manager: Ready;
let manager2: Ready;
let anaW: Ready;
let otherOwner: Ready;
let ana: string;
let una: string;
let anaEntry: string;
let unaEntry: string;
const TODAY = rota.todayIn("Europe/London");
const WEEK = rota.addDays(rota.mondayOf(TODAY), 7);
const DAY = rota.addDays(WEEK, 1);
const local = (hhmm: string, day = DAY) =>
  rota.zonedToUtc(`${day}T${hhmm}`, "Europe/London")!;
const DURING = local("20:00");
const AFTER = local("09:00", rota.addDays(WEEK, 8));

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
         VALUES ($1, $2, $3, 'Sheet', $4, 'Server', '2026-10-01', 'active', $5) RETURNING id`,
        [A.tenantId, `TS-${link}`, link, siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "zulu");
  B = await createTenantFixture(db, "alpha");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  site2 = await admin(
    async (x) =>
      (
        await x.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'Z2', 'zulu North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  manager = (await member("site_manager", A.siteId)).w;
  manager2 = (await member("site_manager", site2)).w;
  const a = await member("worker", A.siteId, "Ana");
  [anaW, ana] = [a.w, a.employeeId!];
  // No login; a spreadsheet formula in the name must not survive the export.
  una = await admin(
    async (x) =>
      (
        await x.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
           VALUES ($1, 'TS-U', 'Una', '=HYPERLINK("x")', $2, 'active') RETURNING id`,
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
  const shiftId = ok(
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
  // Ana works 10:00-16:00 with no break recorded (flagged, not deducted).
  anaEntry = ok(
    await run(anaW, (tx, x) => att.clockIn(tx, x, local("10:00"))),
  ).id;
  unaEntry = ok(
    await run(manager, (tx, x) =>
      att.recordEntry(
        tx,
        x,
        A.siteId,
        una,
        { clockIn: `${DAY}T12:00`, clockOut: `${DAY}T19:30`, reason: "Paper" },
        DURING,
      ),
    ),
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the weekly timesheet", () => {
  it("shows planned against worked, with flags", async () => {
    ok(await run(anaW, (tx, x) => att.clockOut(tx, x, local("16:00"))));
    const t = await run(manager, (tx, x) =>
      att.timesheet(tx, x, A.siteId, WEEK, DURING),
    );
    expect(t?.status).toBe("open");
    const anaRow = t!.rows.find((r) => r.employeeId === ana)!;
    expect(anaRow).toMatchObject({ planned: 330, worked: 360 });
    expect(anaRow.days[1]).toEqual({ day: DAY, planned: 330, worked: 360 });
    expect(anaRow.entries[0]!.flags).toEqual(["no_break"]);
    const unaRow = t!.rows.find((r) => r.employeeId === una)!;
    expect(unaRow).toMatchObject({ planned: 0, worked: 450 });
    expect(unaRow.entries[0]!.flags).toEqual(["no_shift", "corrected"]);
    expect(t!.totals).toEqual({ planned: 330, worked: 810 });
    expect(t!.blocker).toMatch(/hasn't finished/);
  });

  it("can't be approved before the week ends or while someone is clocked in", async () => {
    expect(
      await run(manager, (tx, x) =>
        att.approveTimesheet(tx, x, A.siteId, WEEK, DURING),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const open = ok(
      await run(anaW, (tx, x) => att.clockIn(tx, x, local("21:00"))),
    ).id;
    expect(
      await run(manager, (tx, x) =>
        att.approveTimesheet(tx, x, A.siteId, WEEK, AFTER),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/clocked in/),
    });
    ok(
      await run(manager, (tx, x) =>
        att.removeEntry(tx, x, open, "Tapped by mistake", AFTER),
      ),
    );
  });

  it("is approved by a manager at the site, then locked", async () => {
    // Staff, another site's manager and another organisation can't.
    expect(
      await run(anaW, (tx, x) =>
        att.approveTimesheet(tx, x, A.siteId, WEEK, AFTER),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(manager2, (tx, x) =>
        att.approveTimesheet(tx, x, A.siteId, WEEK, AFTER),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(otherOwner, (tx, x) =>
        att.timesheet(tx, x, A.siteId, WEEK, AFTER),
      ),
    ).toBeNull();
    ok(
      await run(manager, (tx, x) =>
        att.approveTimesheet(tx, x, A.siteId, WEEK, AFTER),
      ),
    );
    expect(
      await run(manager, (tx, x) =>
        att.approveTimesheet(tx, x, A.siteId, WEEK, AFTER),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });

    const fix = {
      clockIn: `${DAY}T10:05`,
      clockOut: `${DAY}T16:00`,
      reason: "x",
    };
    for (const r of [
      await run(manager, (tx, x) =>
        att.correctEntry(tx, x, anaEntry, fix, AFTER),
      ),
      await run(manager, (tx, x) =>
        att.removeEntry(tx, x, unaEntry, "x", AFTER),
      ),
      await run(manager, (tx, x) =>
        att.recordEntry(
          tx,
          x,
          A.siteId,
          una,
          { clockIn: `${DAY}T06:00`, clockOut: `${DAY}T07:00`, reason: "x" },
          AFTER,
        ),
      ),
    ])
      expect(r).toMatchObject({
        ok: false,
        code: "conflict",
        message: expect.stringMatching(/locked/),
      });
    // The database refuses too, even if the service check is bypassed.
    await expect(
      withTenant(db, owner.ctx, (tx) =>
        tx.timeEntry.update({
          where: { tenantId_id: { tenantId: A.tenantId, id: anaEntry } },
          data: { clockOutAt: local("17:00") },
        }),
      ),
    ).rejects.toThrow(/time_entry_week_locked/);
  });

  it("shows staff their approved hours", async () => {
    const mine = await run(anaW, (tx, x) => att.myClock(tx, x, AFTER));
    expect(mine?.approvedWeeks).toEqual([{ weekStart: WEEK, minutes: 360 }]);
  });
});

describe("the export", () => {
  it("is for organisation-wide exporters only", async () => {
    for (const w of [manager, anaW])
      expect(
        await run(w, (tx, x) => att.exportApprovedHours(tx, x, WEEK, DAY)),
      ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(owner, (tx, x) =>
        att.exportApprovedHours(tx, x, WEEK, rota.addDays(WEEK, 200)),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("has approved weeks only, hours not money, and neutralised formulas", async () => {
    const r = ok(
      await run(owner, (tx, x) =>
        att.exportApprovedHours(tx, x, WEEK, rota.addDays(WEEK, 6), AFTER),
      ),
    );
    expect(r.rows).toBe(2);
    const lines = r.csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      '"employee_number","given_name","family_name","site","date","clock_in","clock_out","break_minutes","worked_minutes","worked_hours","on_rota"',
    );
    expect(lines).toContain(
      `"TS-Ana","Ana","Sheet","zulu Hospitality Ltd site","${DAY}","10:00","${DAY} 16:00","0","360","6.00","yes"`.replace(
        "zulu Hospitality Ltd site",
        lines[1]!.split('","')[3]!,
      ),
    );
    expect(r.csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(r.csv).toContain('"450","7.50","no"');
    expect(r.csv).not.toMatch(/£|\bpay\b|rate/i);
    // Another week, not approved: nothing.
    const none = ok(
      await run(owner, (tx, x) =>
        att.exportApprovedHours(
          tx,
          x,
          rota.addDays(WEEK, 7),
          rota.addDays(WEEK, 13),
          AFTER,
        ),
      ),
    );
    expect(none.rows).toBe(0);
  });

  it("formats hours exactly", () => {
    expect(att.hoursDecimal(0)).toBe("0.00");
    expect(att.hoursDecimal(1)).toBe("0.02");
    expect(att.hoursDecimal(450)).toBe("7.50");
    expect(att.hoursDecimal(605)).toBe("10.08");
    expect(att.csvCell("+1")).toBe(`"'+1"`);
    expect(att.csvCell("-1")).toBe(`"'-1"`);
    expect(att.csvCell("@a")).toBe(`"'@a"`);
    expect(att.csvCell('a"b')).toBe(`"a""b"`);
  });
});

describe("reopening", () => {
  it("needs a reason, is kept in the history, and unlocks the week", async () => {
    expect(
      await run(manager, (tx, x) =>
        att.reopenTimesheet(tx, x, A.siteId, WEEK, " "),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    ok(
      await run(manager, (tx, x) =>
        att.reopenTimesheet(tx, x, A.siteId, WEEK, "Ana started at 10:05"),
      ),
    );
    ok(
      await run(manager, (tx, x) =>
        att.correctEntry(
          tx,
          x,
          anaEntry,
          { clockIn: `${DAY}T10:05`, clockOut: `${DAY}T16:00`, reason: "Late" },
          AFTER,
        ),
      ),
    );
    const t = await run(manager, (tx, x) =>
      att.timesheet(tx, x, A.siteId, WEEK, AFTER),
    );
    expect(t!.status).toBe("open");
    expect(t!.events.map((e) => [e.kind, e.reason])).toEqual([
      ["approved", null],
      ["reopened", "Ana started at 10:05"],
    ]);
  });
});

describe("audit and the database itself", () => {
  it("audits with ids only, never reasons", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS detail FROM audit_event
             WHERE tenant_id = $1 AND action IN ('attendance.timesheet_approved',
               'attendance.timesheet_reopened', 'attendance.hours_exported')`,
            [A.tenantId],
          )
        ).rows as { action: string; detail: string }[],
    );
    expect(rows.map((r) => r.action).sort()).toEqual([
      "attendance.hours_exported",
      "attendance.hours_exported",
      "attendance.timesheet_approved",
      "attendance.timesheet_reopened",
    ]);
    for (const r of rows) expect(r.detail).not.toMatch(/Ana started/);
  });

  it("keeps events append-only, weeks on Mondays, and has no DELETE", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of ["timesheet", "timesheet_event"])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      for (const col of ["site_id", "week_start", "tenant_id"])
        await expect(
          c.query(`UPDATE timesheet SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) => c.query(`UPDATE timesheet_event SET reason = 'x'`)),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO timesheet (tenant_id, site_id, week_start) VALUES ($1, $2, $3)`,
          [A.tenantId, site2, rota.addDays(WEEK, 2)],
        ),
      ),
    ).rejects.toThrow(/timesheet_monday/);
  });
});
