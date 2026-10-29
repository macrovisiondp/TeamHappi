// M9.2b CVs, run as the real application role: who can upload, open and
// remove a CV (site scope, interviewers for their own candidate, other
// organisations get not-found), every upload/open/removal audited with ids
// only, anonymisation marks CVs for deletion, the per-application limit, and
// the database posture (no DELETE, fixed columns, keys inside the tenant
// prefix, one-way status). Storage itself is exercised in tests/unit/cv-storage.test.ts.

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
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
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let recruiter: Ready;
let siteManager: Ready; // A's first site
let otherSiteManager: Ready; // A's second site
let interviewer: Ready; // a worker interviewing the candidate
let worker: Ready;
let otherOwner: Ready;
let app: string;
let candidateId: string;
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
const run = <T>(w: Ready, fn: (tx: TenantTx, a: rc.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: rc.Result<T>) => {
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
const keyFor = (tenantId: string) =>
  `tenants/${tenantId}/objects/${randomBytes(24).toString("base64url")}`;
const file = (tenantId: string, name = "Synthetic CV.pdf") => ({
  fileName: name,
  contentType: rc.CV_TYPES.pdf,
  sizeBytes: 1234,
  sha256: "a".repeat(64),
  providerId: "local-disk",
  storageKey: keyFor(tenantId),
});

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "cvalpha");
  B = await createTenantFixture(db, "cvbravo");
  owner = await ws(A.ownerUserId);
  recruiter = await ws(await member(A.tenantId, "recruiter"));
  siteManager = await ws(await member(A.tenantId, "site_manager", A.siteId));
  const site2 = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'C2', 'cvalpha North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  otherSiteManager = await ws(await member(A.tenantId, "site_manager", site2));
  interviewer = await ws(await member(A.tenantId, "worker"));
  worker = await ws(await member(A.tenantId, "worker"));
  otherOwner = await ws(B.ownerUserId);

  const vacancy = ok(
    await run(owner, (tx, a) =>
      rc.saveVacancy(tx, a, null, {
        title: "Line cook",
        jobTitle: "Cook",
        siteId: A.siteId,
        employmentType: "full_time",
        openings: 1,
      }),
    ),
  ).id;
  ok(await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vacancy, "open")));
  app = ok(
    await run(owner, (tx, a) =>
      rc.addApplication(tx, a, vacancy, {
        givenName: "Synthetic",
        familyName: "Applicant",
        email: "cv-applicant@example.test",
      }),
    ),
  ).id;
  ok(
    await run(owner, (tx, a) =>
      rc.scheduleInterview(tx, a, app, TZ, {
        scheduledAt: "2026-11-05T10:00",
        durationMinutes: 30,
        format: "in_person",
        interviewerIds: [interviewer.membershipId],
      }),
    ),
  );
  candidateId = (await run(owner, (tx, a) =>
    rc.getApplication(tx, a, app, TZ),
  ))!.candidate.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("who can upload, open and remove CVs", () => {
  let doc: string;

  it("people who manage recruitment at the site upload; others are refused before any file is stored", async () => {
    expect(
      await run(siteManager, (tx, a) => rc.mayUpload(tx, a, app)),
    ).toMatchObject({ ok: true });
    expect(
      await run(recruiter, (tx, a) => rc.mayUpload(tx, a, app)),
    ).toMatchObject({ ok: true });
    // Interviewers can see the application but not change it.
    expect(
      await run(interviewer, (tx, a) => rc.mayUpload(tx, a, app)),
    ).toMatchObject({ ok: false, code: "forbidden" });
    for (const w of [otherSiteManager, worker, otherOwner])
      expect(await run(w, (tx, a) => rc.mayUpload(tx, a, app))).toMatchObject({
        ok: false,
        code: "not_found",
      });
    expect(
      await run(otherOwner, (tx, a) =>
        rc.recordUpload(tx, a, app, file(B.tenantId)),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    doc = ok(
      await run(siteManager, (tx, a) =>
        rc.recordUpload(tx, a, app, file(A.tenantId)),
      ),
    ).id;
  });

  it("lists CVs to those who can see the application, interviewers included", async () => {
    for (const w of [owner, recruiter, siteManager, interviewer]) {
      const list = (await run(w, (tx, a) => rc.listDocuments(tx, a, app)))!;
      expect(list.documents.map((d) => d.id)).toEqual([doc]);
      expect(list.documents[0]).toMatchObject({
        fileName: "Synthetic CV.pdf",
        kind: "PDF",
      });
    }
    expect(
      (await run(interviewer, (tx, a) => rc.listDocuments(tx, a, app)))!,
    ).toMatchObject({ canUpload: false, canRemove: false });
    for (const w of [otherSiteManager, worker, otherOwner])
      expect(await run(w, (tx, a) => rc.listDocuments(tx, a, app))).toBeNull();
  });

  it("opens a CV only for allowed people, auditing each download without the file name", async () => {
    const opened = ok(
      await run(interviewer, (tx, a) => rc.openDocument(tx, a, doc)),
    );
    expect(opened.storageKey).toMatch(
      new RegExp(`^tenants/${A.tenantId}/objects/`),
    );
    for (const w of [otherSiteManager, worker, otherOwner])
      expect(
        await run(w, (tx, a) => rc.openDocument(tx, a, doc)),
      ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(owner, (tx, a) => rc.openDocument(tx, a, "not-a-uuid")),
    ).toMatchObject({ ok: false, code: "not_found" });
    const events = await auditFor(app);
    const downloads = events.filter(
      (e) => e.action === "recruitment.cv_downloaded",
    );
    expect(downloads).toHaveLength(1);
    expect(events.map((e) => e.action)).toContain("recruitment.cv_uploaded");
    for (const e of events) expect(e.detail).not.toMatch(/Synthetic CV/);
  });

  it("removes a CV: only managers, then it can't be opened, and the file is queued for deletion", async () => {
    expect(
      await run(interviewer, (tx, a) => rc.removeDocument(tx, a, doc)),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(otherOwner, (tx, a) => rc.removeDocument(tx, a, doc)),
    ).toMatchObject({ ok: false, code: "not_found" });
    ok(await run(recruiter, (tx, a) => rc.removeDocument(tx, a, doc)));
    expect(
      await run(owner, (tx, a) => rc.openDocument(tx, a, doc)),
    ).toMatchObject({ ok: false, code: "not_found" });
    const pending = await run(owner, (tx, a) => rc.pendingDeletions(tx, a));
    expect(pending.map((p) => p.id)).toEqual([doc]);
    // Other organisations never see this organisation's queue.
    expect(
      await run(otherOwner, (tx, a) => rc.pendingDeletions(tx, a)),
    ).toEqual([]);
    await run(owner, (tx, a) => rc.markDeleted(tx, a, [doc]));
    const row = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT status, file_name, delete_reason FROM application_document WHERE id = $1`,
            [doc],
          )
        ).rows[0],
    );
    expect(row).toEqual({
      status: "deleted",
      file_name: null,
      delete_reason: "removed",
    });
    expect((await auditFor(app)).map((e) => e.action)).toContain(
      "recruitment.cv_removed",
    );
  });

  it("allows at most five stored CVs per application", async () => {
    for (let i = 0; i < rc.CV_MAX_PER_APPLICATION; i++)
      ok(
        await run(owner, (tx, a) =>
          rc.recordUpload(tx, a, app, file(A.tenantId, `v${i}.pdf`)),
        ),
      );
    expect(
      await run(owner, (tx, a) =>
        rc.recordUpload(tx, a, app, file(A.tenantId)),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      (await run(owner, (tx, a) => rc.listDocuments(tx, a, app)))!.canUpload,
    ).toBe(false);
  });

  it("anonymising the candidate marks every CV for deletion and blanks the names", async () => {
    ok(
      await run(owner, (tx, a) =>
        rc.closeApplication(tx, a, app, { kind: "withdraw" }),
      ),
    );
    ok(
      await run(owner, (tx, a) =>
        rc.anonymiseCandidate(tx, a, candidateId, "2028-01-01"),
      ),
    );
    expect(
      (await run(owner, (tx, a) => rc.listDocuments(tx, a, app)))!.documents,
    ).toEqual([]);
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ status: string; file_name: string | null }>(
            `SELECT status, file_name, delete_reason FROM application_document WHERE application_id = $1 AND status <> 'deleted'`,
            [app],
          )
        ).rows,
    );
    expect(rows).toHaveLength(rc.CV_MAX_PER_APPLICATION);
    for (const r of rows)
      expect(r).toEqual({
        status: "deleting",
        file_name: null,
        delete_reason: "anonymised",
      });
    expect(await run(owner, (tx, a) => rc.mayUpload(tx, a, app))).toMatchObject(
      { ok: false, code: "conflict" },
    );
    const anonymised = (await auditFor(candidateId)).find(
      (e) => e.action === "recruitment.candidate_anonymised",
    )!;
    expect(JSON.parse(anonymised.detail)).toMatchObject({ cvs: 5 });
  });
});

describe("the database itself", () => {
  it("has no DELETE, fixes everything but the deletion details, and keeps keys inside the organisation", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(c.query(`DELETE FROM application_document`)).rejects.toThrow(
        /permission denied/,
      );
      for (const col of [
        "storage_key",
        "provider_id",
        "application_id",
        "uploaded_by",
        "sha256",
      ])
        await expect(
          c.query(`UPDATE application_document SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
      // Without an organisation context the app role sees nothing.
      expect(
        (await c.query(`SELECT 1 FROM application_document`)).rows,
      ).toEqual([]);
    });
    // Another organisation's prefix, or a path trick, is refused for every role.
    for (const key of [
      keyFor(B.tenantId),
      `tenants/${A.tenantId}/objects/../x/aaaaaaaaaaaaaaaaaaaa`,
    ])
      await expect(
        admin((c) =>
          c.query(
            `INSERT INTO application_document (tenant_id, application_id, file_name, content_type, size_bytes, sha256, provider_id, storage_key, uploaded_by)
             VALUES ($1, $2, 'x.pdf', 'application/pdf', 10, $3, 'aws-s3', $4, $5)`,
            [A.tenantId, app, "b".repeat(64), key, A.ownerUserId],
          ),
        ),
      ).rejects.toThrow(/application_document_key/);
    // Only PDF and .docx; at most 4 MB.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO application_document (tenant_id, application_id, file_name, content_type, size_bytes, sha256, provider_id, storage_key, uploaded_by)
           VALUES ($1, $2, 'x.html', 'text/html', 10, $3, 'aws-s3', $4, $5)`,
          [A.tenantId, app, "b".repeat(64), keyFor(A.tenantId), A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/application_document_content_type/);
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO application_document (tenant_id, application_id, file_name, content_type, size_bytes, sha256, provider_id, storage_key, uploaded_by)
           VALUES ($1, $2, 'x.pdf', 'application/pdf', 4194305, $3, 'aws-s3', $4, $5)`,
          [A.tenantId, app, "b".repeat(64), keyFor(A.tenantId), A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/application_document_size/);
    // Status only moves forward; deleted rows stay deleted; rows are never removed.
    await expect(
      admin((c) =>
        c.query(
          `UPDATE application_document SET status = 'stored' WHERE application_id = $1 AND status = 'deleted'`,
          [app],
        ),
      ),
    ).rejects.toThrow(/stored -> deleting -> deleted/);
    await expect(
      admin((c) =>
        c.query(
          `UPDATE application_document SET storage_key = storage_key || 'x' WHERE application_id = $1`,
          [app],
        ),
      ),
    ).rejects.toThrow(/only deletion details/);
    await expect(
      admin((c) =>
        c.query(`DELETE FROM application_document WHERE application_id = $1`, [
          app,
        ]),
      ),
    ).rejects.toThrow(/never deleted/);
  });
});
