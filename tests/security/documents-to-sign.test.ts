// M13 documents to sign, run as the real application role with real PDFs and
// a temporary local file store: documents.manage uploads policies and a
// person's contract and sends them; only that person can open and sign (typed
// name and agreement) the exact file, fixed by its SHA-256; contracts are
// countersigned; the signed copy is the original plus a signature page;
// tampered files are refused; isolation, audit (ids only) and posture.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { localDiskStore } from "@/integrations/storage/blob";
import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as files from "@/lib/workspace/signing-files";
import * as signing from "@/modules/signing";

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
let dir: string;
let deps: files.SigningDeps;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let manager: Ready;
let anaW: Ready;
let benW: Ready;
let otherOwner: Ready;
let ana: string;
let ben: string;

async function pdf(text: string, pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    doc
      .addPage([595, 842])
      .drawText(`${text} page ${i + 1}`, { x: 50, y: 780, size: 14, font });
  return doc.save();
}

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
const run = <T>(w: Ready, fn: (tx: TenantTx, a: signing.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(
  r: { ok: true; data: T } | { ok: false; message: string; code: string },
) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
async function member(roleKey: string, link?: string) {
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
        roleKey === "worker" ? null : A.siteId,
      ],
    );
    if (!link) return null;
    return (
      await c.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status, membership_id)
         VALUES ($1, $2, $3, 'Signer', $4, 'active', $5) RETURNING id`,
        [A.tenantId, `DS-${link}`, link, A.siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}
const request = (id: string) =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT status, signed_name, signed_sha256, countersigned_name, final_storage_key, final_sha256
           FROM sign_request WHERE id = $1`,
          [id],
        )
      ).rows[0],
  );

beforeAll(async () => {
  db = appDb();
  dir = mkdtempSync(join(tmpdir(), "th-sign-"));
  const store = localDiskStore(dir);
  deps = { client: db, store, storeFor: async () => store };
  A = await createTenantFixture(db, "bravo");
  B = await createTenantFixture(db, "charlie");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  manager = (await member("site_manager")).w;
  const a = await member("worker", "Ana");
  const b = await member("worker", "Ben");
  [anaW, ana, benW, ben] = [a.w, a.employeeId!, b.w, b.employeeId!];
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("uploading", () => {
  it("needs documents.manage and a plain PDF", async () => {
    const file = {
      name: "Social Media Policy.pdf",
      bytes: await pdf("Social media"),
    };
    for (const w of [manager, anaW])
      expect(
        await files.uploadPolicy(deps, w, "Social Media Policy", file),
      ).toMatchObject({
        ok: false,
        code: "forbidden",
      });
    expect(
      await files.uploadPolicy(deps, owner, "Policy", {
        name: "x.docx",
        bytes: new TextEncoder().encode("PK\x03\x04 word"),
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await files.uploadPolicy(deps, owner, "Policy", {
        name: "x.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7 /JavaScript (app.alert(1))"),
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await files.uploadPolicy(deps, owner, "Broken", {
        name: "x.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7 not really"),
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/locked or damaged/),
    });
  });
});

describe("a policy", () => {
  let policyId: string;
  let reqId: string;

  it("is uploaded once and sent", async () => {
    policyId = ok(
      await files.uploadPolicy(deps, owner, "Social Media Policy", {
        name: "HR16c Social Media Policy.pdf",
        bytes: await pdf("Social media", 2),
      }),
    ).id;
    expect((await run(owner, signing.library))!.map((d) => d.id)).toEqual([
      policyId,
    ]);
    ok(
      await run(owner, (tx, a) => signing.sendPolicies(tx, a, ana, [policyId])),
    );
    expect(
      await run(owner, (tx, a) => signing.sendPolicies(tx, a, ana, [policyId])),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    const mine = (await run(anaW, signing.myRequests))!;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      title: "Social Media Policy",
      status: "awaiting_employee",
      kind: "policy",
    });
    reqId = mine[0]!.id;
    // Someone else sees nothing, and can't open or sign it.
    expect(await run(benW, signing.myRequests)).toEqual([]);
    expect(await files.openFile(deps, benW, reqId, "original")).toEqual({
      ok: false,
    });
    expect(
      await files.sign(deps, benW, reqId, "Ben Signer", true),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("is opened (audited) and signed by its person, with a signed copy", async () => {
    const opened = await files.openFile(deps, anaW, reqId, "original");
    expect(opened.ok).toBe(true);
    expect(await files.sign(deps, anaW, reqId, "A", false)).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), agree: expect.any(String) },
    });
    ok(await files.sign(deps, anaW, reqId, "  Ana   Signer ", true));
    const row = await request(reqId);
    expect(row).toMatchObject({
      status: "completed",
      signed_name: "Ana Signer",
      countersigned_name: null,
    });
    expect(
      await files.sign(deps, anaW, reqId, "Ana Signer", true),
    ).toMatchObject({ ok: false, code: "conflict" });
    const signed = await files.openFile(deps, anaW, reqId, "signed");
    if (!signed.ok) throw new Error("no signed copy");
    const doc = await PDFDocument.load(signed.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(signing.sha256Of(signed.bytes)).toBe(row.final_sha256);
    // Managers can open it too; another organisation can't.
    expect((await files.openFile(deps, owner, reqId, "signed")).ok).toBe(true);
    expect(await files.openFile(deps, otherOwner, reqId, "signed")).toEqual({
      ok: false,
    });
  });

  it("archived policies can't be sent", async () => {
    ok(await run(owner, (tx, a) => signing.archivePolicy(tx, a, policyId)));
    expect(
      await run(owner, (tx, a) => signing.sendPolicies(tx, a, ben, [policyId])),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("a contract", () => {
  let reqId: string;

  it("is uploaded for one person, signed, then countersigned", async () => {
    expect(
      await files.uploadContract(deps, manager, ben, "Contract", {
        name: "c.pdf",
        bytes: await pdf("Contract"),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    reqId = ok(
      await files.uploadContract(
        deps,
        owner,
        ben,
        "Zero hours contract (Kitchen)",
        {
          name: "HotRock contract Ben.pdf",
          bytes: await pdf("Contract for Ben", 4),
        },
      ),
    ).id;
    ok(await files.sign(deps, benW, reqId, "Ben Signer", true));
    expect(await request(reqId)).toMatchObject({
      status: "awaiting_countersign",
      final_storage_key: null,
    });
    expect(await files.openFile(deps, benW, reqId, "signed")).toEqual({
      ok: false,
    });
    // Only documents.manage countersigns.
    expect(
      await files.countersign(deps, manager, reqId, "Mo Manager"),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await files.countersign(deps, benW, reqId, "Ben Signer"),
    ).toMatchObject({ ok: false, code: "forbidden" });
    ok(await files.countersign(deps, owner, reqId, "Presley Owner"));
    expect(await request(reqId)).toMatchObject({
      status: "completed",
      signed_name: "Ben Signer",
      countersigned_name: "Presley Owner",
    });
    const signed = await files.openFile(deps, benW, reqId, "signed");
    if (!signed.ok) throw new Error("no signed copy");
    expect((await PDFDocument.load(signed.bytes)).getPageCount()).toBe(5);
  });

  it("can be withdrawn while waiting, and a tampered file is never signed", async () => {
    const id = ok(
      await files.uploadContract(deps, owner, ana, "Contract (FOH)", {
        name: "a.pdf",
        bytes: await pdf("Contract for Ana"),
      }),
    ).id;
    // Someone changes the stored file behind TeamHappi's back.
    const key = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT d.storage_key FROM sign_request r JOIN sign_document d ON d.id = r.sign_document_id WHERE r.id = $1`,
            [id],
          )
        ).rows[0].storage_key as string,
    );
    writeFileSync(join(dir, ...key.split("/")), await pdf("Altered"));
    expect(await files.sign(deps, anaW, id, "Ana Signer", true)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(await files.openFile(deps, anaW, id, "original")).toEqual({
      ok: false,
    });
    ok(await run(owner, (tx, a) => signing.withdrawRequest(tx, a, id)));
    expect(
      (await run(anaW, signing.myRequests))!.some((r) => r.id === id),
    ).toBe(false);
    expect(await files.sign(deps, anaW, id, "Ana Signer", true)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("is invisible to another organisation", async () => {
    expect(
      await run(otherOwner, (tx, a) => signing.personRequests(tx, a, ben)),
    ).toEqual([]);
    expect(
      await files.countersign(deps, otherOwner, reqId, "X Y"),
    ).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("audit and the database itself", () => {
  it("audits with ids only: never typed names, titles or file names", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS detail FROM audit_event WHERE tenant_id = $1 AND action LIKE 'documents.%'`,
            [A.tenantId],
          )
        ).rows as { action: string; detail: string }[],
    );
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set([
        "documents.uploaded",
        "documents.sent",
        "documents.viewed",
        "documents.signed",
        "documents.countersigned",
        "documents.archived",
        "documents.withdrawn",
      ]),
    );
    for (const r of rows)
      expect(r.detail).not.toMatch(
        /Signer|Presley|Policy|Contract|HotRock|\.pdf/,
      );
  });

  it("has no DELETE and fixes files, owners and fingerprints", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of ["sign_document", "sign_request"])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      for (const col of ["storage_key", "sha256", "employee_id", "title"])
        await expect(
          c.query(`UPDATE sign_document SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
      for (const col of [
        "employee_id",
        "sign_document_id",
        "needs_countersign",
      ])
        await expect(
          c.query(`UPDATE sign_request SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
    });
    // A request can't be marked complete without a signed copy.
    await expect(
      admin((c) =>
        c.query(
          `UPDATE sign_request SET status = 'completed' WHERE tenant_id = $1 AND status = 'withdrawn'`,
          [A.tenantId],
        ),
      ),
    ).rejects.toThrow(/sign_request_flow/);
  });
});
