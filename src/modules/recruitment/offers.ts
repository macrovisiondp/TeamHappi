// Offer letters (M14.3, scope D1). These functions decide and record for STAFF;
// the workspace layer moves files, emails the link and builds the signed copy.
// The applicant's side (view, accept, decline) goes only through the database
// functions app.offer_view and app.offer_respond, found by the link's token.
//
//   - recruitment.hire at the vacancy's site: send an offer (application at
//     the Offer stage, still open, with an email address), withdraw it, and
//     open the letter or the signed copy (audited);
//   - recruitment.view at the site: see offers' status only.
// The audit trail holds ids only: never titles, names or file names.

import { isUuid, type TenantTx } from "@/lib/tenancy";

import { canAt, type Actor } from "./policy";
import type { Result } from "./service";

const notFound = {
  ok: false,
  code: "not_found",
  message: "That application couldn't be found.",
} as const;
const forbidden = {
  ok: false,
  code: "forbidden",
  message: "Sending offers needs permission to hire at this site.",
} as const;
const conflict = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;

export const OFFER_DAYS = 14;

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  applicationId: string,
  detail: Record<string, string>,
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType: "application",
      targetId: applicationId,
      detail,
    },
    select: { id: true },
  });
}

async function application(tx: TenantTx, actor: Actor, applicationId: unknown) {
  if (typeof applicationId !== "string" || !isUuid(applicationId)) return null;
  return tx.application.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: applicationId } },
    select: {
      id: true,
      stage: true,
      outcome: true,
      vacancy: { select: { siteId: true } },
      candidate: {
        select: { email: true, givenName: true, anonymisedAt: true },
      },
    },
  });
}

/** Checks an offer may be sent now; returns where to send it. */
export async function mayOffer(
  tx: TenantTx,
  actor: Actor,
  applicationId: unknown,
  titleRaw: unknown,
): Promise<
  Result<{
    applicationId: string;
    email: string;
    firstName: string;
    title: string;
  }>
> {
  const a = await application(tx, actor, applicationId);
  if (!a || !canAt(actor, "recruitment.view", a.vacancy.siteId))
    return notFound;
  if (!canAt(actor, "recruitment.hire", a.vacancy.siteId)) return forbidden;
  if (a.outcome !== "active" || a.stage !== "offer")
    return conflict("Move the application to Offer first.");
  if (a.candidate.anonymisedAt)
    return conflict("This candidate has been anonymised.");
  if (!a.candidate.email)
    return conflict(
      "Add the candidate's email address first, so the offer can reach them.",
    );
  const title =
    typeof titleRaw === "string" ? titleRaw.replace(/\s+/g, " ").trim() : "";
  if (!title || title.length > 120)
    return {
      ok: false,
      code: "invalid",
      message: "Check the highlighted fields.",
      fieldErrors: { title: "Give the offer a title (up to 120 characters)" },
    };
  const open = await tx.offerLetter.count({
    where: { tenantId: actor.tenantId, applicationId: a.id, status: "sent" },
  });
  if (open)
    return conflict(
      "An offer is already waiting for an answer. Withdraw it first.",
    );
  return {
    ok: true,
    data: {
      applicationId: a.id,
      email: a.candidate.email,
      firstName: a.candidate.givenName,
      title,
    },
  };
}

/** Records an offer whose file is already stored. */
export async function recordOffer(
  tx: TenantTx,
  actor: Actor,
  input: {
    applicationId: string;
    title: string;
    sentTo: string;
    tokenHash: string;
    file: {
      fileName: string;
      sizeBytes: number;
      sha256: string;
      providerId: string;
      storageKey: string;
    };
  },
  now = new Date(),
): Promise<Result> {
  const again = await mayOffer(tx, actor, input.applicationId, input.title);
  if (!again.ok) return again;
  const row = await tx.offerLetter.create({
    data: {
      tenantId: actor.tenantId,
      applicationId: input.applicationId,
      title: input.title,
      ...input.file,
      sentTo: input.sentTo.toLowerCase(),
      tokenHash: input.tokenHash,
      expiresAt: new Date(now.getTime() + OFFER_DAYS * 86_400_000),
      sentBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "recruitment.offer_sent", input.applicationId, {
    offerId: row.id,
  });
  return { ok: true, data: row };
}

export async function withdrawOffer(
  tx: TenantTx,
  actor: Actor,
  offerId: unknown,
): Promise<Result> {
  if (typeof offerId !== "string" || !isUuid(offerId)) return notFound;
  const o = await tx.offerLetter.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: offerId } },
    select: {
      id: true,
      status: true,
      applicationId: true,
      application: { select: { vacancy: { select: { siteId: true } } } },
    },
  });
  if (!o || !canAt(actor, "recruitment.view", o.application.vacancy.siteId))
    return notFound;
  if (!canAt(actor, "recruitment.hire", o.application.vacancy.siteId))
    return forbidden;
  const r = await tx.offerLetter.updateMany({
    where: { tenantId: actor.tenantId, id: o.id, status: "sent" },
    data: {
      status: "withdrawn",
      withdrawnBy: actor.userId,
      withdrawnAt: new Date(),
    },
  });
  if (r.count !== 1)
    return conflict("This offer has already been answered or withdrawn.");
  await audit(tx, actor, "recruitment.offer_withdrawn", o.applicationId, {
    offerId: o.id,
  });
  return { ok: true, data: { id: o.id } };
}

/** Offers on an application (status for anyone who can see it). */
export async function offersFor(
  tx: TenantTx,
  actor: Actor,
  applicationId: unknown,
  now = new Date(),
) {
  const a = await application(tx, actor, applicationId);
  if (!a || !canAt(actor, "recruitment.view", a.vacancy.siteId)) return null;
  const rows = await tx.offerLetter.findMany({
    where: { tenantId: actor.tenantId, applicationId: a.id },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      sentAt: true,
      expiresAt: true,
      respondedAt: true,
      signedName: true,
      finalStorageKey: true,
    },
  });
  return {
    canSend: canAt(actor, "recruitment.hire", a.vacancy.siteId),
    atOffer: a.outcome === "active" && a.stage === "offer",
    hasEmail: !!a.candidate.email,
    offers: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: (r.status === "sent" && r.expiresAt <= now
        ? "expired"
        : r.status) as
        "sent" | "expired" | "accepted" | "declined" | "withdrawn",
      sentAt: r.sentAt,
      expiresAt: r.expiresAt,
      respondedAt: r.respondedAt,
      signedName: r.signedName,
      hasSignedCopy: r.finalStorageKey !== null,
    })),
  };
}

/** Opens an offer letter or its signed copy for staff who can hire (audited). */
export async function openOffer(
  tx: TenantTx,
  actor: Actor,
  offerId: unknown,
  which: "original" | "signed",
): Promise<
  Result<{
    providerId: string;
    storageKey: string;
    fileName: string;
    sha256: string;
  }>
> {
  if (typeof offerId !== "string" || !isUuid(offerId)) return notFound;
  const o = await tx.offerLetter.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: offerId } },
    select: {
      id: true,
      applicationId: true,
      fileName: true,
      providerId: true,
      storageKey: true,
      sha256: true,
      finalProviderId: true,
      finalStorageKey: true,
      finalSha256: true,
      application: { select: { vacancy: { select: { siteId: true } } } },
    },
  });
  if (!o || !canAt(actor, "recruitment.hire", o.application.vacancy.siteId))
    return notFound;
  const file =
    which === "signed"
      ? o.finalStorageKey && o.finalProviderId && o.finalSha256
        ? {
            providerId: o.finalProviderId,
            storageKey: o.finalStorageKey,
            sha256: o.finalSha256,
            fileName: o.fileName.replace(/\.pdf$/i, " (signed).pdf"),
          }
        : null
      : {
          providerId: o.providerId,
          storageKey: o.storageKey,
          sha256: o.sha256,
          fileName: o.fileName,
        };
  if (!file) return notFound;
  await audit(tx, actor, "recruitment.offer_viewed", o.applicationId, {
    offerId: o.id,
    which,
  });
  return { ok: true, data: file };
}
