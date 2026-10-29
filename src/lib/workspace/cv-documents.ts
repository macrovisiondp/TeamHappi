import "server-only";

import { randomBytes } from "node:crypto";

import { blobStore, blobStoreFor } from "@/integrations/storage/blob";
import { objectKey } from "@/integrations/storage";
import { db } from "@/lib/db";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as recruitment from "@/modules/recruitment";

import type { Workspace } from "./resolve";

// CV upload, download and removal (M9.2b). The recruitment module decides
// and records; this file moves bytes to and from storage, never inside a
// database transaction (storage calls can be slow). Order of work:
//   upload:   check -> put file -> record (if recording fails, delete file)
//   download: check + audit -> get file
//   remove:   mark for deletion -> delete file -> mark deleted
// A file whose deletion failed stays "deleting" and is retried on the next
// removal or anonymisation in that organisation.

type Ready = Extract<Workspace, { kind: "ready" }>;

const actorOf = (ws: Ready): recruitment.Actor => ({
  tenantId: ws.tenant.id,
  userId: ws.ctx.userId!,
  membershipId: ws.membershipId,
  grants: ws.grants,
});
const inTx = <T>(
  ws: Ready,
  fn: (tx: TenantTx, a: recruitment.Actor) => Promise<T>,
) => withTenant(db(), ws.ctx, (tx) => fn(tx, actorOf(ws)));

const STORAGE_OFF = {
  ok: false,
  code: "conflict",
  message: "CV uploads aren't switched on for this organisation yet.",
} as const;

/** Whether this deployment can store new CVs. */
export async function cvStorageReady(): Promise<boolean> {
  return (await blobStore()) !== null;
}

export async function uploadCv(
  ws: Ready,
  applicationId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<recruitment.Result> {
  const store = await blobStore();
  if (!store) return STORAGE_OFF;
  const checked = recruitment.inspectCv(file.bytes, file.name);
  if (!checked.ok)
    return {
      ok: false,
      code: "invalid",
      message: checked.message,
      fieldErrors: { file: checked.message },
    };
  const allowed = await inTx(ws, (tx, a) =>
    recruitment.mayUpload(tx, a, applicationId),
  );
  if (!allowed.ok) return allowed;
  const storageKey = objectKey(
    ws.tenant.id,
    randomBytes(24).toString("base64url"),
  );
  await store.put(storageKey, file.bytes, checked.contentType);
  try {
    return await inTx(ws, (tx, a) =>
      recruitment.recordUpload(tx, a, applicationId, {
        fileName: checked.fileName,
        contentType: checked.contentType,
        sizeBytes: file.bytes.length,
        sha256: checked.sha256,
        providerId: store.providerId,
        storageKey,
      }),
    ).then(async (r) => {
      if (!r.ok) await store.remove(storageKey);
      return r;
    });
  } catch (e) {
    await store.remove(storageKey).catch(() => {});
    throw e;
  }
}

export async function downloadCv(
  ws: Ready,
  documentId: string,
): Promise<
  | { ok: true; fileName: string; contentType: string; bytes: Uint8Array }
  | { ok: false }
> {
  const r = await inTx(ws, (tx, a) =>
    recruitment.openDocument(tx, a, documentId),
  );
  if (!r.ok) return { ok: false };
  const store = await blobStoreFor(r.data.providerId);
  if (!store) return { ok: false };
  const bytes = await store.get(r.data.storageKey);
  return {
    ok: true,
    fileName: r.data.fileName,
    contentType: r.data.contentType,
    bytes,
  };
}

export async function removeCv(
  ws: Ready,
  documentId: string,
): Promise<recruitment.Result> {
  const r = await inTx(ws, (tx, a) =>
    recruitment.removeDocument(tx, a, documentId),
  );
  if (r.ok) await purgeDeletedCvs(ws);
  return r;
}

/**
 * Deletes files marked for deletion in this organisation from storage. Failures
 * are logged (ids only) and retried next time; they never fail the caller.
 */
export async function purgeDeletedCvs(ws: Ready): Promise<void> {
  try {
    const pending = await inTx(ws, recruitment.pendingDeletions);
    const done: string[] = [];
    for (const doc of pending) {
      const store = await blobStoreFor(doc.providerId);
      if (!store) continue;
      try {
        await store.remove(doc.storageKey);
        done.push(doc.id);
      } catch {
        console.warn(`cv_delete_failed document=${doc.id}`);
      }
    }
    await inTx(ws, (tx, a) => recruitment.markDeleted(tx, a, done));
  } catch {
    console.warn(`cv_purge_failed tenant=${ws.tenant.id}`);
  }
}
