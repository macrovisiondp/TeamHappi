// M9.1 recruitment, run as the real application role: permissions and site
// scope, candidates never merged automatically, the pipeline rules, notes and
// interviews (interviewers see only their own), hire creating exactly one
// employee and starting onboarding, retention review, isolation, audit and
// database posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";
import * as rc from "@/modules/recruitment";

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
let hr: Ready;
let siteManager: Ready; // A's first site only
let recruiter: Ready;
let worker: Ready; // will be an interviewer
let otherWorker: Ready;
let otherOwner: Ready;
let site2: string;
let vacancy: string; // at A's site
const TODAY = "2026-10-20";
const TZ = "Europe/London";

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready): rc.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
/** Like the workspace wrapper: a Rollback undoes the transaction and becomes the result. */
async function run<T>(w: Ready, fn: (tx: TenantTx, a: rc.Actor) => Promise<T>) {
  try {
    return await withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
  } catch (e) {
    if (e instanceof rc.Rollback) return e.result as T;
    throw e;
  }
}
const ok = <T>(r: rc.Result<T> | ob.Result<T>) => {
  if (!r.ok)
    throw new Error(
      `${r.code}: ${r.message} ${JSON.stringify(r.fieldErrors ?? {})}`,
    );
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
const auditFor = (targetId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string }>(
          `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1 ORDER BY occurred_at`,
          [targetId],
        )
      ).rows,
  );
const vacancyRaw = (siteId: string, extra: Record<string, unknown> = {}) => ({
  title: "Weekend bartender",
  jobTitle: "Bartender",
  siteId,
  employmentType: "part_time",
  openings: 2,
  ...extra,
});
const applicant = (
  given: string,
  email: string,
  extra: Record<string, unknown> = {},
) => ({
  givenName: given,
  familyName: "Applicant",
  email,
  ...extra,
});

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "xray");
  B = await createTenantFixture(db, "yankee");
  owner = await ws(A.ownerUserId);
  hr = await ws(await member(A.tenantId, "hr_manager"));
  siteManager = await ws(await member(A.tenantId, "site_manager", A.siteId));
  recruiter = await ws(await member(A.tenantId, "recruiter"));
  worker = await ws(await member(A.tenantId, "worker"));
  otherWorker = await ws(await member(A.tenantId, "worker"));
  otherOwner = await ws(B.ownerUserId);
  site2 = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'X2', 'xray North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("vacancies and site scope", () => {
  it("site managers create only at their sites; workers can't; other organisations' sites are refused", async () => {
    expect(
      await run(siteManager, (tx, a) =>
        rc.saveVacancy(tx, a, null, vacancyRaw(site2)),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { siteId: expect.any(String) },
    });
    expect(
      await run(owner, (tx, a) =>
        rc.saveVacancy(tx, a, null, vacancyRaw(B.siteId)),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { siteId: expect.any(String) },
    });
    expect(
      await run(worker, (tx, a) =>
        rc.saveVacancy(tx, a, null, vacancyRaw(A.siteId)),
      ),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    vacancy = ok(
      await run(siteManager, (tx, a) =>
        rc.saveVacancy(tx, a, null, vacancyRaw(A.siteId, { teamId: A.teamId })),
      ),
    ).id;
    ok(
      await run(owner, (tx, a) =>
        rc.saveVacancy(
          tx,
          a,
          null,
          vacancyRaw(site2, { title: "North chef", jobTitle: "Chef" }),
        ),
      ),
    );
    ok(
      await run(siteManager, (tx, a) =>
        rc.setVacancyStatus(tx, a, vacancy, "open"),
      ),
    );
    // Site managers see only their sites' vacancies; workers none; other organisations nothing.
    const sm = (await run(siteManager, (tx, a) => rc.listVacancies(tx, a)))!;
    expect(sm.vacancies.map((v) => v.title)).toEqual(["Weekend bartender"]);
    expect(await run(worker, (tx, a) => rc.listVacancies(tx, a))).toBeNull();
    expect(
      await run(otherOwner, (tx, a) => rc.getVacancy(tx, a, vacancy)),
    ).toBeNull();
    expect(
      (await run(recruiter, (tx, a) => rc.listVacancies(tx, a)))!.vacancies,
    ).toHaveLength(2);
  });

  it("pay is an optional decimal range with a period, and never in the audit trail", async () => {
    for (const [payMin, payMax, payPeriod, field] of [
      ["abc", "", "hour", "payMin"],
      ["12.00", "", "", "payPeriod"],
      ["12.00", "10.00", "hour", "payMax"],
      ["", "12.00", "hour", "payMin"],
    ] as const)
      expect(
        await run(owner, (tx, a) =>
          rc.saveVacancy(
            tx,
            a,
            vacancy,
            vacancyRaw(A.siteId, { payMin, payMax, payPeriod }),
          ),
        ),
        field,
      ).toMatchObject({
        ok: false,
        fieldErrors: { [field]: expect.any(String) },
      });
    ok(
      await run(owner, (tx, a) =>
        rc.saveVacancy(
          tx,
          a,
          vacancy,
          vacancyRaw(A.siteId, {
            payMin: "12.5",
            payMax: "14",
            payPeriod: "hour",
            teamId: A.teamId,
          }),
        ),
      ),
    );
    const v = (await run(owner, (tx, a) => rc.getVacancy(tx, a, vacancy)))!
      .vacancy;
    expect([v.payMin, v.payMax, v.payPeriod]).toEqual([
      "12.50",
      "14.00",
      "hour",
    ]);
    for (const e of await auditFor(vacancy))
      expect(e.detail).not.toMatch(/12\.5|14/);
  });
});

describe("candidates and applications (D1: never merged automatically)", () => {
  let first: string;

  it("adds applicants; the same email asks before creating another candidate", async () => {
    first = ok(
      await run(siteManager, (tx, a) =>
        rc.addApplication(tx, a, vacancy, applicant("Ana", "ana@example.test")),
      ),
    ).id;
    // Same email: not created until the manager says it's a different person.
    const vac2 = ok(
      await run(owner, (tx, a) =>
        rc.saveVacancy(tx, a, null, vacancyRaw(A.siteId, { title: "Barback" })),
      ),
    ).id;
    ok(await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vac2, "open")));
    expect(
      await run(siteManager, (tx, a) =>
        rc.addApplication(tx, a, vac2, applicant("Ana", "ANA@example.test")),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { email: expect.any(String) },
    });
    const matches = await run(siteManager, (tx, a) =>
      rc.possibleMatches(tx, a, "ana@example.test"),
    );
    expect(matches).toHaveLength(1);
    ok(
      await run(siteManager, (tx, a) =>
        rc.addApplication(
          tx,
          a,
          vac2,
          applicant("Ana", "ana@example.test", { confirmNew: true }),
        ),
      ),
    );
    expect(
      await run(siteManager, (tx, a) =>
        rc.possibleMatches(tx, a, "ana@example.test"),
      ),
    ).toHaveLength(2); // two people, not merged
    // Reusing an existing candidate is explicit; the same vacancy twice is refused.
    const candidateId = matches[0]!.id;
    expect(
      await run(siteManager, (tx, a) =>
        rc.addApplication(tx, a, vacancy, { candidateId }),
      ),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(
      await run(otherOwner, (tx, a) =>
        rc.addApplication(tx, a, vacancy, applicant("X", "x@example.test")),
      ),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
    // The audit trail never holds names or contact details.
    for (const e of await auditFor(first))
      expect(e.detail).not.toMatch(/Ana|ana@/);
  });

  it("moves through working stages only; Reject needs a reason; closed applications don't move", async () => {
    expect(
      await run(siteManager, (tx, a) => rc.moveStage(tx, a, first, "hired")),
    ).toMatchObject({ ok: false, code: "conflict" });
    ok(
      await run(siteManager, (tx, a) =>
        rc.moveStage(tx, a, first, "screening"),
      ),
    );
    const other = ok(
      await run(siteManager, (tx, a) =>
        rc.addApplication(tx, a, vacancy, applicant("Ben", "ben@example.test")),
      ),
    ).id;
    expect(
      await run(siteManager, (tx, a) =>
        rc.closeApplication(tx, a, other, { kind: "reject", reason: "" }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { reason: expect.any(String) },
    });
    ok(
      await run(siteManager, (tx, a) =>
        rc.closeApplication(tx, a, other, {
          kind: "reject",
          reason: "not_suitable",
        }),
      ),
    );
    expect(
      await run(siteManager, (tx, a) => rc.moveStage(tx, a, other, "applied")),
    ).toMatchObject({ ok: false, code: "conflict" });
    const app = (await run(owner, (tx, a) =>
      rc.getApplication(tx, a, other, TZ),
    ))!;
    expect(app.history.map((h) => h.to)).toEqual(["applied", "rejected"]);
    expect(
      await run(worker, (tx, a) => rc.moveStage(tx, a, first, "offer")),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("notes are kept with the application, never in the audit trail", async () => {
    ok(
      await run(siteManager, (tx, a) =>
        rc.addNote(tx, a, first, "Great on the phone screen"),
      ),
    );
    expect(
      (await auditFor(first)).find(
        (e) => e.action === "recruitment.note_added",
      )!.detail,
    ).not.toContain("Great");
    const app = (await run(siteManager, (tx, a) =>
      rc.getApplication(tx, a, first, TZ),
    ))!;
    expect(app.notes[0]).toMatchObject({
      body: "Great on the phone screen",
      redacted: false,
    });
  });
});

describe("interviews: interviewers see only their own", () => {
  let app: string;
  let interview: string;

  it("schedules with interviewers in the organisation's time zone", async () => {
    app = ok(
      await run(siteManager, (tx, a) =>
        rc.addApplication(tx, a, vacancy, applicant("Cal", "cal@example.test")),
      ),
    ).id;
    expect(
      await run(siteManager, (tx, a) =>
        rc.scheduleInterview(tx, a, app, TZ, {
          scheduledAt: "2026-11-03T14:30",
          durationMinutes: 30,
          format: "in_person",
          interviewerIds: [],
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { interviewerIds: expect.any(String) },
    });
    interview = ok(
      await run(siteManager, (tx, a) =>
        rc.scheduleInterview(tx, a, app, TZ, {
          scheduledAt: "2026-11-03T14:30",
          durationMinutes: 30,
          format: "in_person",
          location: "Bar",
          interviewerIds: [worker.membershipId],
        }),
      ),
    ).id;
    const row = await admin(
      async (c) =>
        (
          await c.query(`SELECT scheduled_at FROM interview WHERE id = $1`, [
            interview,
          ])
        ).rows[0],
    );
    expect(new Date(row.scheduled_at).toISOString()).toBe(
      "2026-11-03T14:30:00.000Z",
    ); // GMT in November
  });

  it("an interviewer without recruitment access sees only the basics and records an outcome", async () => {
    const view = (await run(worker, (tx, a) =>
      rc.getApplication(tx, a, app, TZ),
    ))!;
    expect(view.full).toBe(false);
    expect(view.candidate.email).toBeNull();
    expect(view.notes).toEqual([]);
    expect(view.history).toEqual([]);
    expect(view.interviews.map((i) => i.id)).toEqual([interview]);
    expect(
      await run(otherWorker, (tx, a) => rc.getApplication(tx, a, app, TZ)),
    ).toBeNull();
    // They can't move the application or cancel the interview, but they can give feedback.
    expect(
      await run(worker, (tx, a) => rc.moveStage(tx, a, app, "offer")),
    ).toMatchObject({ ok: false });
    expect(
      await run(worker, (tx, a) =>
        rc.updateInterview(tx, a, interview, TZ, { kind: "cancel" }),
      ),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    ok(
      await run(worker, (tx, a) =>
        rc.updateInterview(tx, a, interview, TZ, {
          kind: "feedback",
          outcome: "progress",
          feedback: "Calm under pressure",
        }),
      ),
    );
    expect((await auditFor(interview)).map((e) => e.action)).toEqual([
      "recruitment.interview_scheduled",
      "recruitment.interview_feedback",
    ]);
    expect((await auditFor(interview))[1]!.detail).not.toContain("Calm");
    const schedule = await run(worker, (tx, a) =>
      rc.interviewSchedule(tx, a, {
        from: new Date("2026-11-01"),
        to: new Date("2026-11-30"),
      }),
    );
    expect(schedule.map((s) => s.id)).toEqual([interview]);
    expect(
      await run(otherWorker, (tx, a) =>
        rc.interviewSchedule(tx, a, {
          from: new Date("2026-11-01"),
          to: new Date("2026-11-30"),
        }),
      ),
    ).toEqual([]);
  });
});

describe("hire → employee → onboarding (D3, D4)", () => {
  let app: string;
  let template: string;

  beforeAll(async () => {
    app = ok(
      await run(siteManager, (tx, a) =>
        rc.addApplication(
          tx,
          a,
          vacancy,
          applicant("Dee", "dee@example.test", { phone: "07700 900123" }),
        ),
      ),
    ).id;
    const t = ok(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, {
          name: "Hire flow",
          scope: "organisation",
        }),
      ),
    ).id;
    ok(
      await run(owner, (tx, a) =>
        ob.saveTemplateTask(tx, a, t, null, {
          title: "Contract",
          category: "task",
          ownerKind: "manager",
          dueOffsetDays: 0,
          required: true,
        }),
      ),
    );
    template = t;
  });

  it("needs Offer, and an owner, admin or HR manager (site managers can't hire)", async () => {
    expect(
      await run(owner, (tx, a) =>
        rc.hire(tx, a, app, { startDate: "2026-11-10" }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    ok(await run(siteManager, (tx, a) => rc.moveStage(tx, a, app, "offer")));
    expect(
      await run(siteManager, (tx, a) =>
        rc.hire(tx, a, app, { startDate: "2026-11-10" }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(recruiter, (tx, a) =>
        rc.hire(tx, a, app, { startDate: "2026-11-10" }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("if onboarding can't start, nothing is created (hire and onboarding together)", async () => {
    const before = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM employee WHERE tenant_id = $1`,
            [A.tenantId],
          )
        ).rows[0].n,
    );
    const archived = ok(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, { name: "Old", scope: "organisation" }),
      ),
    ).id;
    ok(await run(owner, (tx, a) => ob.archiveTemplate(tx, a, archived)));
    expect(
      await run(hr, (tx, a) =>
        rc.hire(tx, a, app, {
          startDate: "2026-11-10",
          startOnboarding: true,
          templateId: archived,
        }),
      ),
    ).toMatchObject({
      ok: false,
    });
    const after = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM employee WHERE tenant_id = $1`,
            [A.tenantId],
          )
        ).rows[0].n,
    );
    expect(after).toBe(before);
    expect(
      (await run(owner, (tx, a) => rc.getApplication(tx, a, app, TZ)))!.outcome,
    ).toBe("active");
  });

  it("creates exactly one employee, even when two hires race, and starts onboarding", async () => {
    const raw = {
      startDate: "2026-11-10",
      startOnboarding: true,
      templateId: template,
    };
    const results = await Promise.all([
      run(hr, (tx, a) => rc.hire(tx, a, app, raw)),
      run(owner, (tx, a) => rc.hire(tx, a, app, raw)),
    ]);
    // One wins; the other either sees the hire (already hired) or loses the claim and rolls back.
    const winners = results.filter((r) => r.ok && !r.data.alreadyHired);
    expect(winners).toHaveLength(1);
    const employees = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT id, job_title, primary_site_id, status, start_date::text, email, phone_number FROM employee WHERE tenant_id = $1 AND given_name = 'Dee'`,
            [A.tenantId],
          )
        ).rows,
    );
    expect(employees).toHaveLength(1);
    expect(employees[0]).toMatchObject({
      job_title: "Bartender",
      primary_site_id: A.siteId,
      status: "pending",
      start_date: "2026-11-10",
      email: "dee@example.test",
      phone_number: "07700 900123",
    });
    const employeeId = employees[0].id as string;
    // A retry returns the same person; no login was created.
    expect(ok(await run(hr, (tx, a) => rc.hire(tx, a, app, raw)))).toEqual({
      employeeId,
      caseId: null,
      alreadyHired: true,
    });
    const linked = await admin(
      async (c) =>
        (
          await c.query(`SELECT membership_id FROM employee WHERE id = $1`, [
            employeeId,
          ])
        ).rows[0],
    );
    expect(linked.membership_id).toBeNull();
    // Onboarding started, and the team from the vacancy was assigned.
    const onb = await run(owner, (tx, a) =>
      ob.caseForEmployee(tx, a, employeeId, TODAY),
    );
    expect(onb).toMatchObject({ status: "active", templateName: "Hire flow" });
    const team = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT 1 FROM team_member WHERE employee_id = $1 AND team_id = $2`,
            [employeeId, A.teamId],
          )
        ).rows,
    );
    expect(team).toHaveLength(1);
    expect(
      await run(owner, (tx, a) => rc.hiredFrom(tx, a, employeeId)),
    ).toMatchObject({ applicationId: app, vacancyTitle: "Weekend bartender" });
    const events = await auditFor(app);
    expect(events.map((e) => e.action)).toContain("recruitment.hired");
    expect(
      events.find((e) => e.action === "recruitment.hired")!.detail,
    ).not.toMatch(/Dee|dee@/);
  });
});

describe("retention review (D6: manual, nothing automatic)", () => {
  it("lists candidates only after the review date, and anonymises on request", async () => {
    const vac = ok(
      await run(owner, (tx, a) =>
        rc.saveVacancy(
          tx,
          a,
          null,
          vacancyRaw(A.siteId, { title: "Old role" }),
        ),
      ),
    ).id;
    ok(await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vac, "open")));
    const app = ok(
      await run(owner, (tx, a) =>
        rc.addApplication(tx, a, vac, applicant("Eve", "eve@example.test")),
      ),
    ).id;
    ok(
      await run(owner, (tx, a) =>
        rc.addNote(tx, a, app, "Personal detail to remove"),
      ),
    );
    ok(
      await run(owner, (tx, a) =>
        rc.closeApplication(tx, a, app, { kind: "withdraw" }),
      ),
    );
    const candidateId = (await run(owner, (tx, a) =>
      rc.getApplication(tx, a, app, TZ),
    ))!.candidate.id;
    // Not yet due (6 months by default).
    expect(
      (await run(owner, (tx, a) => rc.retentionReview(tx, a, TODAY)))!.due.map(
        (c) => c.id,
      ),
    ).not.toContain(candidateId);
    expect(
      await run(owner, (tx, a) =>
        rc.anonymiseCandidate(tx, a, candidateId, TODAY),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const later = "2027-12-01";
    expect(
      (await run(owner, (tx, a) => rc.retentionReview(tx, a, later)))!.due.map(
        (c) => c.id,
      ),
    ).toContain(candidateId);
    expect(
      await run(siteManager, (tx, a) =>
        rc.anonymiseCandidate(tx, a, candidateId, later),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    ok(
      await run(owner, (tx, a) =>
        rc.anonymiseCandidate(tx, a, candidateId, later),
      ),
    );
    const after = (await run(owner, (tx, a) =>
      rc.getApplication(tx, a, app, TZ),
    ))!;
    expect(after.candidate).toMatchObject({
      anonymised: true,
      email: null,
      phone: null,
      name: "Anonymised candidate",
    });
    expect(after.notes[0]).toMatchObject({ body: null, redacted: true });
    expect(after.history.map((h) => h.to)).toEqual(["applied", "withdrawn"]); // kept for reporting
    expect((await auditFor(candidateId)).map((e) => e.action)).toContain(
      "recruitment.candidate_anonymised",
    );
  });

  it("settings: only owners, admins and HR; labels for working stages; retention 3 to 12 months", async () => {
    expect(
      await run(siteManager, (tx, a) =>
        rc.saveSettings(tx, a, { labels: {}, retentionMonths: 6 }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(owner, (tx, a) =>
        rc.saveSettings(tx, a, { labels: {}, retentionMonths: 24 }),
      ),
    ).toMatchObject({ ok: false });
    ok(
      await run(hr, (tx, a) =>
        rc.saveSettings(tx, a, {
          labels: { screening: "Phone screen", hired: "x" },
          retentionMonths: 9,
        }),
      ),
    );
    const s = (await run(siteManager, (tx, a) => rc.getSettings(tx, a)))!;
    expect(s).toMatchObject({ retentionMonths: 9, canEdit: false });
    expect(s.labels.screening).toBe("Phone screen");
    expect(s.labels.hired).toBe("Hired");
  });
});

describe("the database itself", () => {
  it("has no DELETE, keeps history append-only, and enforces consistent states for every role", async () => {
    const tables = [
      "recruitment_settings",
      "vacancy",
      "candidate",
      "application",
      "application_event",
      "application_note",
      "interview",
      "interview_interviewer",
    ];
    await withPg(urls.appUrl, async (c) => {
      for (const t of tables)
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        c.query(`UPDATE application SET candidate_id = gen_random_uuid()`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE candidate SET source = 'agency'`),
      ).rejects.toThrow(/permission denied/);
      for (const t of tables)
        expect((await c.query(`SELECT 1 FROM ${t}`)).rows, t).toEqual([]);
    });
    await expect(
      admin((c) =>
        c.query(
          `UPDATE application_event SET to_stage = 'offer' WHERE tenant_id = $1`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin((c) =>
        c.query(
          `UPDATE application_note SET body = 'edited' WHERE tenant_id = $1 AND redacted_at IS NULL`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/only be redacted/);
    await expect(
      admin((c) =>
        c.query(
          `UPDATE application SET outcome = 'hired' WHERE tenant_id = $1 AND outcome = 'active'`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/application_state_consistent/);
    await expect(
      admin((c) =>
        c.query(
          `UPDATE candidate SET anonymised_at = now() WHERE tenant_id = $1 AND email IS NOT NULL`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/candidate_anonymised_blank/);
    // A vacancy can't point at another organisation's site.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO vacancy (tenant_id, title, job_title, site_id, employment_type) VALUES ($1, 't', 'j', $2, 'casual')`,
          [A.tenantId, B.siteId],
        ),
      ),
    ).rejects.toThrow(/vacancy_site_fkey/);
  });

  it("built-in roles have exactly the recruitment permissions in the code", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ key: string; perms: string }>(
            `SELECT r.key, string_agg(rp.permission_code, ',' ORDER BY rp.permission_code) AS perms
             FROM role r JOIN role_permission rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
             WHERE r.tenant_id = $1 AND rp.permission_code LIKE 'recruitment.%' GROUP BY r.key ORDER BY r.key`,
            [A.tenantId],
          )
        ).rows,
    );
    const all =
      "recruitment.hire,recruitment.manage,recruitment.settings,recruitment.view";
    expect(rows).toEqual([
      { key: "admin", perms: all },
      { key: "hr_manager", perms: all },
      { key: "owner", perms: all },
      { key: "recruiter", perms: "recruitment.manage,recruitment.view" },
      { key: "site_manager", perms: "recruitment.manage,recruitment.view" },
    ]);
  });
});
