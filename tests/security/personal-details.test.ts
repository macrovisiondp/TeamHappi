// M14.2 personal and bank details, run as the real application role
// (DPIA docs/security/dpia-personal-and-bank-details.md): the person sees and
// edits their own; employee.personal (owner, admin, HR) sees and corrects
// anyone's; site managers see only the emergency contact; NI and bank numbers
// are encrypted at rest, bound to their record, masked until revealed, and
// every reveal is audited without values; isolation and posture.

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as personal from "@/modules/personal";

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
let farManager: Ready;
let anaW: Ready;
let benW: Ready;
let otherOwner: Ready;
let ana: string;
let ben: string;
const cipher = personal.fieldCipher({ 1: randomBytes(32) }, 1);
const otherKey = personal.fieldCipher({ 1: randomBytes(32) }, 1);
const TODAY = "2026-11-19";

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
const run = <T>(
  w: Ready,
  fn: (tx: TenantTx, a: personal.Actor) => Promise<T>,
) => withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
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
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status, membership_id)
         VALUES ($1, $2, $3, 'Personal', $4, 'active', $5) RETURNING id`,
        [A.tenantId, `PD-${link}`, link, siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}

const about = {
  addressLine1: "141 Church Road",
  town: "Hove",
  postcode: "bn3 2ae",
  dateOfBirth: "2001-05-04",
  emergencyName: "Maya Personal",
  emergencyRelationship: "Sister",
  emergencyPhone: "07700 900123",
  niNumber: "ab 12 34 56 c",
};
const bank = {
  accountName: "Ana Personal",
  sortCode: "12-34-56",
  accountNumber: "12345678",
};

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "hotel");
  B = await createTenantFixture(db, "india");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  const site2 = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'H2', 'hotel North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  manager = (await member("site_manager", A.siteId)).w;
  farManager = (await member("site_manager", site2)).w;
  const a = await member("worker", A.siteId, "Ana");
  const b = await member("worker", A.siteId, "Ben");
  [anaW, ana, benW, ben] = [a.w, a.employeeId!, b.w, b.employeeId!];
});

afterAll(async () => {
  await db.$disconnect();
});

describe("formats", () => {
  it("check UK NI numbers, sort codes and account numbers", () => {
    expect(personal.normaliseNi("ab 12 34 56 c")).toBe("AB123456C");
    for (const bad of ["AB123456E", "BG123456A", "DQ123456A", "Q1234567A", ""])
      expect(personal.normaliseNi(bad), bad).toBeNull();
    expect(personal.normaliseSortCode("12-34-56")).toBe("123456");
    expect(personal.normaliseSortCode("12345")).toBeNull();
    expect(personal.normaliseAccountNumber("1234 5678")).toBe("12345678");
    expect(personal.normaliseAccountNumber("1234567")).toBeNull();
  });

  it("encrypt with a key and a record binding (no copying between records)", () => {
    const sealed = cipher.encrypt("AB123456C", "t:e:ni");
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("AB123456C");
    expect(cipher.decrypt(sealed, "t:e:ni")).toBe("AB123456C");
    expect(cipher.decrypt(sealed, "t:other:ni")).toBeNull();
    expect(cipher.decrypt(sealed, "t:e:bank")).toBeNull();
    expect(otherKey.decrypt(sealed, "t:e:ni")).toBeNull();
    expect(cipher.decrypt("v1:not-base64!", "t:e:ni")).toBeNull();
  });
});

describe("the person themselves", () => {
  it("fills in About you and bank details; sensitive numbers are encrypted at rest", async () => {
    expect(
      await run(anaW, (tx, a) =>
        personal.saveAbout(
          tx,
          a,
          ana,
          { ...about, postcode: "nope", dateOfBirth: "2030-01-01" },
          cipher,
          TODAY,
        ),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        postcode: expect.any(String),
        dateOfBirth: expect.any(String),
      },
    });
    ok(
      await run(anaW, (tx, a) =>
        personal.saveAbout(tx, a, ana, about, cipher, TODAY),
      ),
    );
    ok(await run(anaW, (tx, a) => personal.saveBank(tx, a, ana, bank, cipher)));
    const raw = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT postcode, ni_ciphertext, ni_last4, bank_ciphertext, bank_last4 FROM employee_personal WHERE employee_id = $1`,
            [ana],
          )
        ).rows[0],
    );
    expect(raw).toMatchObject({
      postcode: "BN3 2AE",
      ni_last4: "456C",
      bank_last4: "5678",
    });
    expect(JSON.stringify(raw)).not.toMatch(/AB123456C|12345678"|123456"/);
    const v = (await run(anaW, (tx, a) => personal.viewDetails(tx, a, ana)))!;
    expect(v).toMatchObject({
      level: "self",
      niLast4: "456C",
      bankLast4: "5678",
      dateOfBirth: "2001-05-04",
      emergency: { name: "Maya Personal" },
    });
    expect(JSON.stringify(v)).not.toMatch(/AB123456C|12345678/);
  });

  it("keeps the stored NI number when the box is left blank", async () => {
    ok(
      await run(anaW, (tx, a) =>
        personal.saveAbout(
          tx,
          a,
          ana,
          { ...about, niNumber: "", town: "Brighton" },
          cipher,
          TODAY,
        ),
      ),
    );
    expect(
      await run(anaW, (tx, a) => personal.viewDetails(tx, a, ana)),
    ).toMatchObject({
      niLast4: "456C",
      address: { town: "Brighton" },
    });
  });

  it("can reveal their own numbers (audited)", async () => {
    expect(
      ok(
        await run(anaW, (tx, a) => personal.reveal(tx, a, ana, "bank", cipher)),
      ),
    ).toEqual({
      field: "bank",
      accountName: "Ana Personal",
      sortCode: "123456",
      accountNumber: "12345678",
    });
  });
});

describe("other people", () => {
  it("HR-level roles see and reveal anyone's, with every reveal audited", async () => {
    expect(
      (await run(owner, (tx, a) => personal.viewDetails(tx, a, ana)))?.level,
    ).toBe("full");
    expect(
      ok(
        await run(owner, (tx, a) => personal.reveal(tx, a, ana, "ni", cipher)),
      ),
    ).toEqual({
      field: "ni",
      niNumber: "AB123456C",
    });
    const audits = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS detail FROM audit_event WHERE tenant_id = $1 AND action LIKE 'personal.%' ORDER BY occurred_at`,
            [A.tenantId],
          )
        ).rows as { action: string; detail: string }[],
    );
    expect(audits.map((x) => x.action)).toEqual([
      "personal.updated",
      "personal.bank_updated",
      "personal.updated",
      "personal.revealed",
      "personal.revealed",
    ]);
    for (const x of audits)
      expect(x.detail).not.toMatch(/AB123456C|12345678|Church|Maya|07700|2001/);
  });

  it("site managers see the emergency contact only, at their own sites", async () => {
    const v = await run(manager, (tx, a) => personal.viewDetails(tx, a, ana));
    expect(v).toEqual({
      level: "emergency",
      emergency: {
        name: "Maya Personal",
        relationship: "Sister",
        phone: "07700 900123",
      },
    });
    expect(
      await run(manager, (tx, a) =>
        personal.reveal(tx, a, ana, "bank", cipher),
      ),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await run(manager, (tx, a) =>
        personal.saveBank(tx, a, ana, bank, cipher),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(farManager, (tx, a) => personal.viewDetails(tx, a, ana)),
    ).toBeNull();
  });

  it("colleagues and other organisations see nothing", async () => {
    expect(
      await run(benW, (tx, a) => personal.viewDetails(tx, a, ana)),
    ).toBeNull();
    expect(
      await run(benW, (tx, a) =>
        personal.saveAbout(tx, a, ana, about, cipher, TODAY),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(otherOwner, (tx, a) => personal.viewDetails(tx, a, ana)),
    ).toBeNull();
    expect(
      await run(otherOwner, (tx, a) =>
        personal.reveal(tx, a, ana, "ni", cipher),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("without the key, and in the database", () => {
  it("switches NI and bank fields off, and old values need the right key", async () => {
    expect(
      await run(benW, (tx, a) => personal.saveBank(tx, a, ben, bank, null)),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await run(owner, (tx, a) => personal.reveal(tx, a, ana, "ni", otherKey)),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("has no DELETE, fixes whose details they are, and refuses plain numbers", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(c.query(`DELETE FROM employee_personal`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        c.query(`UPDATE employee_personal SET employee_id = employee_id`),
      ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) =>
        c.query(
          `UPDATE employee_personal SET bank_ciphertext = '12345678', bank_last4 = '5678' WHERE employee_id = $1`,
          [ana],
        ),
      ),
    ).rejects.toThrow(/employee_personal_bank/);
  });
});
