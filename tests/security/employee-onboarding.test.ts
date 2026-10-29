// M7.3 employee onboarding, run as the real application role: inviting a
// person's record, linking it on acceptance (only through the database
// function), and "My onboarding" by ownership: own tasks only, policy
// acknowledgements, nothing restricted, nothing from other people or
// organisations.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { acceptInvitation } from "@/lib/workspace/invitations";
import * as mm from "@/lib/workspace/members";
import type { MutationResult } from "@/lib/workspace/mutations";
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
let workerRole: string;
let starter: string; // a new starter at A's site, no login yet
let starterEmail: string;
let starterWs: Ready; // after accepting the invitation
let colleague: string; // another new starter
let caseId: string;
const TODAY = "2026-10-20";

const uniq = () => Math.random().toString(36).slice(2, 8);
const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready): ob.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: ob.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: MutationResult<T> | ob.Result<T>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};

async function verifiedUser(email: string) {
  return admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO "user" (name, email, email_verified) VALUES ('Starter', $1, true) RETURNING id`,
          [email],
        )
      ).rows[0]!.id,
  );
}
async function newEmployee(status = "pending") {
  return admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
           VALUES ($1, $2, 'Kit', 'Starter', $3, $4) RETURNING id`,
          [A.tenantId, `E-${uniq()}`, A.siteId, status],
        )
      ).rows[0]!.id,
  );
}
const linkedMembership = (employeeId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ membership_id: string | null }>(
          `SELECT membership_id FROM employee WHERE id = $1`,
          [employeeId],
        )
      ).rows[0]!.membership_id,
  );
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

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "romeo");
  B = await createTenantFixture(db, "sierra");
  owner = await ws(A.ownerUserId);
  workerRole = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `SELECT id FROM role WHERE tenant_id = $1 AND key = 'worker'`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  starter = await newEmployee();
  colleague = await newEmployee();
  starterEmail = `kit-${uniq()}@example.test`;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("inviting a person's record", () => {
  it("only for this organisation's people who are still employed and not linked", async () => {
    const invite = (employeeId: string, email = `x-${uniq()}@example.test`) =>
      mm.createInvitation(db, owner, {
        email,
        roleId: workerRole,
        siteId: A.siteId,
        employeeId,
      });
    expect(await invite(B.employeeId)).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await invite("not-a-uuid")).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await invite(await newEmployee("left"))).toMatchObject({
      ok: false,
    });
    const { id } = ok(await invite(starter, starterEmail));
    // One open invitation per person, even to a different address.
    expect(await invite(starter)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    const events = await auditFor(id);
    expect(events.map((e) => e.action)).toEqual(["invitation.created"]);
    expect(events[0]!.detail).toContain(starter);
  });

  it("accepting links the record to the new login, and audits it", async () => {
    const token = await admin(async (c) => {
      // Renew to learn a token (only its hash is stored).
      const inv = await c.query<{ id: string }>(
        `SELECT id FROM invitation WHERE employee_id = $1 AND status = 'pending'`,
        [starter],
      );
      return inv.rows[0]!.id;
    }).then(async (invId) => ok(await mm.renewInvitation(db, owner, invId)));
    const userId = await verifiedUser(starterEmail);
    expect((await acceptInvitation(db, userId, token.token)).outcome).toBe(
      "joined",
    );
    starterWs = await ws(userId);
    expect(await linkedMembership(starter)).toBe(starterWs.membershipId);
    const events = await auditFor(starter);
    expect(events.map((e) => e.action)).toEqual(["employee.login_linked"]);
  });

  it("never re-links a record or links one login to two records", async () => {
    // The colleague's invitation is accepted by someone already linked elsewhere.
    const email = `kit2-${uniq()}@example.test`;
    const { token } = ok(
      await mm.createInvitation(db, owner, {
        email,
        roleId: workerRole,
        employeeId: colleague,
      }),
    );
    const userId = await verifiedUser(email);
    // Meanwhile that login gets linked to another record by other means.
    const other = await newEmployee();
    await admin(async (c) => {
      const m = await c.query<{ id: string }>(
        `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'left') RETURNING id`,
        [A.tenantId, userId],
      );
      await c.query(`UPDATE employee SET membership_id = $1 WHERE id = $2`, [
        m.rows[0]!.id,
        other,
      ]);
    });
    expect((await acceptInvitation(db, userId, token)).outcome).toBe("joined");
    expect(await linkedMembership(colleague)).toBeNull(); // joined, but not linked
    expect(await auditFor(colleague)).toEqual([]);
  });

  it("the app can't link records itself or call the link function", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(
        c.query(`UPDATE employee SET membership_id = NULL`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(
          `SELECT app.link_invited_employee(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("my onboarding", () => {
  beforeAll(async () => {
    const { id: tid } = ok(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, { name: "Self", scope: "organisation" }),
      ),
    );
    for (const t of [
      { title: "Read the handbook", ownerKind: "employee", category: "task" },
      {
        title: "Allergen policy",
        ownerKind: "employee",
        category: "policy",
        guidance: "Always check the allergen matrix before serving.",
      },
      {
        title: "Bring bank details form",
        ownerKind: "employee",
        category: "task",
      },
      { title: "Set up till login", ownerKind: "manager", category: "task" },
    ])
      ok(
        await run(owner, (tx, a) =>
          ob.saveTemplateTask(tx, a, tid, null, {
            ...t,
            dueOffsetDays: 0,
            required: true,
          }),
        ),
      );
    caseId = ok(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: starter,
          templateId: tid,
          startDate: "2026-11-02",
        }),
      ),
    ).id;
    // The colleague's onboarding uses the same template.
    ok(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: colleague,
          templateId: tid,
          startDate: "2026-11-02",
        }),
      ),
    );
    ok(
      await run(owner, (tx, a) =>
        ob.addDocument(tx, a, caseId, {
          title: "Level 2 Food Hygiene certificate",
          required: true,
        }),
      ),
    );
    ok(
      await run(owner, (tx, a) =>
        ob.recordRtwCheck(tx, a, starter, TODAY, {
          method: "online_check",
          checkedOn: "2026-10-19",
          personPresent: true,
          outcome: "time_limited",
          permissionEndsOn: "2027-03-01",
          note: "Video call",
        }),
      ),
    );
  });

  const task = async (title: string) =>
    (await run(owner, (tx, a) => ob.getCase(tx, a, caseId, TODAY)))!.tasks.find(
      (t) => t.title === title,
    )!.id;

  it("shows their own tasks and documents to bring, and nothing restricted", async () => {
    const me = (await run(starterWs, (tx, a) =>
      ob.myOnboarding(tx, a, TODAY),
    ))!;
    expect(me.onboarding!.id).toBe(caseId);
    expect(me.onboarding!.myTasks.map((t) => t.title)).toEqual([
      "Read the handbook",
      "Allergen policy",
      "Bring bank details form",
    ]);
    expect(me.onboarding!.overall.total).toBe(4);
    expect(me.onboarding!.documents).toEqual([
      expect.objectContaining({
        title: "Level 2 Food Hygiene certificate",
        needed: true,
      }),
    ]);
    const json = JSON.stringify(me);
    for (const restricted of [
      "online_check",
      "time_limited",
      "2027-03-01",
      "Video call",
      "clearance",
      "rightToWork",
    ])
      expect(json).not.toContain(restricted);
    // The worker role still has no onboarding access by role.
    expect(
      await run(starterWs, (tx, a) => ob.dashboard(tx, a, TODAY)),
    ).toBeNull();
    expect(
      await run(starterWs, (tx, a) => ob.getCase(tx, a, caseId, TODAY)),
    ).toBeNull();
  });

  it("they complete their own tasks, not on anyone's behalf; policies need an acknowledgement", async () => {
    const handbook = await task("Read the handbook");
    ok(await run(starterWs, (tx, a) => ob.completeMyTask(tx, a, handbook, {})));
    const policy = await task("Allergen policy");
    expect(
      await run(starterWs, (tx, a) => ob.completeMyTask(tx, a, policy, {})),
    ).toMatchObject({ ok: false, code: "invalid" });
    ok(
      await run(starterWs, (tx, a) =>
        ob.completeMyTask(tx, a, policy, { acknowledge: true }),
      ),
    );
    const c = (await run(owner, (tx, a) => ob.getCase(tx, a, caseId, TODAY)))!;
    for (const id of [handbook, policy]) {
      const t = c.tasks.find((x) => x.id === id)!;
      expect(t).toMatchObject({ status: "done", onBehalf: false });
    }
    expect((await auditFor(policy)).map((e) => e.action)).toEqual([
      "onboarding.policy_acknowledged",
    ]);
    expect((await auditFor(handbook))[0]!.detail).toContain(
      '"byEmployee": true',
    );
    expect(
      await run(starterWs, (tx, a) => ob.completeMyTask(tx, a, handbook, {})),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("a manager completing their task still records it on their behalf", async () => {
    const bank = await task("Bring bank details form");
    ok(
      await run(owner, (tx, a) =>
        ob.updateTask(tx, a, caseId, bank, {
          kind: "complete",
        }),
      ),
    );
    const t = (await run(owner, (tx, a) =>
      ob.getCase(tx, a, caseId, TODAY),
    ))!.tasks.find((x) => x.title === "Bring bank details form")!;
    expect(t.onBehalf).toBe(true);
    const me = (await run(starterWs, (tx, a) =>
      ob.myOnboarding(tx, a, TODAY),
    ))!;
    expect(
      me.onboarding!.myTasks.find((x) => x.title === "Bring bank details form"),
    ).toMatchObject({ done: true, byManager: true });
  });

  it("can't touch manager tasks, other people's tasks or other organisations'", async () => {
    const till = await task("Set up till login");
    expect(
      await run(starterWs, (tx, a) => ob.completeMyTask(tx, a, till, {})),
    ).toMatchObject({ ok: false, code: "not_found" });
    const colleagueCase = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT t.id FROM onboarding_task t JOIN onboarding_case k ON k.id = t.case_id
             WHERE k.employee_id = $1 AND t.owner_kind = 'employee' LIMIT 1`,
            [colleague],
          )
        ).rows[0]!.id,
    );
    expect(
      await run(starterWs, (tx, a) =>
        ob.completeMyTask(tx, a, colleagueCase, {}),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    // Another organisation's owner has no record linked here: nothing.
    const other = await ws(B.ownerUserId);
    expect(
      await run(other, (tx, a) => ob.myOnboarding(tx, a, TODAY)),
    ).toBeNull();
    expect(
      await run(other, (tx, a) => ob.completeMyTask(tx, a, till, {})),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("people without a linked record see nothing, and closed onboarding can't change", async () => {
    const stranger = await ws(
      await createUser("noone").then(async (u) => {
        await admin(async (c) => {
          const m = await c.query<{ id: string }>(
            `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
            [A.tenantId, u],
          );
          await c.query(
            `INSERT INTO role_assignment (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)`,
            [A.tenantId, m.rows[0]!.id, workerRole],
          );
        });
        return u;
      }),
    );
    expect(
      await run(stranger, (tx, a) => ob.myOnboarding(tx, a, TODAY)),
    ).toBeNull();
    ok(await run(owner, (tx, a) => ob.cancelCase(tx, a, caseId, "Test only")));
    // Cancelled onboarding isn't shown.
    expect(
      (await run(starterWs, (tx, a) => ob.myOnboarding(tx, a, TODAY)))!
        .onboarding,
    ).toBeNull();
  });
});
