// Documents to sign (M13): moving bytes. The signing module decides and
// records; this file stores and fetches files and builds signed copies, never
// inside a database transaction (storage calls can be slow). Order of work:
//   upload:      check -> store file -> record (if recording fails, delete file)
//   sign:        check -> fetch original, verify its SHA-256 -> (build and
//                store signed copy) -> record (if recording fails, delete copy)
//   countersign: the same, with both signatures on the page.
// Takes the database client and file store as arguments, so the whole flow
// can be tested with a local folder.

import { randomBytes } from "node:crypto";

import type { BlobStore } from "@/integrations/storage/blob";
import { objectKey } from "@/integrations/storage";
import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as signing from "@/modules/signing";

import type { Workspace } from "./resolve";
import { appendSignaturePage, canSign } from "./signature-page";

type Ready = Extract<Workspace, { kind: "ready" }>;
type Res<T = { id: string }> = signing.Result<T>;

export interface SigningDeps {
  client: DbClient;
  /** The store for new files, or null when uploads are off. */
  store: BlobStore | null;
  /** The store a file was written to (by its recorded provider). */
  storeFor: (providerId: string) => Promise<BlobStore | null>;
}

const actorOf = (ws: Ready): signing.Actor => ({
  tenantId: ws.tenant.id,
  userId: ws.ctx.userId!,
  membershipId: ws.membershipId,
  grants: ws.grants,
});
const inTx = <T>(
  d: SigningDeps,
  ws: Ready,
  fn: (tx: TenantTx, a: signing.Actor) => Promise<T>,
) => withTenant(d.client, ws.ctx, (tx) => fn(tx, actorOf(ws)));

const STORAGE_OFF = {
  ok: false,
  code: "conflict",
  message: "Document storage isn't switched on for this organisation yet.",
} as const;

const newKey = (ws: Ready) =>
  objectKey(ws.tenant.id, randomBytes(24).toString("base64url"));

async function checkedPdf(file: { name: string; bytes: Uint8Array }) {
  const c = signing.inspectPdf(file.bytes, file.name);
  if (!c.ok) return c;
  if (!(await canSign(file.bytes)))
    return {
      ok: false as const,
      message:
        "This PDF is locked or damaged. Save it again as a plain PDF (no password) and retry.",
    };
  return c;
}

async function storeThenRecord(
  d: SigningDeps,
  ws: Ready,
  file: { name: string; bytes: Uint8Array },
  record: (meta: signing.FileMeta) => Promise<Res>,
): Promise<Res> {
  if (!d.store) return STORAGE_OFF;
  const c = await checkedPdf(file);
  if (!c.ok)
    return {
      ok: false,
      code: "invalid",
      message: c.message,
      fieldErrors: { file: c.message },
    };
  const storageKey = newKey(ws);
  await d.store.put(storageKey, file.bytes, "application/pdf");
  try {
    const r = await record({
      fileName: c.fileName,
      sizeBytes: file.bytes.length,
      sha256: c.sha256,
      providerId: d.store.providerId,
      storageKey,
    });
    if (!r.ok) await d.store.remove(storageKey);
    return r;
  } catch (e) {
    await d.store.remove(storageKey).catch(() => {});
    throw e;
  }
}

/** Adds a policy PDF to the organisation's library. */
export async function uploadPolicy(
  d: SigningDeps,
  ws: Ready,
  title: unknown,
  file: { name: string; bytes: Uint8Array },
  kind: signing.LibraryKind = "policy",
): Promise<Res> {
  const ok = signing.mayUploadPolicy(actorOf(ws), title);
  if (!ok.ok) return ok;
  return storeThenRecord(d, ws, file, (meta) =>
    inTx(d, ws, (tx, a) =>
      signing.recordPolicy(tx, a, ok.data.title, meta, kind),
    ),
  );
}

/** Uploads a person's own contract PDF and sends it to them to sign. */
export async function uploadContract(
  d: SigningDeps,
  ws: Ready,
  employeeId: unknown,
  title: unknown,
  file: { name: string; bytes: Uint8Array },
): Promise<Res> {
  const ok = await inTx(d, ws, (tx, a) =>
    signing.mayUploadContract(tx, a, employeeId, title),
  );
  if (!ok.ok) return ok;
  return storeThenRecord(d, ws, file, (meta) =>
    inTx(d, ws, (tx, a) =>
      signing.recordContract(tx, a, ok.data.employeeId, ok.data.title, meta),
    ),
  );
}

/** A file to show or download (audited), checked against its fingerprint. */
export async function openFile(
  d: SigningDeps,
  ws: Ready,
  requestId: unknown,
  which: "original" | "signed",
): Promise<{ ok: true; fileName: string; bytes: Uint8Array } | { ok: false }> {
  const r = await inTx(d, ws, (tx, a) =>
    signing.openFile(tx, a, requestId, which),
  );
  if (!r.ok) return { ok: false };
  const store = await d.storeFor(r.data.providerId);
  if (!store) return { ok: false };
  const bytes = await store.get(r.data.storageKey);
  if (signing.sha256Of(bytes) !== r.data.sha256) return { ok: false };
  return { ok: true, fileName: r.data.fileName, bytes };
}

async function original(d: SigningDeps, ctx: signing.SigningContext) {
  const store = await d.storeFor(ctx.providerId);
  if (!store) return null;
  const bytes = await store.get(ctx.storageKey);
  // Sign only the exact file that was uploaded and shown.
  return signing.sha256Of(bytes) === ctx.documentSha256 ? bytes : null;
}

const UNAVAILABLE = {
  ok: false,
  code: "conflict",
  message: "This document can't be signed right now. Try again in a moment.",
} as const;

async function signedCopy(
  d: SigningDeps,
  ws: Ready,
  ctx: signing.SigningContext,
  employee: { name: string; at: Date },
  countersign: { name: string; at: Date } | null,
) {
  if (!d.store) return null;
  const bytes = await original(d, ctx);
  if (!bytes) return null;
  const signed = await appendSignaturePage(bytes, {
    title: ctx.title,
    organisation: ctx.organisation,
    documentSha256: ctx.documentSha256,
    employee,
    countersign,
  });
  const storageKey = newKey(ws);
  await d.store.put(storageKey, signed, "application/pdf");
  return {
    providerId: d.store.providerId,
    storageKey,
    sha256: signing.sha256Of(signed),
  };
}

/** The signed-in person signs their own request. */
export async function sign(
  d: SigningDeps,
  ws: Ready,
  requestId: unknown,
  name: unknown,
  agreed: unknown,
): Promise<Res> {
  const p = await inTx(d, ws, (tx, a) =>
    signing.prepareSign(tx, a, requestId, name, agreed),
  );
  if (!p.ok) return p;
  const at = new Date();
  let copy: Awaited<ReturnType<typeof signedCopy>> = null;
  if (!p.data.needsCountersign) {
    copy = await signedCopy(d, ws, p.data, { name: p.data.name, at }, null);
    if (!copy) return UNAVAILABLE;
  } else if (!(await original(d, p.data))) return UNAVAILABLE;
  try {
    const r = await inTx(d, ws, (tx, a) =>
      signing.recordSign(tx, a, p.data, at, copy),
    );
    if (!r.ok && copy) await d.store!.remove(copy.storageKey);
    return r;
  } catch (e) {
    if (copy) await d.store!.remove(copy.storageKey).catch(() => {});
    throw e;
  }
}

/** Someone with documents.manage countersigns a contract the person has signed. */
export async function countersign(
  d: SigningDeps,
  ws: Ready,
  requestId: unknown,
  name: unknown,
): Promise<Res> {
  const p = await inTx(d, ws, (tx, a) =>
    signing.prepareCountersign(tx, a, requestId, name),
  );
  if (!p.ok) return p;
  if (!p.data.employeeSignature) return UNAVAILABLE;
  const at = new Date();
  const copy = await signedCopy(d, ws, p.data, p.data.employeeSignature, {
    name: p.data.name,
    at,
  });
  if (!copy) return UNAVAILABLE;
  try {
    const r = await inTx(d, ws, (tx, a) =>
      signing.recordCountersign(tx, a, p.data, at, copy),
    );
    if (!r.ok) await d.store!.remove(copy.storageKey);
    return r;
  } catch (e) {
    await d.store!.remove(copy.storageKey).catch(() => {});
    throw e;
  }
}
