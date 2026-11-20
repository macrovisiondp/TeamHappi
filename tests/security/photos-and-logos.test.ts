// M17 profile photos and organisation logos, run as the real application role:
// people change their own photo and managers change their staff's; colleagues
// can't change someone else's; only owners and administrators change the logo;
// only real PNG, JPEG or WebP (never SVG), at most 300 KB; nothing is visible
// to another organisation. Synthetic images only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { checkImage, sniffImage } from "@/lib/images";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as images from "@/lib/workspace/images";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let otherOwner: Ready;
let worker: Ready;
let colleague: Ready;
let workerRecord: string;
let colleagueRecord: string;

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const inWs = <T>(w: Ready, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(db, w.ctx, fn);

async function linkedWorker(n: string) {
  const userId = await createUser("worker");
  const employeeId = await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id)
       SELECT $1, $2, id FROM role WHERE tenant_id = $1 AND key = 'worker'`,
      [A.tenantId, m.rows[0]!.id],
    );
    return (
      await c.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status, membership_id)
         VALUES ($1, $2, $3, 'Photo', $4, 'active', $5) RETURNING id`,
        [A.tenantId, `PH-${n}`, n, A.siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "photos");
  B = await createTenantFixture(db, "photos-b");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  ({ w: worker, employeeId: workerRecord } = await linkedWorker("Wes"));
  ({ w: colleague, employeeId: colleagueRecord } = await linkedWorker("Cole"));
});

afterAll(async () => {
  await db.$disconnect();
});

describe("checking pictures", () => {
  it("recognises PNG, JPEG and WebP by their bytes, and refuses SVG and oversized files", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(
      sniffImage(
        new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "),
      ),
    ).toBe("image/webp");
    expect(checkImage(SVG).ok).toBe(false);
    const big = new Uint8Array(300 * 1024 + 1);
    big.set(PNG);
    expect(checkImage(big).ok).toBe(false);
    expect(checkImage(new Uint8Array()).ok).toBe(false);
  });
});

describe("profile photos", () => {
  it("a person sets and removes their own photo; colleagues see it", async () => {
    expect(
      await inWs(worker, (tx) =>
        images.setPhoto(tx, worker, workerRecord, PNG),
      ),
    ).toEqual({ ok: true });
    const seen = await inWs(colleague, (tx) =>
      images.readImage(tx, colleague, {
        kind: "photo",
        employeeId: workerRecord,
      }),
    );
    expect(seen?.contentType).toBe("image/png");
    // Replacing gives a new id (so browsers fetch the new picture).
    const before = seen!.id;
    await inWs(worker, (tx) => images.setPhoto(tx, worker, workerRecord, PNG));
    const ids = await inWs(owner, (tx) =>
      images.photoIds(tx, owner, [workerRecord]),
    );
    expect(ids.get(workerRecord)).not.toBe(before);
    expect(
      await inWs(worker, (tx) => images.removePhoto(tx, worker, workerRecord)),
    ).toEqual({ ok: true });
    expect(
      await inWs(owner, (tx) =>
        images.readImage(tx, owner, {
          kind: "photo",
          employeeId: workerRecord,
        }),
      ),
    ).toBeNull();
  });

  it("colleagues can't change someone else's photo; managers can", async () => {
    expect(
      (
        await inWs(colleague, (tx) =>
          images.setPhoto(tx, colleague, workerRecord, PNG),
        )
      ).ok,
    ).toBe(false);
    expect(
      await inWs(owner, (tx) =>
        images.setPhoto(tx, owner, colleagueRecord, PNG),
      ),
    ).toEqual({ ok: true });
    expect(
      (
        await inWs(worker, (tx) =>
          images.setPhoto(tx, worker, workerRecord, SVG),
        )
      ).ok,
    ).toBe(false);
  });

  it("another organisation sees and changes nothing", async () => {
    expect(
      await inWs(otherOwner, (tx) =>
        images.readImage(tx, otherOwner, {
          kind: "photo",
          employeeId: colleagueRecord,
        }),
      ),
    ).toBeNull();
    expect(
      (
        await inWs(otherOwner, (tx) =>
          images.setPhoto(tx, otherOwner, colleagueRecord, PNG),
        )
      ).ok,
    ).toBe(false);
  });
});

describe("organisation logo", () => {
  it("only owners and administrators change it; everyone in the organisation sees it", async () => {
    expect(
      (await inWs(worker, (tx) => images.setLogo(tx, worker, PNG))).ok,
    ).toBe(false);
    expect(await inWs(owner, (tx) => images.setLogo(tx, owner, PNG))).toEqual({
      ok: true,
    });
    expect(
      await inWs(worker, (tx) =>
        images.readImage(tx, worker, { kind: "logo" }),
      ),
    ).not.toBeNull();
    expect(
      await inWs(otherOwner, (tx) =>
        images.readImage(tx, otherOwner, { kind: "logo" }),
      ),
    ).toBeNull();
    expect((await inWs(worker, (tx) => images.removeLogo(tx, worker))).ok).toBe(
      false,
    );
    expect(await inWs(owner, (tx) => images.removeLogo(tx, owner))).toEqual({
      ok: true,
    });
  });

  it("the database refuses anything but small PNG, JPEG or WebP", async () => {
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO media_image (tenant_id, kind, content_type, bytes, created_by)
           VALUES ($1, 'organisation_logo', 'image/svg+xml', '\\x00', $2)`,
          [A.tenantId, A.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/media_image_type/);
  });
});
