// M15 interactive courses, run as the real application role: only training
// managers import; learners reach only courses that apply to them; the answer
// key never leaves the server; finals are drawn and marked on the server; a
// pass makes the record (or waits for a practical sign-off); certificates are
// for the person and their managers; attempts can't be changed after marking;
// other organisations see nothing. Synthetic data only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as tr from "@/modules/training";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  type TenantFixture,
} from "../helpers/db";
import { syntheticCourse } from "../helpers/course-fixture";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let me: Ready;
let colleague: Ready;
let otherOwner: Ready;
let myRecord: string;
let course: string; // interactive, no practical, required for everyone
let practicalCourse: string; // interactive with a practical sign-off
const TODAY = "2026-11-20";

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready): tr.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: tr.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: tr.Result<T>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
const file = (o: unknown, name = "course.json") => ({
  name,
  text: JSON.stringify(o),
});

async function worker(tenantId: string, n: string, linked: boolean) {
  const userId = await createUser("worker");
  await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id)
       SELECT $1, $2, id FROM role WHERE tenant_id = $1 AND key = 'worker'`,
      [tenantId, m.rows[0]!.id],
    );
    if (linked)
      await c.query(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, membership_id, status, start_date, job_title)
         VALUES ($1, $2, 'Tess', 'Learner', $3, $4, 'active', '2026-11-01', 'Server')`,
        [tenantId, `E-${n}`, A.siteId, m.rows[0]!.id],
      );
  });
  return userId;
}

const allAnswers = (n: number) => Array.from({ length: n }, () => 1);
const moduleAnswers = [1, true];

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "coursea");
  B = await createTenantFixture(db, "courseb");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  me = await ws(await worker(A.tenantId, "L1", true));
  colleague = await ws(await worker(A.tenantId, "L2", true));
  myRecord = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `SELECT id FROM employee WHERE tenant_id = $1 AND employee_number = 'E-L1'`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("importing course files", () => {
  it("only training managers can import", async () => {
    const r = await run(me, (tx, a) =>
      tr.importCourses(tx, a, [file(syntheticCourse())], true),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden");
  });

  it("imports valid files, reports invalid ones and adds the job-title rules", async () => {
    const out = ok(
      await run(owner, (tx, a) =>
        tr.importCourses(
          tx,
          a,
          [
            file(
              syntheticCourse({
                requirements: [
                  { jobTitle: "Server", mandatory: true, dueDays: 0 },
                  { jobTitle: "Head Chef", mandatory: false, dueDays: 30 },
                ],
              }),
              "SYN1.json",
            ),
            file(
              syntheticCourse({
                code: "SYN2",
                name: "Slicer safety",
                practical: "A trainer watches you use the **slicer**.",
              }),
              "SYN2.json",
            ),
            { name: "broken.json", text: "{nope" },
            file(
              { ...syntheticCourse(), code: "BAD", formatVersion: 9 },
              "bad.json",
            ),
          ],
          true,
        ),
      ),
    ).outcomes;
    expect(out.map((o) => o.ok)).toEqual([true, true, false, false]);
    expect(out[0]!.message).toContain("2 job-title rules");
    course = out[0]!.courseId!;
    practicalCourse = out[1]!.courseId!;
    const c = ok({
      ok: true,
      data: await run(owner, (tx, a) => tr.getCourse(tx, a, course)),
    })!;
    expect(c.completionMethod).toBe("interactive");
    expect(c.rules.map((r) => r.target).sort()).toEqual([
      "Job title: Head Chef",
      "Job title: Server",
    ]);
    // The practical course applies to everyone.
    ok(
      await run(owner, (tx, a) =>
        tr.saveRule(tx, a, practicalCourse, null, {
          scope: "organisation",
          mandatory: true,
          dueDays: 14,
        }),
      ),
    );
  });

  it("re-importing the same file changes nothing; a changed file adds a version", async () => {
    const same = ok(
      await run(owner, (tx, a) =>
        tr.importCourses(tx, a, [file(syntheticCourse())], true),
      ),
    ).outcomes[0]!;
    expect(same.message).toContain("already up to date");
    const changed = syntheticCourse();
    changed.intro = "A revised **synthetic** course.";
    const v2 = ok(
      await run(owner, (tx, a) =>
        tr.importCourses(tx, a, [file(changed)], true),
      ),
    ).outcomes[0]!;
    expect(v2.message).toContain("version 2");
    const summary = await run(owner, (tx, a) =>
      tr.coursePackageSummary(tx, a, course),
    );
    expect(summary).toMatchObject({
      version: 2,
      finalCount: 4,
      safetyQuestions: 2,
    });
    const rules = await run(owner, (tx, a) => tr.getCourse(tx, a, course));
    expect(rules!.rules).toHaveLength(2); // no duplicate rules on update
  });

  it("interactive courses can't be created by hand", async () => {
    const r = await run(owner, (tx, a) =>
      tr.saveCourse(tx, a, null, {
        name: "Hand made",
        category: "other",
        kind: "internal",
        completionMethod: "interactive",
        certificateExpected: false,
        validityMonths: "",
        warnDays: 60,
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("learning", () => {
  it("never sends the answer key to the learner", async () => {
    const view = await run(me, (tx, a) =>
      tr.learnerCourse(tx, a, course, TODAY),
    );
    expect(view).not.toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('"why"');
    expect(view!.final.unlocked).toBe(false);
    expect(view!.state).toBe("learning");
  });

  it("other organisations and courses that don't apply: not found", async () => {
    expect(
      await run(otherOwner, (tx, a) => tr.learnerCourse(tx, a, course, TODAY)),
    ).toBeNull();
    expect(
      await run(otherOwner, (tx, a) => tr.coursePackageSummary(tx, a, course)),
    ).toBeNull();
    // The owner has no linked staff record: nothing to learn.
    expect(
      await run(owner, (tx, a) => tr.learnerCourse(tx, a, course, TODAY)),
    ).toBeNull();
  });

  it("the final stays locked until every module quiz is passed", async () => {
    const r = await run(me, (tx, a) => tr.startFinal(tx, a, course, TODAY));
    expect(r.ok).toBe(false);
    const fail = ok(
      await run(me, (tx, a) =>
        tr.submitModuleQuiz(tx, a, course, 0, [0, false]),
      ),
    );
    expect(fail.passed).toBe(false);
    expect(fail.feedback[0]!.why).toBeTruthy(); // explanations after submitting
    const pass = ok(
      await run(me, (tx, a) =>
        tr.submitModuleQuiz(tx, a, course, 0, moduleAnswers),
      ),
    );
    expect(pass).toMatchObject({ passed: true, scorePercent: 100 });
    // A module without a quiz can't be "submitted".
    expect(
      (await run(me, (tx, a) => tr.submitModuleQuiz(tx, a, course, 1, []))).ok,
    ).toBe(false);
    const view = await run(me, (tx, a) =>
      tr.learnerCourse(tx, a, course, TODAY),
    );
    expect(view!.final.unlocked).toBe(true);
  });

  it("finals are drawn by the server, include every safety question, and fail on a wrong safety answer", async () => {
    const start = ok(
      await run(me, (tx, a) => tr.startFinal(tx, a, course, TODAY)),
    );
    expect(start.questions).toHaveLength(4);
    expect(start.questions.filter((q) => q.safety)).toHaveLength(2);
    expect(JSON.stringify(start)).not.toContain('"answer"');
    const answers = start.questions.map((q) => (q.safety ? 0 : 1));
    const r = ok(
      await run(me, (tx, a) =>
        tr.submitFinal(tx, a, course, start.attemptId, answers, TODAY),
      ),
    );
    expect(r).toMatchObject({
      passed: false,
      safetyMissed: 2,
      completed: false,
    });
    // Marked once only.
    const again = await run(me, (tx, a) =>
      tr.submitFinal(tx, a, course, start.attemptId, allAnswers(4), TODAY),
    );
    expect(again.ok).toBe(false);
  });

  it("someone else's attempt, and timed-out attempts, can't be submitted", async () => {
    const start = ok(
      await run(me, (tx, a) => tr.startFinal(tx, a, course, TODAY)),
    );
    const theirs = await run(colleague, (tx, a) =>
      tr.submitFinal(tx, a, course, start.attemptId, allAnswers(4), TODAY),
    );
    expect(theirs.ok).toBe(false);
    // An attempt started four hours ago (attempts can't be edited, so insert one).
    const old = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO training_attempt (tenant_id, employee_id, course_id, package_id, part, question_ids, started_at)
             SELECT tenant_id, employee_id, course_id, package_id, 'final', question_ids, now() - interval '4 hours'
             FROM training_attempt WHERE id = $1 RETURNING id`,
            [start.attemptId],
          )
        ).rows[0]!.id,
    );
    const late = await run(me, (tx, a) =>
      tr.submitFinal(tx, a, course, old, allAnswers(4), TODAY),
    );
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.message).toContain("timed out");
  });

  it("passing the final makes the training record and a certificate", async () => {
    const start = ok(
      await run(me, (tx, a) => tr.startFinal(tx, a, course, TODAY)),
    );
    const r = ok(
      await run(me, (tx, a) =>
        tr.submitFinal(tx, a, course, start.attemptId, allAnswers(4), TODAY),
      ),
    );
    expect(r).toMatchObject({
      passed: true,
      completed: true,
      scorePercent: 100,
    });
    const view = (await run(me, (tx, a) =>
      tr.learnerCourse(tx, a, course, TODAY),
    ))!;
    expect(view.state).toBe("complete");
    expect(view.status.status).toBe("up_to_date");
    expect(view.status.expiresOn).toBe("2027-11-20");
    const recordId = view.certificateRecordId!;
    const rec = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT method, self_completed, course_version FROM training_record WHERE id = $1`,
            [recordId],
          )
        ).rows[0],
    );
    expect(rec).toEqual({
      method: "assessment",
      self_completed: true,
      course_version: 2,
    });
    const cert = await run(me, (tx, a) => tr.certificateFacts(tx, a, recordId));
    expect(cert).toMatchObject({
      scorePercent: 100,
      code: "SYN1",
      signedOffBy: null,
    });
    expect(cert!.certificateNo).toMatch(/^TH-SYN1-2026-[0-9A-F]{8}$/);
    // Managers see it; colleagues and other organisations don't.
    expect(
      await run(owner, (tx, a) => tr.certificateFacts(tx, a, recordId)),
    ).not.toBeNull();
    expect(
      await run(colleague, (tx, a) => tr.certificateFacts(tx, a, recordId)),
    ).toBeNull();
    expect(
      await run(otherOwner, (tx, a) => tr.certificateFacts(tx, a, recordId)),
    ).toBeNull();
  });
});

describe("practical sign-off", () => {
  it("a pass waits for a manager's sign-off, which makes the record", async () => {
    ok(
      await run(me, (tx, a) =>
        tr.submitModuleQuiz(tx, a, practicalCourse, 0, moduleAnswers),
      ),
    );
    const start = ok(
      await run(me, (tx, a) => tr.startFinal(tx, a, practicalCourse, TODAY)),
    );
    const r = ok(
      await run(me, (tx, a) =>
        tr.submitFinal(
          tx,
          a,
          practicalCourse,
          start.attemptId,
          allAnswers(4),
          TODAY,
        ),
      ),
    );
    expect(r).toMatchObject({
      passed: true,
      completed: false,
      awaitingSignOff: true,
    });
    const view = (await run(me, (tx, a) =>
      tr.learnerCourse(tx, a, practicalCourse, TODAY),
    ))!;
    expect(view.state).toBe("awaiting_signoff");
    expect(view.status.status).not.toBe("up_to_date");
    // Can't start another final while waiting.
    expect(
      (await run(me, (tx, a) => tr.startFinal(tx, a, practicalCourse, TODAY)))
        .ok,
    ).toBe(false);

    const waiting = await run(owner, (tx, a) =>
      tr.awaitingSignOff(tx, a, practicalCourse),
    );
    expect(waiting.map((w) => w.employeeId)).toEqual([myRecord]);
    expect(
      await run(otherOwner, (tx, a) =>
        tr.awaitingSignOff(tx, a, practicalCourse),
      ),
    ).toEqual([]);

    const self = await run(me, (tx, a) =>
      tr.signOffPractical(tx, a, practicalCourse, myRecord, TODAY),
    );
    expect(self.ok).toBe(false);
    const other = await run(otherOwner, (tx, a) =>
      tr.signOffPractical(tx, a, practicalCourse, myRecord, TODAY),
    );
    expect(other.ok).toBe(false);

    const signed = ok(
      await run(owner, (tx, a) =>
        tr.signOffPractical(tx, a, practicalCourse, myRecord, TODAY),
      ),
    );
    const done = (await run(me, (tx, a) =>
      tr.learnerCourse(tx, a, practicalCourse, TODAY),
    ))!;
    expect(done.state).toBe("complete");
    const cert = await run(me, (tx, a) =>
      tr.certificateFacts(tx, a, signed.id),
    );
    expect(cert!.signedOffBy).toBeTruthy();
    // Signed off once: nothing left to sign.
    expect(
      await run(owner, (tx, a) => tr.awaitingSignOff(tx, a, practicalCourse)),
    ).toEqual([]);
    expect(
      (
        await run(owner, (tx, a) =>
          tr.signOffPractical(tx, a, practicalCourse, myRecord, TODAY),
        )
      ).ok,
    ).toBe(false);
  });
});

describe("database posture", () => {
  it("marked attempts can't be changed or deleted, even by the owner role", async () => {
    const id = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM training_attempt WHERE tenant_id = $1 AND submitted_at IS NOT NULL LIMIT 1`,
            [A.tenantId],
          )
        ).rows[0]!.id,
    );
    await expect(
      admin((c) =>
        c.query(`UPDATE training_attempt SET passed = true WHERE id = $1`, [
          id,
        ]),
      ),
    ).rejects.toThrow(/can not change/);
    await expect(
      admin((c) => c.query(`DELETE FROM training_attempt WHERE id = $1`, [id])),
    ).rejects.toThrow(/never deleted/);
  });

  it("the app role can't write packages or attempts for another organisation", async () => {
    await expect(
      run(owner, (tx) =>
        tx.trainingCoursePackage.create({
          data: {
            tenantId: B.tenantId,
            courseId: course,
            version: 99,
            code: "X",
            format: "hotrock-course",
            content: {},
            finalCount: 1,
            passPercent: 80,
            modulePassPercent: 75,
            createdBy: A.ownerUserId,
          },
        }),
      ),
    ).rejects.toThrow();
    const seen = await run(otherOwner, (tx) => tx.trainingAttempt.count());
    expect(seen).toBe(0);
  });

  it("audit events hold ids and scores, never answers", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ action: string; detail: string }>(
            `SELECT action, detail::text AS detail FROM audit_event
             WHERE tenant_id = $1 AND action LIKE 'training.%'`,
            [A.tenantId],
          )
        ).rows,
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "training.course_imported",
      "training.attempt_submitted",
      "training.course_passed",
      "training.practical_signed_off",
      "training.certificate_downloaded",
    ])
      expect(actions).toContain(a);
    for (const r of rows) expect(r.detail).not.toMatch(/answer|why|options/);
  });
});
