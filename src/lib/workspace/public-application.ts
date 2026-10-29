import { createHmac, randomBytes } from "node:crypto";

import { blobStore } from "@/integrations/storage/blob";
import { objectKey } from "@/integrations/storage";
import type { DbClient } from "@/lib/db/create-client";
import * as recruitment from "@/modules/recruitment";

// Online applications from a vacancy's share link (M9.3). The page has no
// signed-in organisation, so everything goes through two SECURITY DEFINER
// functions: app.public_apply (checks the vacancy is open, rate limits and
// duplicates, then creates the candidate and application) and
// app.public_apply_attach (records the CV once it's in storage). Order:
//   check fields and file -> apply -> store the CV -> attach it
// If storing or attaching the CV fails, the application stands without it.
// The device's address is never stored: only a keyed hash, for rate limits.

export type PublicApplyOutcome =
  | { kind: "received"; cv: "attached" | "none" | "failed" }
  | { kind: "invalid"; fieldErrors: Record<string, string> }
  | { kind: "limited" }
  | { kind: "closed" }
  | { kind: "missing" };

/** Keyed hash of the device address; the key never leaves the server. */
export function clientHash(address: string, key: string): string {
  return createHmac("sha256", key)
    .update(`teamhappi:public-apply:${address}`)
    .digest("hex");
}

export async function submitPublicApplication(
  client: DbClient,
  input: {
    code: string;
    fields: Record<string, unknown>;
    file: { name: string; bytes: Uint8Array } | null;
    clientAddress: string;
    hashKey: string;
  },
): Promise<PublicApplyOutcome> {
  if (!recruitment.isPublicCode(input.code)) return { kind: "missing" };
  const parsed = recruitment.parsePublicApplication(input.fields);
  const checked = input.file
    ? recruitment.inspectCv(input.file.bytes, input.file.name)
    : null;
  const fieldErrors = {
    ...(parsed.ok ? {} : parsed.fieldErrors),
    ...(checked && !checked.ok ? { cv: checked.message } : {}),
  };
  if (!parsed.ok || (checked && !checked.ok))
    return { kind: "invalid", fieldErrors };
  const f = parsed.data;
  const [row] = await client.$queryRaw<
    {
      status: "created" | "duplicate" | "limited" | "closed" | "missing";
      tenant_id: string | null;
      application_id: string | null;
    }[]
  >`SELECT status, tenant_id, application_id FROM app.public_apply(
      ${input.code}, ${f.givenName}, ${f.familyName}, ${f.email}, ${f.phone},
      ${recruitment.PRIVACY_NOTICE_VERSION},
      ${clientHash(input.clientAddress, input.hashKey)})`;
  if (!row || row.status === "missing") return { kind: "missing" };
  if (row.status === "closed") return { kind: "closed" };
  if (row.status === "limited") return { kind: "limited" };
  // A duplicate looks exactly like success, so the page never reveals who applied.
  if (row.status === "duplicate" || !checked?.ok)
    return { kind: "received", cv: "none" };

  const store = await blobStore();
  if (!store) return { kind: "received", cv: "failed" };
  const objectId = randomBytes(24).toString("base64url");
  const key = objectKey(row.tenant_id!, objectId);
  try {
    await store.put(key, input.file!.bytes, checked.contentType);
  } catch {
    return { kind: "received", cv: "failed" };
  }
  try {
    const [att] = await client.$queryRaw<{ id: string | null }[]>`
      SELECT app.public_apply_attach(
        ${row.tenant_id}::uuid, ${row.application_id}::uuid, ${objectId},
        ${checked.fileName}, ${checked.contentType}, ${input.file!.bytes.length}::integer,
        ${checked.sha256}, ${store.providerId}) AS id`;
    if (att?.id) return { kind: "received", cv: "attached" };
  } catch {
    // Fall through: remove the stored file.
  }
  await store.remove(key).catch(() => {});
  return { kind: "received", cv: "failed" };
}
