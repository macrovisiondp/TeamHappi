// M7.2 onboarding compliance, run as the real application role: right-to-work
// records (restricted, append-only, audited views, site managers see yes/no
// only), the document checklist, "cleared to start", tenant isolation and
// database posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";

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
let siteManager: Ready; // A's site only
let worker: Ready;
let otherOwner: Ready; // organisation B
let starter: string; // a new starter at A's site
const TODAY = "2026-10-20";

const user = (userId: string) => ({
  userId,
  name: "U",
  email: "u@example.test",
});
async function ready(userId: string) {
  const w = await resolveWorkspace(db, user(userId), undefined);
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
}
const actorOf = (w: Ready): ob.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: ob.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));

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

const ok = <T>(r: ob.Result<T>) => {
  if (!r.ok)
    throw new Error(
      `${r.code}: ${r.message} ${JSON.stringify(r.fieldErrors ?? {})}`,
    );
  return r.data;
};

async function newEmployee(
  number: string,
  siteId: string | null,
  status = "pending",
) {
  return admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
           VALUES ($1, $2, 'Rae', $2, $3, $4) RETURNING id`,
          [A.tenantId, number, siteId, status],
        )
      ).rows[0]!.id,
  );
}

const auditRows = (where: string, params: unknown[]) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string; target_type: string }>(
          `SELECT action, target_type, detail::text AS detail FROM audit_event WHERE ${where} ORDER BY occurred_at`,
          params,
        )
      ).rows,
  );

const listA = {
  method: "manual_document",
  listType: "list_a",
  checkedOn: "2026-10-15",
  personPresent: true,
  outcome: "confirmed",
};

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "papa");
  B = await createTenantFixture(db, "quebec");
  owner = await ready(A.ownerUserId);
  hr = await ready(await member(A.tenantId, "hr_manager"));
  siteManager = await ready(await member(A.tenantId, "site_manager", A.siteId));
  worker = await ready(await member(A.tenantId, "worker"));
  otherOwner = await ready(B.ownerUserId);
  starter = await newEmployee("E-P1", A.siteId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("right-to-work records: who can see and record them (D1)", () => {
  it("site managers, workers and other organisations can't see or record them", async () => {
    for (const w of [siteManager, worker, otherOwner])
      expect(
        await run(w, (tx, a) => ob.getRightToWork(tx, a, starter, TODAY)),
      ).toBeNull();
    expect(
      await run(siteManager, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, listA),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    // Another organisation's owner: indistinguishable from a person who doesn't exist.
    expect(
      await run(otherOwner, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, listA),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(siteManager, (tx, a) => ob.rtwFollowUps(tx, a, TODAY)),
    ).toBeNull();
  });

  it("HR records the first check; the audit trail holds ids and the kind only", async () => {
    const { id } = ok(
      await run(hr, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, {
          ...listA,
          note: "Seen at the office",
        }),
      ),
    );
    const events = await auditRows(`target_id = $1`, [id]);
    expect(events.map((e) => e.action)).toEqual(["rtw.check_recorded"]);
    const detail = JSON.parse(events[0]!.detail) as Record<string, unknown>;
    expect(Object.keys(detail).sort()).toEqual([
      "employeeId",
      "kind",
      "supersedesId",
    ]);
    expect(detail.kind).toBe("initial");
    for (const restricted of [
      "manual_document",
      "list_a",
      "confirmed",
      "2026-10-15",
      "Seen at the office",
    ])
      expect(events[0]!.detail).not.toContain(restricted);
  });

  it("every view of the record is audited", async () => {
    const before = (
      await auditRows(`action = 'rtw.record_viewed' AND target_id = $1`, [
        starter,
      ])
    ).length;
    const r = (await run(owner, (tx, a) =>
      ob.getRightToWork(tx, a, starter, TODAY),
    ))!;
    expect(r.state).toBe("recorded");
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({
      kind: "initial",
      current: true,
      note: "Seen at the office",
    });
    const after = await auditRows(
      `action = 'rtw.record_viewed' AND target_id = $1`,
      [starter],
    );
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.target_type).toBe("employee");
  });
});

describe("right-to-work history is append-only", () => {
  it("a follow-up or correction must supersede the current check", async () => {
    const current = (await run(owner, (tx, a) =>
      ob.getRightToWork(tx, a, starter, TODAY),
    ))!.currentId!;
    // Another first check isn't possible once one exists.
    expect(
      await run(owner, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, listA),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    // The kind must be stated.
    expect(
      await run(owner, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, {
          ...listA,
          supersedesId: current,
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    // A correction needs a reason, without identifiers in it.
    for (const correctionReason of ["", "Passport 123456789"])
      expect(
        await run(owner, (tx, a) =>
          ob.recordRtwCheck(tx, a, starter, TODAY, {
            ...listA,
            supersedesId: current,
            kind: "correction",
            correctionReason,
          }),
        ),
      ).toMatchObject({
        ok: false,
        code: "invalid",
        fieldErrors: { correctionReason: expect.any(String) },
      });
    const { id: corrected } = ok(
      await run(owner, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, {
          method: "manual_document",
          listType: "list_b_group_1",
          checkedOn: "2026-10-15",
          personPresent: true,
          outcome: "time_limited",
          permissionEndsOn: "2026-12-01",
          supersedesId: current,
          kind: "correction",
          correctionReason: "Wrong list chosen",
        }),
      ),
    );
    // Someone working from the old page can't fork the history.
    expect(
      await run(hr, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, {
          ...listA,
          supersedesId: current,
          kind: "follow_up",
        }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const r = (await run(owner, (tx, a) =>
      ob.getRightToWork(tx, a, starter, TODAY),
    ))!;
    expect(r.currentId).toBe(corrected);
    expect(r.state).toBe("follow_up_due"); // permission ends within 60 days
    expect(r.history.map((h) => [h.kind, h.current, h.supersededBy])).toEqual([
      ["correction", true, null],
      ["initial", false, "correction"],
    ]);
    // A follow-up can't be dated before the check it follows.
    expect(
      await run(owner, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, {
          ...listA,
          checkedOn: "2026-10-01",
          supersedesId: corrected,
          kind: "follow_up",
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { checkedOn: expect.any(String) },
    });
  });

  it("the app can't update or delete checks, and nobody can (trigger)", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(c.query(`UPDATE rtw_check SET note = 'x'`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query(`DELETE FROM rtw_check`)).rejects.toThrow(
        /permission denied/,
      );
      // Without an organisation context, nothing is visible.
      expect((await c.query(`SELECT 1 FROM rtw_check`)).rows).toEqual([]);
    });
    await expect(
      admin((c) =>
        c.query(`UPDATE rtw_check SET note = 'x' WHERE tenant_id = $1`, [
          A.tenantId,
        ]),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin((c) =>
        c.query(`DELETE FROM rtw_check WHERE tenant_id = $1`, [A.tenantId]),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("the database keeps one linear history per person, for the same person only", async () => {
    const [first, other] = await admin(async (c) => {
      const rows = (
        await c.query<{ id: string; employee_id: string }>(
          `SELECT id, employee_id FROM rtw_check WHERE tenant_id = $1 AND supersedes_id IS NULL`,
          [A.tenantId],
        )
      ).rows;
      return [rows[0]!, await newEmployee("E-P9", A.siteId)];
    });
    const insert = (employeeId: string, supersedes: string | null) =>
      admin((c) =>
        c.query(
          `INSERT INTO rtw_check (tenant_id, employee_id, kind, supersedes_id, method, list_type, checked_on,
             checked_by_membership_id, person_present, outcome, recorded_by)
           SELECT $1, $2, $3, $4, 'manual_document', 'list_a', '2026-10-15', id, true, 'confirmed', $5
           FROM tenant_membership WHERE tenant_id = $1 LIMIT 1`,
          [
            A.tenantId,
            employeeId,
            supersedes ? "follow_up" : "initial",
            supersedes,
            A.ownerUserId,
          ],
        ),
      );
    // A second first check for the same person.
    await expect(insert(first.employee_id, null)).rejects.toThrow(
      /rtw_check_one_initial/,
    );
    // Superseding a check that's already superseded.
    await expect(insert(first.employee_id, first.id)).rejects.toThrow(
      /rtw_check_superseded_once/,
    );
    // Superseding another person's (current) check.
    const head = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM rtw_check r WHERE employee_id = $1
               AND NOT EXISTS (SELECT 1 FROM rtw_check s WHERE s.supersedes_id = r.id)`,
            [first.employee_id],
          )
        ).rows[0]!.id,
    );
    await expect(insert(other, head)).rejects.toThrow(
      /rtw_check_supersedes_fkey/,
    );
    // Time-limited records always carry their dates.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO rtw_check (tenant_id, employee_id, kind, method, list_type, checked_on,
             checked_by_membership_id, person_present, outcome, recorded_by)
           SELECT $1, $2, 'initial', 'manual_document', 'list_b_group_1', '2026-10-15', id, true, 'time_limited', $3
           FROM tenant_membership WHERE tenant_id = $1 LIMIT 1`,
          [A.tenantId, other, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/rtw_check_time_limited_dates/);
  });

  it("people who have left can only have their record corrected", async () => {
    const left = await newEmployee("E-P2", A.siteId, "left");
    expect(
      await run(owner, (tx, a) => ob.recordRtwCheck(tx, a, left, TODAY, listA)),
    ).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("follow-ups", () => {
  it("lists people needing attention or with nothing recorded, and audits the view", async () => {
    const list = (await run(hr, (tx, a) => ob.rtwFollowUps(tx, a, TODAY)))!;
    expect(list.attention.map((p) => [p.employeeId, p.state])).toContainEqual([
      starter,
      "follow_up_due",
    ]);
    expect(list.unrecorded.map((p) => p.employeeId)).toContain(A.employeeId);
    expect(await run(hr, (tx, a) => ob.rtwAttentionCount(tx, a, TODAY))).toBe(
      list.attention.length,
    );
    const events = await auditRows(
      `tenant_id = $1 AND action = 'rtw.follow_ups_viewed'`,
      [A.tenantId],
    );
    expect(events).toHaveLength(1); // the count alone isn't a view of the list
    // Other organisations' people never appear.
    const theirs = (await run(otherOwner, (tx, a) =>
      ob.rtwFollowUps(tx, a, TODAY),
    ))!;
    expect(theirs.attention).toEqual([]);
    expect(theirs.unrecorded.map((p) => p.employeeId)).toEqual([B.employeeId]);
  });

  it("other modules can ask yes/no, and nothing more", async () => {
    expect(
      await run(siteManager, (tx, a) =>
        ob.isClearedToWork(tx, a, starter, "2026-11-30"),
      ),
    ).toBe(true);
    expect(
      await run(siteManager, (tx, a) =>
        ob.isClearedToWork(tx, a, starter, "2026-12-02"),
      ),
    ).toBe(false); // permission ended 1 December
    expect(
      await run(otherOwner, (tx, a) =>
        ob.isClearedToWork(tx, a, starter, TODAY),
      ),
    ).toBeNull();
  });
});

describe("documents and cleared to start", () => {
  let caseId: string;
  let person: string;
  let taskId: string;

  beforeAll(async () => {
    person = await newEmployee("E-P3", A.siteId);
    const { id: tid } = ok(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, {
          name: "Compliance flow",
          scope: "organisation",
        }),
      ),
    );
    ok(
      await run(owner, (tx, a) =>
        ob.saveTemplateTask(tx, a, tid, null, {
          title: "Contract signed",
          category: "task",
          ownerKind: "manager",
          dueOffsetDays: 0,
          required: true,
        }),
      ),
    );
    caseId = ok(
      await run(siteManager, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: person,
          templateId: tid,
          startDate: "2026-11-02",
        }),
      ),
    ).id;
    taskId = (await run(owner, (tx, a) => ob.getCase(tx, a, caseId, TODAY)))!
      .tasks[0]!.id;
  });

  const getCase = (w: Ready) =>
    run(w, (tx, a) => ob.getCase(tx, a, caseId, TODAY)).then((c) => c!);
  const docId = async (title: string) =>
    (await getCase(owner)).documentList.find((d) => d.title === title)!.id;

  it("site managers keep the checklist; right-to-work documents and identifiers are refused", async () => {
    ok(
      await run(siteManager, (tx, a) =>
        ob.addDocument(tx, a, caseId, {
          title: "Level 2 Food Hygiene certificate",
          required: true,
        }),
      ),
    );
    ok(
      await run(siteManager, (tx, a) =>
        ob.addDocument(tx, a, caseId, { title: "First aid certificate" }),
      ),
    );
    for (const title of ["Passport", "Right to work share code", "AB1234567"])
      expect(
        await run(siteManager, (tx, a) =>
          ob.addDocument(tx, a, caseId, { title, required: true }),
        ),
        title,
      ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await run(worker, (tx, a) =>
        ob.addDocument(tx, a, caseId, { title: "X" }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(otherOwner, (tx, a) =>
        ob.addDocument(tx, a, caseId, { title: "X" }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("only owners, admins and HR waive a required document; reasons stay off the audit trail", async () => {
    const hygiene = await docId("Level 2 Food Hygiene certificate");
    const firstAid = await docId("First aid certificate");
    expect(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, {
          kind: "waive",
          reason: "Has one already",
        }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, firstAid, {
          kind: "reject",
          reason: "",
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, firstAid, {
          kind: "waive",
          reason: "Not on the first aid rota",
        }),
      ),
    );
    const events = await auditRows(`target_id = $1`, [firstAid]);
    expect(events.map((e) => e.action)).toEqual([
      "onboarding.document_added",
      "onboarding.document_waived",
    ]);
    expect(events[1]!.detail).not.toContain("first aid rota");
  });

  it("cleared to start needs required tasks, documents and a right-to-work check, and site managers see yes/no only", async () => {
    const hygiene = await docId("Level 2 Food Hygiene certificate");
    let c = await getCase(siteManager);
    expect(c.clearance).toMatchObject({
      on: "2026-11-02",
      tasksReady: false,
      documentsReady: false,
      rightToWork: false,
      cleared: false,
    });
    expect(c.can.viewRightToWork).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/list_|manual_document|time_limited/);

    ok(
      await run(siteManager, (tx, a) =>
        ob.updateTask(tx, a, caseId, taskId, { kind: "complete" }),
      ),
    );
    // A certificate expiring before the start date doesn't count.
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, {
          kind: "seen",
          expiresOn: "2026-11-01",
        }),
      ),
    );
    c = await getCase(siteManager);
    expect(c.clearance.documentsReady).toBe(false);
    expect(c.documentList.find((d) => d.id === hygiene)!.expired).toBe(true);
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, {
          kind: "verified",
          expiresOn: "2029-11-01",
        }),
      ),
    );
    c = await getCase(siteManager);
    expect(c.clearance).toMatchObject({
      documentsReady: true,
      rightToWork: false,
      cleared: false,
    });

    const viewsBefore = (
      await auditRows(`action = 'rtw.record_viewed' AND target_id = $1`, [
        person,
      ])
    ).length;
    ok(
      await run(hr, (tx, a) =>
        ob.recordRtwCheck(tx, a, person, TODAY, {
          method: "online_check",
          checkedOn: "2026-10-19",
          personPresent: true,
          outcome: "confirmed",
        }),
      ),
    );
    c = await getCase(siteManager);
    expect(c.clearance.cleared).toBe(true);
    // Showing yes/no on the onboarding page isn't a view of the record.
    expect(
      await auditRows(`action = 'rtw.record_viewed' AND target_id = $1`, [
        person,
      ]),
    ).toHaveLength(viewsBefore);
    expect((await getCase(hr)).can.viewRightToWork).toBe(true);

    const dash = (await run(siteManager, (tx, a) =>
      ob.dashboard(tx, a, TODAY),
    ))!;
    expect(dash.cases.find((x) => x.id === caseId)!.clearance.cleared).toBe(
      true,
    );
  });

  it("reopening a waived required document needs sign-off rights; closed onboarding can't change", async () => {
    const hygiene = await docId("Level 2 Food Hygiene certificate");
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, { kind: "reopen" }),
      ),
    );
    ok(
      await run(hr, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, {
          kind: "waive",
          reason: "Certificate seen at previous employer",
        }),
      ),
    );
    expect(
      await run(siteManager, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, { kind: "reopen" }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    ok(await run(owner, (tx, a) => ob.cancelCase(tx, a, caseId, "Test only")));
    expect(
      await run(owner, (tx, a) =>
        ob.updateDocument(tx, a, caseId, hygiene, { kind: "reopen" }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("the app can't delete documents or change what they are; status rules hold for the database owner", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(c.query(`DELETE FROM onboarding_document`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        c.query(`UPDATE onboarding_document SET title = 'x'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE onboarding_document SET required = false`),
      ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) =>
        c.query(
          `UPDATE onboarding_document SET status = 'waived', reason = NULL WHERE tenant_id = $1`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/onboarding_document_status_consistent/);
  });
});

describe("permissions in the database", () => {
  it("built-in owner, admin and HR roles have the right-to-work permissions; nobody else", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ key: string; perms: string }>(
            `SELECT r.key, string_agg(rp.permission_code, ',' ORDER BY rp.permission_code) AS perms
             FROM role r JOIN role_permission rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
             WHERE r.tenant_id = $1 AND rp.permission_code LIKE 'rtw.%' GROUP BY r.key ORDER BY r.key`,
            [A.tenantId],
          )
        ).rows,
    );
    expect(rows).toEqual([
      { key: "admin", perms: "rtw.record,rtw.view" },
      { key: "hr_manager", perms: "rtw.record,rtw.view" },
      { key: "owner", perms: "rtw.record,rtw.view" },
    ]);
  });
});
