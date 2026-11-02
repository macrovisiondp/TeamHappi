// M10.1 rota, run as the real application role: who can see, change and
// publish a site's week; the right-to-work block (yes/no only) and the
// double-booking block; warnings that need a written reason (kept off the
// audit trail); history of changes after publishing (append-only); copying
// last week; isolation and database posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";
import * as rota from "@/modules/rota";
import * as tr from "@/modules/training";

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
let siteManager: Ready; // A's first site
let otherSiteManager: Ready; // A's second site
let recruiter: Ready;
let worker: Ready;
let otherOwner: Ready;
let site2: string;
let otherTeam: string; // a team at site2
let ana: string; // right to work recorded
let ben: string; // no right-to-work check
let cal: string; // right to work recorded, mandatory training overdue
const WEEK = "2027-03-01"; // a Monday
const NEXT = "2027-03-08";
const TODAY = "2026-11-02";

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
async function member(
  tenantId: string,
  roleKey: string,
  siteId: string | null = null,
) {
  const userId = await createUser(roleKey.replace("_", ""));
  await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $4 FROM role WHERE tenant_id = $1 AND key = $3`,
      [tenantId, m.rows[0]!.id, roleKey, siteId],
    );
  });
  return userId;
}
const employee = (number: string, given: string, siteId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, start_date, status)
           VALUES ($1, $2, $3, 'Rota', $4, 'Bartender', '2026-10-01', 'active') RETURNING id`,
          [A.tenantId, number, given, siteId],
        )
      ).rows[0]!.id,
  );
const listA = {
  method: "manual_document",
  listType: "list_a",
  checkedOn: "2026-10-15",
  personPresent: true,
  outcome: "confirmed",
};
const add = (
  w: Ready,
  day: string,
  start: string,
  end: string,
  extra: Record<string, unknown> = {},
  week = WEEK,
) =>
  run(w, (tx, a) =>
    rota.saveShift(tx, a, A.siteId, week, null, {
      day,
      start,
      end,
      breakMinutes: "30",
      ...extra,
    }),
  );
const auditFor = (targetId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string }>(
          `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1 ORDER BY occurred_at, id`,
          [targetId],
        )
      ).rows,
  );
const changes = (shiftId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ kind: string; detail: string }>(
          `SELECT kind, detail::text AS detail FROM shift_change WHERE shift_id = $1 ORDER BY occurred_at, id`,
          [shiftId],
        )
      ).rows,
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "romeo");
  B = await createTenantFixture(db, "sierra");
  owner = await ws(A.ownerUserId);
  site2 = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'R2', 'romeo North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  otherTeam = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO team (tenant_id, site_id, name) VALUES ($1, $2, 'North bar') RETURNING id`,
          [A.tenantId, site2],
        )
      ).rows[0]!.id,
  );
  siteManager = await ws(await member(A.tenantId, "site_manager", A.siteId));
  otherSiteManager = await ws(await member(A.tenantId, "site_manager", site2));
  recruiter = await ws(await member(A.tenantId, "recruiter"));
  worker = await ws(await member(A.tenantId, "worker"));
  otherOwner = await ws(B.ownerUserId);
  ana = await employee("R-1", "Ana", A.siteId);
  ben = await employee("R-2", "Ben", A.siteId);
  cal = await employee("R-3", "Cal", A.siteId);
  for (const id of [ana, cal])
    ok(await run(owner, (tx, a) => ob.recordRtwCheck(tx, a, id, TODAY, listA)));
  const course = ok(
    await run(owner, (tx, a) =>
      tr.saveCourse(tx, a, null, {
        name: "Cellar safety",
        category: "other",
        kind: "internal",
        completionMethod: "in_person",
        certificateExpected: false,
        validityMonths: "",
        warnDays: 60,
      }),
    ),
  ).id;
  ok(
    await run(owner, (tx, a) =>
      tr.saveRule(tx, a, course, null, {
        scope: "employee",
        employeeId: cal,
        mandatory: true,
        dueDays: 0,
      }),
    ),
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("who can see and change a site's rota", () => {
  it("site managers see their sites only; recruiters, workers and other organisations see nothing", async () => {
    expect((await run(siteManager, rota.rotaSites)).map((s) => s.id)).toEqual([
      A.siteId,
    ]);
    expect(await run(recruiter, rota.rotaSites)).toEqual([]);
    expect(await run(worker, rota.rotaSites)).toEqual([]);
    for (const w of [otherSiteManager, recruiter, worker, otherOwner])
      expect(
        await run(w, (tx, a) => rota.getWeek(tx, a, A.siteId, WEEK)),
      ).toBeNull();
    const week = (await run(siteManager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, "2027-03-03"),
    ))!;
    expect(week).toMatchObject({
      weekStart: WEEK,
      status: "draft",
      can: { manage: true, publish: true },
      shifts: [],
    });
    expect(week.people.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Ana Rota", "Ben Rota", "Cal Rota"]),
    );
  });

  it("adds shifts with checked times, team and day; others are refused", async () => {
    expect(
      await run(otherSiteManager, (tx, a) =>
        rota.saveShift(tx, a, A.siteId, WEEK, null, {
          day: WEEK,
          start: "09:00",
          end: "17:00",
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await add(siteManager, "2027-03-09", "09:00", "17:00"),
    ).toMatchObject({ ok: false, fieldErrors: { day: expect.any(String) } });
    expect(
      await add(siteManager, WEEK, "09:00", "17:00", { teamId: otherTeam }),
    ).toMatchObject({ ok: false, fieldErrors: { teamId: expect.any(String) } });
    expect(
      await run(siteManager, (tx, a) =>
        rota.saveShift(tx, a, A.siteId, "2027-03-03", null, {
          day: "2027-03-03",
          start: "09:00",
          end: "17:00",
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    const id = ok(
      await add(siteManager, WEEK, "09:00", "17:00", {
        roleLabel: "Bar",
        teamId: A.teamId,
      }),
    ).id;
    const week = (await run(siteManager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    expect(week.shifts).toMatchObject([
      {
        id,
        day: WEEK,
        start: "09:00",
        end: "17:00",
        minutes: 450,
        roleLabel: "Bar",
        assignee: null,
      },
    ]);
    expect(week.openShifts).toBe(1);
  });
});

describe("assigning people", () => {
  let mon: string;
  let monLate: string;
  let tueEarly: string;

  beforeAll(async () => {
    const week = (await run(siteManager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    mon = week.shifts[0]!.id;
    monLate = ok(await add(siteManager, WEEK, "16:00", "22:00")).id;
    tueEarly = ok(
      await add(siteManager, "2027-03-02", "03:00", "08:00", {
        breakMinutes: "0",
      }),
    ).id;
  });

  it("blocks people without a right-to-work check for the date, without revealing anything else", async () => {
    const r = await run(siteManager, (tx, a) =>
      rota.assignShift(tx, a, mon, ben, ""),
    );
    expect(r).toMatchObject({ ok: false, code: "conflict" });
    expect(!r.ok && r.warnings?.map((w) => w.code)).toEqual(["no_rtw"]);
    // A reason doesn't get past a block.
    expect(
      await run(siteManager, (tx, a) =>
        rota.assignShift(tx, a, mon, ben, "We're short"),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("assigns when every check passes, audited with ids only", async () => {
    ok(
      await run(siteManager, (tx, a) => rota.assignShift(tx, a, mon, ana, "")),
    );
    const events = await auditFor(mon);
    expect(events.map((e) => e.action)).toEqual(["rota.shift_assigned"]);
    expect(JSON.parse(events[0]!.detail)).toEqual({
      employeeId: ana,
      previousEmployeeId: null,
      overridden: null,
    });
  });

  it("blocks double-booking the same person", async () => {
    const r = await run(siteManager, (tx, a) =>
      rota.assignShift(tx, a, monLate, ana, "fine"),
    );
    expect(!r.ok && r.warnings?.map((w) => w.code)).toEqual(["overlap"]);
  });

  it("asks for a reason on warnings, keeps it on the assignment and out of the audit", async () => {
    const first = await run(siteManager, (tx, a) =>
      rota.assignShift(tx, a, tueEarly, ana, ""),
    );
    expect(first).toMatchObject({ ok: false, code: "needs_reason" });
    expect(!first.ok && first.warnings?.map((w) => w.code)).toEqual([
      "short_rest",
    ]);
    ok(
      await run(siteManager, (tx, a) =>
        rota.assignShift(
          tx,
          a,
          tueEarly,
          ana,
          "Covering a stock delivery, agreed with Ana",
        ),
      ),
    );
    const row = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT override_reason FROM shift_assignment WHERE shift_id = $1 AND removed_at IS NULL`,
            [tueEarly],
          )
        ).rows[0],
    );
    expect(row.override_reason).toMatch(/stock delivery/);
    const events = await auditFor(tueEarly);
    expect(JSON.parse(events.at(-1)!.detail)).toMatchObject({
      overridden: "short_rest",
    });
    for (const e of events) expect(e.detail).not.toMatch(/stock delivery/);
    // The grid shows the warning, and that it was assigned anyway.
    const week = (await run(siteManager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    const s = week.shifts.find((x) => x.id === tueEarly)!;
    expect(s.assignee).toMatchObject({ id: ana, overridden: true });
    expect(s.warnings.map((w) => w.code)).toEqual(["short_rest"]);
    expect(week.people.find((p) => p.id === ana)).toMatchObject({
      minutes: 450 + 300,
    });
  });

  it("warns about overdue mandatory training on the shift date", async () => {
    const r = await run(siteManager, (tx, a) =>
      rota.assignShift(tx, a, monLate, cal, ""),
    );
    expect(r).toMatchObject({ ok: false, code: "needs_reason" });
    expect(!r.ok && r.warnings?.map((w) => w.message).join(" ")).toMatch(
      /Cellar safety/,
    );
  });

  it("other organisations and workers can't assign or see shifts", async () => {
    for (const w of [otherOwner, worker, otherSiteManager])
      expect(
        await run(w, (tx, a) => rota.assignShift(tx, a, monLate, cal, "x")),
      ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(siteManager, (tx, a) =>
        rota.assignShift(tx, a, monLate, B.ownerUserId, ""),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("publishing and changes afterwards", () => {
  it("only people with rota.publish at the site; once; and history starts after it", async () => {
    expect(
      await run(otherSiteManager, (tx, a) =>
        rota.publishWeek(tx, a, A.siteId, WEEK),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(siteManager, (tx, a) =>
        rota.publishWeek(tx, a, A.siteId, NEXT),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const weekId = ok(
      await run(siteManager, (tx, a) =>
        rota.publishWeek(tx, a, A.siteId, WEEK),
      ),
    ).id;
    expect(
      await run(siteManager, (tx, a) =>
        rota.publishWeek(tx, a, A.siteId, WEEK),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect((await auditFor(weekId)).map((e) => e.action)).toEqual([
      "rota.week_published",
    ]);

    const week = (await run(siteManager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, WEEK),
    ))!;
    expect(week.status).toBe("published");
    const mon = week.shifts.find((s) => s.start === "09:00")!;
    expect(await changes(mon.id)).toEqual([]);
    ok(
      await run(siteManager, (tx, a) =>
        rota.saveShift(tx, a, A.siteId, WEEK, mon.id, {
          day: WEEK,
          start: "10:00",
          end: "17:00",
          breakMinutes: "30",
        }),
      ),
    );
    ok(await run(siteManager, (tx, a) => rota.unassignShift(tx, a, mon.id)));
    ok(await run(siteManager, (tx, a) => rota.cancelShift(tx, a, mon.id)));
    expect((await changes(mon.id)).map((c) => c.kind)).toEqual([
      "updated",
      "unassigned",
      "cancelled",
    ]);
    expect((await auditFor(mon.id)).map((e) => e.action)).toContain(
      "rota.shift_cancelled",
    );
    expect(
      await run(siteManager, (tx, a) =>
        rota.assignShift(tx, a, mon.id, ana, ""),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("copies last week into an empty week, keeping people only where every check passes", async () => {
    // Last week now has: Mon 16-22 (open) and Tue 03-08 Ana. Her short-rest
    // warning came from the Monday shift that was cancelled, so in the new week
    // every check passes and she's kept.
    const r = ok(
      await run(siteManager, (tx, a) =>
        rota.copyPreviousWeek(tx, a, A.siteId, NEXT),
      ),
    );
    expect(r).toEqual({ copied: 2, withPeople: 1, leftOpen: 0, skipped: 0 });
    const next = (await run(siteManager, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, NEXT),
    ))!;
    expect(next.status).toBe("draft");
    expect(
      next.shifts.map(
        (s) => `${s.day} ${s.start}-${s.end} ${s.assignee?.id ?? "open"}`,
      ),
    ).toEqual(["2027-03-08 16:00-22:00 open", `2027-03-09 03:00-08:00 ${ana}`]);
    expect(
      await run(siteManager, (tx, a) =>
        rota.copyPreviousWeek(tx, a, A.siteId, NEXT),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("the database itself", () => {
  const tables = ["rota_week", "shift", "shift_assignment", "shift_change"];

  it("has no DELETE, fixes a shift's week and site, and keeps change history append-only", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of tables)
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        c.query(`UPDATE shift SET site_id = site_id`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE shift SET rota_week_id = rota_week_id`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE shift_assignment SET employee_id = employee_id`),
      ).rejects.toThrow(/permission denied/);
      for (const t of tables)
        expect((await c.query(`SELECT 1 FROM ${t}`)).rows, t).toEqual([]);
    });
    await expect(
      admin((c) =>
        c.query(
          `UPDATE shift_change SET kind = 'created' WHERE tenant_id = $1`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO rota_week (tenant_id, site_id, week_start) VALUES ($1, $2, '2027-03-03')`,
          [A.tenantId, A.siteId],
        ),
      ),
    ).rejects.toThrow(/rota_week_monday/);
    // A shift can't sit in another site's week.
    await expect(
      admin(async (c) => {
        const w = (
          await c.query(
            `SELECT id FROM rota_week WHERE tenant_id = $1 AND week_start = $2`,
            [A.tenantId, WEEK],
          )
        ).rows[0].id;
        await c.query(
          `INSERT INTO shift (tenant_id, rota_week_id, site_id, starts_at, ends_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`,
          [A.tenantId, w, site2],
        );
      }),
    ).rejects.toThrow(/shift_week_fkey/);
    await expect(
      admin(async (c) => {
        const w = (
          await c.query(
            `SELECT id FROM rota_week WHERE tenant_id = $1 AND week_start = $2`,
            [A.tenantId, WEEK],
          )
        ).rows[0].id;
        await c.query(
          `INSERT INTO shift (tenant_id, rota_week_id, site_id, starts_at, ends_at) VALUES ($1, $2, $3, now(), now() + interval '17 hours')`,
          [A.tenantId, w, A.siteId],
        );
      }),
    ).rejects.toThrow(/shift_times/);
  });

  it("built-in roles have exactly the rota permissions in the code", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ key: string; codes: string }>(
            `SELECT r.key, string_agg(rp.permission_code, ',' ORDER BY rp.permission_code) AS codes
             FROM role r LEFT JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code LIKE 'rota.%'
             WHERE r.tenant_id = $1 AND r.is_system GROUP BY r.key ORDER BY r.key`,
            [A.tenantId],
          )
        ).rows,
    );
    const all = "rota.manage,rota.publish,rota.view";
    expect(Object.fromEntries(rows.map((r) => [r.key, r.codes]))).toEqual({
      admin: all,
      hr_manager: all,
      owner: all,
      recruiter: null,
      site_manager: all,
      worker: null,
    });
  });
});
