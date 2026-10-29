// M9.3 online applications, run as the real application role with NO
// organisation context (like the public page): the vacancy must be open,
// fields and files are checked, duplicates create nothing and look like
// success, rate limits apply, the application lands at "Applied" with the
// privacy notice recorded, the CV attaches only to a fresh online
// application, the audit has no personal details, and the throttle table is
// closed to every application role.

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import {
  clientHash,
  submitPublicApplication,
} from "@/lib/workspace/public-application";
import { publicVacancy } from "@/lib/workspace/public-vacancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as rc from "@/modules/recruitment";

import {
  admin,
  appDb,
  createTenantFixture,
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let vacancy: string;
let code: string;
const KEY = "k".repeat(40);

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
const run = <T>(w: Ready, fn: (tx: TenantTx, a: rc.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: rc.Result<T>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
const PDF = new Uint8Array(
  Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n"),
);
let device = 0;
/** A fresh device per call unless one is given (rate limits are per device). */
const apply = (
  fields: Record<string, unknown>,
  opts: { code?: string; file?: Uint8Array | null; address?: string } = {},
) =>
  submitPublicApplication(db, {
    code: opts.code ?? code,
    fields: {
      givenName: "Synthetic",
      familyName: "Applicant",
      phone: "",
      consent: "on",
      ...fields,
    },
    file: opts.file ? { name: "My CV.pdf", bytes: opts.file } : null,
    clientAddress: opts.address ?? `198.51.100.${++device}`,
    hashKey: KEY,
  });
const applicationsFor = (email: string) =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT a.id, a.stage, a.created_by, a.privacy_notice_version, c.source, c.created_by AS cand_by
           FROM application a JOIN candidate c ON c.id = a.candidate_id
           WHERE c.email = $1 AND a.vacancy_id = $2`,
          [email, vacancy],
        )
      ).rows,
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "papa");
  B = await createTenantFixture(db, "quebec");
  owner = await ws(A.ownerUserId);
  vacancy = ok(
    await run(owner, (tx, a) =>
      rc.saveVacancy(tx, a, null, {
        title: "Host",
        jobTitle: "Host",
        siteId: A.siteId,
        employmentType: "part_time",
        openings: 1,
      }),
    ),
  ).id;
  ok(await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vacancy, "open")));
  ok(
    await run(owner, (tx, a) =>
      rc.updateSharing(tx, a, vacancy, { kind: "enable" }),
    ),
  );
  code = await admin(
    async (c) =>
      (
        await c.query(`SELECT public_code FROM vacancy WHERE id = $1`, [
          vacancy,
        ])
      ).rows[0].public_code as string,
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("applying from the share link", () => {
  it("the public page shows the retention period for the privacy notice", async () => {
    expect(await publicVacancy(db, code, "none")).toMatchObject({
      state: "open",
      retentionMonths: 6,
    });
  });

  it("creates the candidate and application at Applied, with the notice version and a system history entry", async () => {
    const r = await apply({ email: "Online.Applicant@Example.test" });
    expect(r).toEqual({ kind: "received", cv: "none" });
    const [row] = await applicationsFor("online.applicant@example.test");
    expect(row).toMatchObject({
      stage: "applied",
      created_by: null,
      cand_by: null,
      source: "careers_page",
      privacy_notice_version: rc.PRIVACY_NOTICE_VERSION,
    });
    const view = (await run(owner, (tx, a) =>
      rc.getApplication(tx, a, row.id, "Europe/London"),
    ))!;
    expect(view.history).toMatchObject([
      { from: null, to: "applied", by: "System" },
    ]);
    // The audit records ids and the notice version, never personal details.
    const audit = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, actor_user_id, detail::text AS detail FROM audit_event WHERE target_id = $1`,
            [row.id],
          )
        ).rows,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "recruitment.online_application",
      actor_user_id: null,
    });
    expect(audit[0].detail).not.toMatch(/Synthetic|Applicant|example\.test/i);
  });

  it("a second application with the same email creates nothing and looks the same", async () => {
    expect(await apply({ email: "online.applicant@example.test" })).toEqual({
      kind: "received",
      cv: "none",
    });
    expect(await applicationsFor("online.applicant@example.test")).toHaveLength(
      1,
    );
  });

  it("checks the fields and the file before writing anything", async () => {
    const r = await apply(
      { email: "not-an-email", givenName: "", consent: "" },
      { file: new Uint8Array(Buffer.from("<html></html>")) },
    );
    expect(r).toMatchObject({
      kind: "invalid",
      fieldErrors: {
        email: expect.any(String),
        givenName: expect.any(String),
        consent: expect.any(String),
        cv: expect.any(String),
      },
    });
  });

  it("attaches a CV the candidate sends, shown to the organisation as from the candidate", async () => {
    expect(
      await apply({ email: "cv.applicant@example.test" }, { file: PDF }),
    ).toEqual({ kind: "received", cv: "attached" });
    const [row] = await applicationsFor("cv.applicant@example.test");
    const list = (await run(owner, (tx, a) =>
      rc.listDocuments(tx, a, row.id),
    ))!;
    expect(list.documents).toMatchObject([
      { fileName: "My CV.pdf", kind: "PDF", uploadedBy: "the candidate" },
    ]);
    const doc = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT storage_key, uploaded_by FROM application_document WHERE application_id = $1`,
            [row.id],
          )
        ).rows[0],
    );
    expect(doc.uploaded_by).toBeNull();
    expect(doc.storage_key).toMatch(
      new RegExp(`^tenants/${A.tenantId}/objects/`),
    );
  });

  it("attach works only once, only for fresh online applications, only in the right organisation", async () => {
    const [online] = await applicationsFor("cv.applicant@example.test");
    const attach = (tenantId: string, applicationId: string) =>
      withPg(
        urls.appUrl,
        async (c) =>
          (
            await c.query(
              `SELECT app.public_apply_attach($1, $2, $3, 'x.pdf', 'application/pdf', 10, $4, 'local-disk') AS id`,
              [
                tenantId,
                applicationId,
                randomBytes(24).toString("base64url"),
                "c".repeat(64),
              ],
            )
          ).rows[0].id,
      );
    // Already has a CV.
    expect(await attach(A.tenantId, online.id)).toBeNull();
    // Wrong organisation for that application.
    expect(await attach(B.tenantId, online.id)).toBeNull();
    // An application a member added (not online).
    const staffApp = ok(
      await run(owner, (tx, a) =>
        rc.addApplication(tx, a, vacancy, {
          givenName: "Staff",
          familyName: "Added",
          email: "staff.added@example.test",
        }),
      ),
    ).id;
    expect(await attach(A.tenantId, staffApp)).toBeNull();
    // An online application older than 10 minutes.
    await apply({ email: "late.applicant@example.test" });
    const [late] = await applicationsFor("late.applicant@example.test");
    await admin((c) =>
      c.query(
        `UPDATE application SET created_at = now() - interval '11 minutes' WHERE id = $1`,
        [late.id],
      ),
    );
    expect(await attach(A.tenantId, late.id)).toBeNull();
  });

  it("refuses closed vacancies and unknown or malformed codes", async () => {
    expect(
      await apply({ email: "x@example.test" }, { code: "notavalidcode!" }),
    ).toEqual({ kind: "missing" });
    expect(
      await apply({ email: "x@example.test" }, { code: "AAAAAAAAAAAA" }),
    ).toEqual({ kind: "missing" });
    ok(
      await run(owner, (tx, a) =>
        rc.setVacancyStatus(tx, a, vacancy, "paused"),
      ),
    );
    expect(await apply({ email: "closed@example.test" })).toEqual({
      kind: "closed",
    });
    expect(await applicationsFor("closed@example.test")).toHaveLength(0);
    ok(
      await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vacancy, "open")),
    );
  });

  it("limits one device to five attempts an hour, duplicates and failures included", async () => {
    const address = "203.0.113.77";
    for (let i = 0; i < 5; i++)
      expect(
        await apply({ email: `limit${i}@example.test` }, { address }),
      ).toMatchObject({ kind: "received" });
    expect(await apply({ email: "limit5@example.test" }, { address })).toEqual({
      kind: "limited",
    });
    expect(await applicationsFor("limit5@example.test")).toHaveLength(0);
    // Another device is unaffected.
    expect(await apply({ email: "limit6@example.test" })).toMatchObject({
      kind: "received",
    });
  });
});

describe("the database itself", () => {
  it("keeps only keyed hashes of device addresses, and no application role can touch them", async () => {
    const rows = await admin(
      async (c) =>
        (await c.query(`SELECT client_hash FROM public_apply_throttle`)).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.map((r) => r.client_hash)).toContain(
      clientHash("203.0.113.77", KEY),
    );
    for (const url of [urls.appUrl, urls.authUrl, urls.platformUrl].filter(
      Boolean,
    ))
      await withPg(url!, async (c) => {
        await expect(
          c.query(`SELECT 1 FROM public_apply_throttle`),
        ).rejects.toThrow(/permission denied/);
      });
  });

  it("the app role can't write privacy-notice fields directly", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(
        c.query(`UPDATE application SET privacy_notice_version = 'x'`),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
