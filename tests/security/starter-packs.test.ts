// M14.1 starter packs, run as the real application role: documents.manage
// makes packs of library policies for a job title (or everyone); sending a
// person their pack sends only the matching policies, never twice; archived
// packs and policies drop out; isolation and posture.

import { mkdtempSync, rmSync } from "node:fs";
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
let otherOwner: Ready;
let chef: string;
let server: string;
let social: string;
let flexible: string;
let allergens: string;

async function pdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(text, { x: 50, y: 780, size: 14, font });
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
const person = (jobTitle: string, n: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, status)
           VALUES ($1, $2, $3, 'Pack', $4, $5, 'pending') RETURNING id`,
          [A.tenantId, `SP-${n}`, n, A.siteId, jobTitle],
        )
      ).rows[0]!.id,
  );
const sentTitles = async (employeeId: string) =>
  (await run(owner, (tx, a) => signing.personRequests(tx, a, employeeId)))!
    .map((r) => r.title)
    .sort();

beforeAll(async () => {
  db = appDb();
  dir = mkdtempSync(join(tmpdir(), "th-pack-"));
  const store = localDiskStore(dir);
  deps = { client: db, store, storeFor: async () => store };
  A = await createTenantFixture(db, "foxtrot");
  B = await createTenantFixture(db, "golf");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  const userId = await createUser("sitemgr");
  await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $3 FROM role WHERE tenant_id = $1 AND key = 'site_manager'`,
      [A.tenantId, m.rows[0]!.id, A.siteId],
    );
  });
  manager = await ws(userId);
  const up = async (title: string) =>
    ok(
      await files.uploadPolicy(deps, owner, title, {
        name: `${title}.pdf`,
        bytes: await pdf(title),
      }),
    ).id;
  social = await up("Social Media Policy");
  flexible = await up("Flexible Working Policy");
  allergens = await up("Allergen Policy");
  chef = await person("Chef", "Cara");
  server = await person("  server ", "Sam");
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("starter packs", () => {
  it("are made by documents.manage only, from live library policies", async () => {
    const raw = { name: "Everyone", documentIds: [social, flexible] };
    expect(
      await run(manager, (tx, a) => signing.createStarterPack(tx, a, raw)),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(owner, (tx, a) =>
        signing.createStarterPack(tx, a, { name: "", documentIds: [] }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    ok(await run(owner, (tx, a) => signing.createStarterPack(tx, a, raw)));
    ok(
      await run(owner, (tx, a) =>
        signing.createStarterPack(tx, a, {
          name: "Kitchen starter",
          jobTitle: "chef",
          documentIds: [allergens],
        }),
      ),
    );
    const packs = (await run(owner, signing.starterPacks))!;
    expect(packs.map((p) => [p.name, p.jobTitle, p.documents.length])).toEqual([
      ["Kitchen starter", "chef", 1],
      ["Everyone", null, 2],
    ]);
    expect(await run(otherOwner, signing.starterPacks)).toEqual([]);
  });

  it("send the packs for a person's job title (case and spaces don't matter), never twice", async () => {
    expect(
      ok(await run(owner, (tx, a) => signing.sendStarterPack(tx, a, chef))),
    ).toEqual({ sent: 3, packs: 2 });
    expect(await sentTitles(chef)).toEqual([
      "Allergen Policy",
      "Flexible Working Policy",
      "Social Media Policy",
    ]);
    expect(
      ok(await run(owner, (tx, a) => signing.sendStarterPack(tx, a, chef))),
    ).toEqual({ sent: 0, packs: 2 });
    // A server gets only the everyone pack.
    expect(
      ok(await run(owner, (tx, a) => signing.sendStarterPack(tx, a, server))),
    ).toEqual({ sent: 2, packs: 1 });
    // Site managers and other organisations can't send.
    expect(
      await run(manager, (tx, a) => signing.sendStarterPack(tx, a, server)),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(otherOwner, (tx, a) => signing.sendStarterPack(tx, a, chef)),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("drop archived packs and archived policies", async () => {
    const kitchen = (await run(owner, signing.starterPacks))!.find(
      (p) => p.jobTitle === "chef",
    )!;
    ok(await run(owner, (tx, a) => signing.archivePolicy(tx, a, flexible)));
    ok(
      await run(owner, (tx, a) =>
        signing.archiveStarterPack(tx, a, kitchen.id),
      ),
    );
    const packs = (await run(owner, signing.starterPacks))!;
    expect(packs.map((p) => [p.name, p.documents.map((d) => d.title)])).toEqual(
      [["Everyone", ["Social Media Policy"]]],
    );
    expect(
      await run(owner, (tx, a) =>
        signing.archiveStarterPack(tx, a, kitchen.id),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("can't be deleted or have their contents changed by the app", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of ["starter_pack", "starter_pack_document"])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      for (const col of ["name", "job_title"])
        await expect(
          c.query(`UPDATE starter_pack SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(
          `UPDATE starter_pack_document SET sign_document_id = sign_document_id`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
