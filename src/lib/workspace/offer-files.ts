// Offer letters (M14.3): moving bytes and the applicant's private link.
//
// Staff (signed in): check -> store the PDF -> record the offer (with the
// SHA-256 of a random token) -> email the applicant the link. The token itself
// is never stored; the link carries it in the URL fragment, which browsers
// don't send to servers or put in logs.
//
// Applicant (no login): everything goes through app.offer_view and
// app.offer_respond, found by the token's hash. Accepting fetches the exact
// letter (checked against its SHA-256), adds a signature page, stores the
// signed copy, then records the answer; if recording fails, the copy is deleted.
// Takes the database client, file store and email sender as arguments, so the
// whole flow can be tested.

import { randomUUID } from "node:crypto";

import type { EmailProvider } from "@/integrations/email";
import type { BlobStore } from "@/integrations/storage/blob";
import { objectKey } from "@/integrations/storage";
import type { DbClient } from "@/lib/db/create-client";
import {
  hashInvitationToken,
  newInvitationToken,
} from "@/lib/invitations/token";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as recruitment from "@/modules/recruitment";
import * as signing from "@/modules/signing";

import type { Workspace } from "./resolve";
import { appendSignaturePage, canSign } from "./signature-page";

type Ready = Extract<Workspace, { kind: "ready" }>;

export interface OfferDeps {
  client: DbClient;
  store: BlobStore | null;
  storeFor: (providerId: string) => Promise<BlobStore | null>;
  email: EmailProvider | null;
  appUrl: string;
}

const actorOf = (ws: Ready): recruitment.Actor => ({
  tenantId: ws.tenant.id,
  userId: ws.ctx.userId!,
  membershipId: ws.membershipId,
  grants: ws.grants,
});
const inTx = <T>(
  d: OfferDeps,
  ws: Ready,
  fn: (tx: TenantTx, a: recruitment.Actor) => Promise<T>,
) => withTenant(d.client, ws.ctx, (tx) => fn(tx, actorOf(ws)));

export const offerLink = (appUrl: string, token: string) =>
  `${new URL("/offer", appUrl).toString()}#${token}`;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

/** Uploads the offer letter, records it and emails the applicant their link. */
export async function sendOffer(
  d: OfferDeps,
  ws: Ready,
  applicationId: unknown,
  title: unknown,
  file: { name: string; bytes: Uint8Array },
): Promise<recruitment.Result<{ id: string; emailed: boolean; link: string }>> {
  const ok = await inTx(d, ws, (tx, a) =>
    recruitment.mayOffer(tx, a, applicationId, title),
  );
  if (!ok.ok) return ok;
  if (!d.store)
    return {
      ok: false,
      code: "conflict",
      message: "Document storage isn't switched on for this organisation yet.",
    };
  const c = signing.inspectPdf(file.bytes, file.name);
  const fail = !c.ok
    ? c.message
    : !(await canSign(file.bytes))
      ? "This PDF is locked or damaged. Save it again as a plain PDF (no password) and retry."
      : null;
  if (fail || !c.ok)
    return {
      ok: false,
      code: "invalid",
      message: fail!,
      fieldErrors: { file: fail! },
    };
  const storageKey = objectKey(ws.tenant.id, randomUUID().replace(/-/g, ""));
  await d.store.put(storageKey, file.bytes, "application/pdf");
  const { token, hash } = newInvitationToken();
  let rec;
  try {
    rec = await inTx(d, ws, (tx, a) =>
      recruitment.recordOffer(tx, a, {
        applicationId: ok.data.applicationId,
        title: ok.data.title,
        sentTo: ok.data.email,
        tokenHash: hash,
        file: {
          fileName: c.fileName,
          sizeBytes: file.bytes.length,
          sha256: c.sha256,
          providerId: d.store!.providerId,
          storageKey,
        },
      }),
    );
  } catch (e) {
    await d.store.remove(storageKey).catch(() => {});
    throw e;
  }
  if (!rec.ok) {
    await d.store.remove(storageKey).catch(() => {});
    return rec;
  }
  const link = offerLink(d.appUrl, token);
  let emailed = false;
  if (d.email)
    try {
      const org = oneLine(ws.tenant.name);
      await d.email.send({
        to: ok.data.email,
        subject: `Your job offer from ${org}`,
        text: `Hello ${oneLine(ok.data.firstName)},\n\n${org} has sent you an offer: ${oneLine(ok.data.title)}.\n\nRead it, then accept or decline here (this link works for ${recruitment.OFFER_DAYS} days):\n${link}\n\nIf you weren't expecting this, you can ignore this email.\n\nTeamHappi, on behalf of ${org}`,
        idempotencyKey: `offer-${rec.data.id}`,
      });
      emailed = true;
    } catch {
      emailed = false;
    }
  return { ok: true, data: { id: rec.data.id, emailed, link } };
}

// --- The applicant's side (no login) ------------------------------------------------------

interface ViewRow {
  state: "missing" | "open" | "expired" | "accepted" | "declined" | "withdrawn";
  organisation: string | null;
  title: string | null;
  first_name: string | null;
  expires_at: Date | null;
  file_name: string | null;
  provider_id: string | null;
  storage_key: string | null;
  sha256: string | null;
  final_provider_id: string | null;
  final_storage_key: string | null;
  final_sha256: string | null;
}

async function viewRow(
  client: DbClient,
  token: unknown,
): Promise<ViewRow | null> {
  const hash = typeof token === "string" ? hashInvitationToken(token) : "";
  if (!hash) return null;
  const [row] = await client.$queryRaw<
    ViewRow[]
  >`SELECT * FROM app.offer_view(${hash})`;
  return row && row.state !== "missing" ? row : null;
}

export type PublicOffer =
  | { state: "missing" }
  | {
      state: "open" | "expired" | "accepted" | "declined" | "withdrawn";
      organisation: string;
      title: string;
      firstName: string;
      expiresAt: Date;
      hasSignedCopy: boolean;
    };

/** What the applicant sees (no file locations). */
export async function viewOffer(
  client: DbClient,
  token: unknown,
): Promise<PublicOffer> {
  const r = await viewRow(client, token);
  if (!r) return { state: "missing" };
  return {
    state: r.state as Exclude<PublicOffer["state"], "missing">,
    organisation: r.organisation!,
    title: r.title!,
    firstName: r.first_name!,
    expiresAt: r.expires_at!,
    hasSignedCopy: !!r.final_storage_key,
  };
}

/** The letter (or, once accepted, the signed copy), checked against its fingerprint. */
export async function offerFile(
  d: Pick<OfferDeps, "client" | "storeFor">,
  token: unknown,
): Promise<
  | { ok: true; fileName: string; bytes: Uint8Array; signed: boolean }
  | { ok: false }
> {
  const r = await viewRow(d.client, token);
  if (!r || r.state === "withdrawn") return { ok: false };
  const signed = r.state === "accepted" && !!r.final_storage_key;
  const providerId = signed ? r.final_provider_id! : r.provider_id!;
  const key = signed ? r.final_storage_key! : r.storage_key!;
  const sha = signed ? r.final_sha256! : r.sha256!;
  const store = await d.storeFor(providerId);
  if (!store) return { ok: false };
  const bytes = await store.get(key);
  if (signing.sha256Of(bytes) !== sha) return { ok: false };
  const name = r.file_name!;
  return {
    ok: true,
    fileName: signed ? name.replace(/\.pdf$/i, " (signed).pdf") : name,
    bytes,
    signed,
  };
}

export type RespondOutcome =
  | { ok: true; outcome: "accepted" | "declined" }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** The applicant accepts (typed name and agreement) or declines. */
export async function respondToOffer(
  d: Pick<OfferDeps, "client" | "store" | "storeFor">,
  token: unknown,
  decision: unknown,
  nameRaw: unknown,
  agreed: unknown,
): Promise<RespondOutcome> {
  const hash = typeof token === "string" ? hashInvitationToken(token) : "";
  const r = await viewRow(d.client, token);
  if (!hash || !r)
    return { ok: false, message: "This offer link isn't valid." };
  if (r.state !== "open")
    return {
      ok: false,
      message:
        r.state === "expired"
          ? "This offer has expired. Contact the employer."
          : r.state === "withdrawn"
            ? "This offer has been withdrawn."
            : "You've already answered this offer.",
    };
  if (decision === "decline") {
    const [x] = await d.client.$queryRaw<{ offer_respond: string }[]>`
      SELECT app.offer_respond(${hash}, 'decline', NULL, NULL, NULL, NULL)`;
    return x?.offer_respond === "declined"
      ? { ok: true, outcome: "declined" }
      : { ok: false, message: "You've already answered this offer." };
  }
  if (decision !== "accept")
    return { ok: false, message: "Choose accept or decline." };
  const errors: Record<string, string> = {};
  const name =
    typeof nameRaw === "string"
      ? nameRaw.normalize("NFC").replace(/\s+/g, " ").trim()
      : "";
  if (name.length < 2 || name.length > 100)
    errors.name = "Type your full name to accept";
  if (agreed !== true) errors.agree = "Tick the box to confirm you accept";
  if (Object.keys(errors).length)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: errors,
    };
  const source = await d.storeFor(r.provider_id!);
  if (!d.store || !source)
    return {
      ok: false,
      message: "This offer can't be signed right now. Try again later.",
    };
  const original = await source.get(r.storage_key!);
  if (signing.sha256Of(original) !== r.sha256)
    return {
      ok: false,
      message: "This offer can't be signed right now. Contact the employer.",
    };
  const signed = await appendSignaturePage(original, {
    title: r.title!,
    organisation: r.organisation!,
    documentSha256: r.sha256!,
    employee: { name, at: new Date() },
    countersign: null,
    signer: {
      heading: "Applicant",
      statement:
        'Accepted electronically through a private link sent to the applicant\'s email address, by typing their name and confirming: "I have read this offer and I accept it."',
    },
  });
  const tenantPrefix = r.storage_key!.split("/")[1]!;
  const key = objectKey(tenantPrefix, randomUUID().replace(/-/g, ""));
  await d.store.put(key, signed, "application/pdf");
  try {
    const [x] = await d.client.$queryRaw<{ offer_respond: string }[]>`
      SELECT app.offer_respond(${hash}, 'accept', ${name}, ${d.store.providerId}, ${key}, ${signing.sha256Of(signed)})`;
    if (x?.offer_respond !== "accepted") {
      await d.store.remove(key).catch(() => {});
      return { ok: false, message: "You've already answered this offer." };
    }
    return { ok: true, outcome: "accepted" };
  } catch (e) {
    await d.store.remove(key).catch(() => {});
    throw e;
  }
}

// --- Staff viewing (audited) ----------------------------------------------------------

export async function staffOfferFile(
  d: Pick<OfferDeps, "client" | "storeFor">,
  ws: Ready,
  offerId: unknown,
  which: "original" | "signed",
): Promise<{ ok: true; fileName: string; bytes: Uint8Array } | { ok: false }> {
  const r = await withTenant(d.client, ws.ctx, (tx) =>
    recruitment.openOffer(tx, actorOf(ws), offerId, which),
  );
  if (!r.ok) return { ok: false };
  const store = await d.storeFor(r.data.providerId);
  if (!store) return { ok: false };
  const bytes = await store.get(r.data.storageKey);
  if (signing.sha256Of(bytes) !== r.data.sha256) return { ok: false };
  return { ok: true, fileName: r.data.fileName, bytes };
}
