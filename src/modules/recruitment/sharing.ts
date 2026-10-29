// Vacancy share links and QR codes (M9.2a). A vacancy can have an unlisted
// public link (/jobs/<code>) showing only its published fields while it's
// open, and a "how to apply" text. No applicant data is collected: online
// applications are M9.3 (gate R5). Anyone who can manage the vacancy can
// create, regenerate (switching the old link off) or remove the link.

import { randomBytes } from "node:crypto";

import { isUuid, type TenantTx } from "@/lib/tenancy";

import { canAt, type Actor } from "./policy";
import type { Result } from "./service";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 12 random base62 characters (rejection sampling, so no bias). */
export function newPublicCode(): string {
  let out = "";
  while (out.length < 12) {
    for (const b of randomBytes(16)) {
      // 248 = 4 × 62: bytes above it would make some characters more likely.
      if (b < 248 && out.length < 12) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const isPublicCode = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9]{12}$/.test(v);

export type ShareCommand =
  | { kind: "enable" }
  | { kind: "regenerate" }
  | { kind: "disable" }
  | { kind: "details"; howToApply: unknown; showPay: unknown };

export async function updateSharing(
  tx: TenantTx,
  actor: Actor,
  vacancyId: string,
  cmd: ShareCommand,
): Promise<Result> {
  if (!isUuid(vacancyId))
    return {
      ok: false,
      code: "not_found",
      message: "That vacancy couldn't be found.",
    };
  const v = await tx.vacancy.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: vacancyId } },
    select: { id: true, siteId: true, publicCode: true },
  });
  if (!v || !canAt(actor, "recruitment.view", v.siteId))
    return {
      ok: false,
      code: "not_found",
      message: "That vacancy couldn't be found.",
    };
  if (!canAt(actor, "recruitment.manage", v.siteId))
    return {
      ok: false,
      code: "forbidden",
      message: "Your role doesn't allow this change.",
    };
  const where = { tenantId_id: { tenantId: actor.tenantId, id: v.id } };
  let action: string;
  if (cmd.kind === "details") {
    const howToApply =
      typeof cmd.howToApply === "string" ? cmd.howToApply.trim() : "";
    if (howToApply.length > 1000)
      return {
        ok: false,
        code: "invalid",
        message: "Check the highlighted fields.",
        fieldErrors: { howToApply: "Keep it under 1000 characters" },
      };
    await tx.vacancy.update({
      where,
      data: { howToApply: howToApply || null, showPay: cmd.showPay === true },
      select: { id: true },
    });
    action = "recruitment.share_details_updated";
  } else if (cmd.kind === "disable") {
    if (!v.publicCode)
      return {
        ok: false,
        code: "conflict",
        message: "This vacancy has no share link.",
      };
    await tx.vacancy.update({
      where,
      data: { publicCode: null },
      select: { id: true },
    });
    action = "recruitment.share_link_removed";
  } else {
    if (cmd.kind === "enable" && v.publicCode)
      return {
        ok: false,
        code: "conflict",
        message: "This vacancy already has a share link.",
      };
    await tx.vacancy.update({
      where,
      data: { publicCode: newPublicCode() },
      select: { id: true },
    });
    action =
      cmd.kind === "enable"
        ? "recruitment.share_link_created"
        : "recruitment.share_link_regenerated";
  }
  // Never the code itself: anyone reading the audit trail could otherwise open it.
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType: "vacancy",
      targetId: v.id,
      detail: {},
    },
    select: { id: true },
  });
  return { ok: true, data: { id: v.id } };
}
