// M14.3 offer letters, run as the real application role with real PDFs, a
// temporary file store and a FAKE email sender: only recruitment.hire at the
// vacancy's site sends offers (at the Offer stage, to the candidate's email);
// only the token's hash is stored; the applicant reads, accepts (typed name)
// or declines through the link alone; nothing but the link can record an
// answer; withdrawn and expired links stop working; audit with ids only.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailMessage, EmailProvider } from "@/integrations/email";
import { localDiskStore } from "@/integrations/storage/blob";
import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as offers from "@/lib/workspace/offer-files";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
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
let dir: string;
let deps: offers.OfferDeps;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let manager: Ready;
let otherOwner: Ready;
let vacancy: string;
const sent: EmailMessage[] = [];
const fakeEmail: EmailProvider = {
  id: "fake",
  async send(m) {
    sent.push(m);
    return { providerId: "fake", providerMessageId: String(sent.length) };
  },
};

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
const run = <T>(w: Ready, fn: (tx: TenantTx, a: rc.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(
  r: { ok: true; data: T } | { ok: false; message: string; code: string },
) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
const tokenFrom = (m: EmailMessage) =>
  /\/offer#([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
async function applicant(name: string, email: string | null, stage = "offer") {
  const id = ok(
    await run(owner, (tx, a) =>
      rc.addApplication(tx, a, vacancy, {
        givenName: name,
        familyName: "Offer",
        email: email ?? undefined,
        confirmNew: true,
      }),
    ),
  ).id;
  if (stage !== "applied")
    ok(await run(owner, (tx, a) => rc.moveStage(tx, a, id, stage)));
  return id;
}
const letter = async (title = "Offer letter") => ({
  name: `${title}.pdf`,
  bytes: await pdf(title),
});

beforeAll(async () => {
  db = appDb();
  dir = mkdtempSync(join(tmpdir(), "th-offer-"));
  const store = localDiskStore(dir);
  deps = {
    client: db,
    store,
    storeFor: async () => store,
    email: fakeEmail,
    appUrl: "https://app.example.test",
  };
  A = await createTenantFixture(db, "juliet");
  B = await createTenantFixture(db, "kilo");
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
  vacancy = ok(
    await run(owner, (tx, a) =>
      rc.saveVacancy(tx, a, null, {
        title: "Server",
        jobTitle: "Server",
        siteId: A.siteId,
        employmentType: "part_time",
        openings: 3,
      }),
    ),
  ).id;
  ok(await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vacancy, "open")));
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("sending", () => {
  it("needs hire permission, the Offer stage and an email address", async () => {
    const early = await applicant("Early", "early@example.test", "interview");
    expect(
      await offers.sendOffer(deps, owner, early, "Offer", await letter()),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      message: expect.stringMatching(/Offer first/),
    });
    const noEmail = await applicant("Noemail", null);
    expect(
      await offers.sendOffer(deps, owner, noEmail, "Offer", await letter()),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/email address/),
    });
    const ready = await applicant("Ready", "ready@example.test");
    expect(
      await offers.sendOffer(deps, manager, ready, "Offer", await letter()),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(
      await offers.sendOffer(deps, otherOwner, ready, "Offer", await letter()),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("an accepted offer", () => {
  let app: string;
  let token: string;

  it("is emailed as a private link; only the token's hash is stored", async () => {
    app = await applicant("Amy", "Amy@Example.test");
    const r = ok(
      await offers.sendOffer(
        deps,
        owner,
        app,
        "Offer of employment: Server",
        await letter("Amy offer"),
      ),
    );
    expect(r.emailed).toBe(true);
    const mail = sent.at(-1)!;
    expect(mail.to).toBe("amy@example.test");
    expect(mail.subject).toMatch(/Your job offer from juliet/);
    token = tokenFrom(mail);
    expect(r.link).toBe(`https://app.example.test/offer#${token}`);
    const stored = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT token_hash, sent_to FROM offer_letter WHERE application_id = $1`,
            [app],
          )
        ).rows[0],
    );
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);
    // One open offer at a time.
    expect(
      await offers.sendOffer(deps, owner, app, "Again", await letter()),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/already waiting/),
    });
  });

  it("shows the applicant only what they need, and nothing for a wrong link", async () => {
    expect(await offers.viewOffer(db, token)).toMatchObject({
      state: "open",
      title: "Offer of employment: Server",
      firstName: "Amy",
      hasSignedCopy: false,
    });
    expect(await offers.viewOffer(db, `${token}x`)).toEqual({
      state: "missing",
    });
    const f = await offers.offerFile(deps, token);
    expect(f.ok && f.signed).toBe(false);
  });

  it("is accepted with a typed name and agreement, once, with a signed copy", async () => {
    expect(
      await offers.respondToOffer(deps, token, "accept", "A", false),
    ).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), agree: expect.any(String) },
    });
    expect(
      await offers.respondToOffer(deps, token, "accept", " Amy  Offer ", true),
    ).toEqual({
      ok: true,
      outcome: "accepted",
    });
    expect(
      await offers.respondToOffer(deps, token, "decline", "", false),
    ).toMatchObject({ ok: false });
    const f = await offers.offerFile(deps, token);
    if (!f.ok) throw new Error("no file");
    expect(f.signed).toBe(true);
    expect((await PDFDocument.load(f.bytes)).getPageCount()).toBe(2);
    const list = (await run(owner, (tx, a) => rc.offersFor(tx, a, app)))!;
    expect(list.offers[0]).toMatchObject({
      status: "accepted",
      signedName: "Amy Offer",
      hasSignedCopy: true,
    });
    // Staff can open it (audited); a site manager without hire can't.
    const offerId = list.offers[0]!.id;
    expect(
      (await offers.staffOfferFile(deps, owner, offerId, "signed")).ok,
    ).toBe(true);
    expect(
      await offers.staffOfferFile(deps, manager, offerId, "signed"),
    ).toEqual({ ok: false });
    expect(
      await offers.staffOfferFile(deps, otherOwner, offerId, "signed"),
    ).toEqual({ ok: false });
  });
});

describe("declined, withdrawn and expired offers", () => {
  it("can be declined", async () => {
    const app = await applicant("Dee", "dee@example.test");
    ok(await offers.sendOffer(deps, owner, app, "Offer", await letter()));
    const t = tokenFrom(sent.at(-1)!);
    expect(await offers.respondToOffer(deps, t, "decline", "", false)).toEqual({
      ok: true,
      outcome: "declined",
    });
    expect(await offers.viewOffer(db, t)).toMatchObject({ state: "declined" });
  });

  it("stop working when withdrawn or expired", async () => {
    const w = await applicant("Wes", "wes@example.test");
    const offerId = ok(
      await offers.sendOffer(deps, owner, w, "Offer", await letter()),
    ).id;
    const t = tokenFrom(sent.at(-1)!);
    expect(
      await run(manager, (tx, a) => rc.withdrawOffer(tx, a, offerId)),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    ok(await run(owner, (tx, a) => rc.withdrawOffer(tx, a, offerId)));
    expect(await offers.viewOffer(db, t)).toMatchObject({ state: "withdrawn" });
    expect(await offers.offerFile(deps, t)).toEqual({ ok: false });
    expect(
      await offers.respondToOffer(deps, t, "accept", "Wes Offer", true),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/withdrawn/),
    });

    const x = await applicant("Exp", "exp@example.test");
    ok(await offers.sendOffer(deps, owner, x, "Offer", await letter()));
    const tx2 = tokenFrom(sent.at(-1)!);
    await admin((c) =>
      c.query(
        `UPDATE offer_letter SET expires_at = now() - interval '1 minute' WHERE application_id = $1`,
        [x],
      ),
    );
    expect(await offers.viewOffer(db, tx2)).toMatchObject({ state: "expired" });
    expect(
      await offers.respondToOffer(deps, tx2, "accept", "Exp Offer", true),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/expired/),
    });
  });
});

describe("audit and the database itself", () => {
  it("audits with ids only", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS detail FROM audit_event WHERE tenant_id = $1 AND action LIKE 'recruitment.offer_%'`,
            [A.tenantId],
          )
        ).rows as { action: string; detail: string }[],
    );
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set([
        "recruitment.offer_sent",
        "recruitment.offer_accepted",
        "recruitment.offer_declined",
        "recruitment.offer_viewed",
        "recruitment.offer_withdrawn",
      ]),
    );
    for (const r of rows)
      expect(r.detail).not.toMatch(
        /Amy|Offer of employment|\.pdf|example\.test/,
      );
  });

  it("lets nothing but the link record an answer, and has no DELETE", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(c.query(`DELETE FROM offer_letter`)).rejects.toThrow(
        /permission denied/,
      );
      for (const col of [
        "signed_name",
        "responded_at",
        "final_storage_key",
        "token_hash",
        "expires_at",
      ])
        await expect(
          c.query(`UPDATE offer_letter SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
    });
    // Even the app role's allowed columns can't fake an acceptance.
    await expect(
      withTenant(db, owner.ctx, (tx) =>
        tx.offerLetter.updateMany({
          where: { tenantId: A.tenantId, status: "sent" },
          data: { status: "accepted" },
        }),
      ),
    ).rejects.toThrow(/offer_letter_flow/);
  });
});
