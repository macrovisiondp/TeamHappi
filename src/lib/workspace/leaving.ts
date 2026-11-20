// Offboarding (M18, docs/architecture/m18-offboarding.md). Someone with
// employee.manage at the person's site records that they're leaving: last
// working day, reason, an optional private note. A leaving checklist starts
// when a leaving template fits.
//
// After the last day ends (in the organisation's time zone), or straight away
// with "End access now", the leaving is finalised:
//   - the staff record becomes "left" (history kept);
//   - their login stops working for this organisation (membership "left");
//   - open invitations for the record are revoked;
//   - later shifts are unassigned and become open;
//   - documents still waiting for their signature are withdrawn.
// Finalising is checked whenever anyone in the organisation uses TeamHappi
// (resolve.ts), so it happens on time without a scheduled job. Audit events
// carry ids and codes only, never the private note.

import * as onboarding from "@/modules/onboarding";
import * as rota from "@/modules/rota";
import * as signing from "@/modules/signing";
import { isUuid, type TenantTx } from "@/lib/tenancy";

import { can } from "./policy";
import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export const LEAVING_REASONS = [
  "resigned",
  "end_of_contract",
  "dismissed",
  "other",
] as const;
export type LeavingReason = (typeof LEAVING_REASONS)[number];

export type LeavingResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const isIso = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Midnight at the start of `iso` in `timeZone`, as an instant. */
function startOfDay(iso: string, timeZone: string): Date {
  return rota.zonedToUtc(`${iso}T00:00`, timeZone) ?? asDate(iso);
}

interface SystemActor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Ready["grants"];
}

async function audit(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  action: string,
  employeeId: string,
  detail: Record<string, string | number | boolean | null> = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId,
      actorUserId: userId,
      action,
      targetType: "employee",
      targetId: employeeId,
      detail,
    },
    select: { id: true },
  });
}

/** Who may record a leaving: employee.manage at the person's site. */
async function manageable(tx: TenantTx, ws: Ready, employeeId: string) {
  if (!isUuid(employeeId)) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: employeeId } },
    select: {
      id: true,
      status: true,
      primarySiteId: true,
      membershipId: true,
      startDate: true,
    },
  });
  if (!e) return null;
  const ok =
    e.primarySiteId === null
      ? ws.grants.get("employee.manage") === "all"
      : can(ws.grants, "employee.manage", e.primarySiteId);
  return ok ? e : null;
}

const openLeaving = (tx: TenantTx, tenantId: string, employeeId: string) =>
  tx.employeeLeaving.findFirst({
    where: { tenantId, employeeId, cancelledAt: null },
    select: {
      id: true,
      lastDay: true,
      reason: true,
      note: true,
      recordedBy: true,
      recordedAt: true,
      finalisedAt: true,
      accessEndedEarly: true,
    },
  });

/** The person's leaving, for their record (null if none, or not yours to see). */
export async function leavingFor(tx: TenantTx, ws: Ready, employeeId: string) {
  const e = await manageable(tx, ws, employeeId);
  if (!e) return null;
  const l = await openLeaving(tx, ws.tenant.id, e.id);
  const checklist = await onboarding.leavingCaseFor(tx, actorFor(ws), e.id);
  return {
    canManage: true,
    status: e.status,
    leaving: l
      ? {
          lastDay: isoOf(l.lastDay),
          reason: l.reason as LeavingReason,
          note: l.note,
          finalised: l.finalisedAt !== null,
          endedEarly: l.accessEndedEarly,
        }
      : null,
    checklist,
    templates: (
      await tx.onboardingTemplate.findMany({
        where: { tenantId: ws.tenant.id, archivedAt: null, purpose: "leaving" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    ).map((t) => ({ id: t.id, name: t.name })),
  };
}

const actorFor = (ws: Ready): SystemActor => ({
  tenantId: ws.tenant.id,
  userId: ws.ctx.userId!,
  membershipId: ws.membershipId,
  grants: ws.grants,
});

export async function markLeaving(
  tx: TenantTx,
  ws: Ready,
  employeeId: string,
  raw: {
    lastDay?: unknown;
    reason?: unknown;
    note?: unknown;
    templateId?: unknown;
    endNow?: unknown;
  },
  today: string,
): Promise<LeavingResult> {
  const e = await manageable(tx, ws, employeeId);
  if (!e) return { ok: false, message: "That person couldn't be found." };
  if (e.status === "left")
    return { ok: false, message: "This person has already left." };
  if (await openLeaving(tx, ws.tenant.id, e.id))
    return {
      ok: false,
      message:
        "Their leaving is already recorded. Cancel it first to change it.",
    };
  const errors: Record<string, string> = {};
  const endNow = raw.endNow === true;
  const lastDay = endNow && !isIso(raw.lastDay) ? today : raw.lastDay;
  if (!isIso(lastDay)) errors.lastDay = "Enter their last working day";
  else if (lastDay < "2000-01-01") errors.lastDay = "Check the date";
  else if (e.startDate && lastDay < isoOf(e.startDate))
    errors.lastDay = "Their last day can't be before their start date";
  const reason = LEAVING_REASONS.find((r) => r === raw.reason);
  if (!reason) errors.reason = "Choose a reason";
  const note =
    typeof raw.note === "string" ? raw.note.replace(/\s+$/g, "").trim() : "";
  if (note.length > 1000) errors.note = "Keep the note under 1,000 characters";
  if (Object.keys(errors).length || !reason || !isIso(lastDay))
    return {
      ok: false,
      message: "Please check the highlighted fields.",
      fieldErrors: errors,
    };

  const row = await tx.employeeLeaving.create({
    data: {
      tenantId: ws.tenant.id,
      employeeId: e.id,
      lastDay: asDate(lastDay),
      reason,
      note: note || null,
      recordedBy: ws.ctx.userId!,
    },
    select: { id: true, lastDay: true },
  });
  await audit(
    tx,
    ws.tenant.id,
    ws.ctx.userId!,
    "employee.leaving_recorded",
    e.id,
    {
      reason,
      lastDay,
    },
  );
  const templateId =
    typeof raw.templateId === "string" && isUuid(raw.templateId)
      ? raw.templateId
      : null;
  await onboarding.startLeavingCase(
    tx,
    actorFor(ws),
    e.id,
    lastDay,
    templateId,
  );

  // Already past, or access ends now: finalise straight away.
  if (endNow || lastDay < today)
    await finalise(tx, actorFor(ws), ws.tenant.timezone, {
      id: row.id,
      employeeId: e.id,
      lastDay,
      early: endNow && lastDay >= today,
      today,
    });
  return { ok: true };
}

export async function cancelLeaving(
  tx: TenantTx,
  ws: Ready,
  employeeId: string,
): Promise<LeavingResult> {
  const e = await manageable(tx, ws, employeeId);
  if (!e) return { ok: false, message: "That person couldn't be found." };
  const l = await openLeaving(tx, ws.tenant.id, e.id);
  if (!l) return { ok: false, message: "There's no leaving to cancel." };
  if (l.finalisedAt)
    return {
      ok: false,
      message:
        "They've already left. To bring them back, add them again as a new starter.",
    };
  await tx.employeeLeaving.update({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: l.id } },
    data: { cancelledAt: new Date(), cancelledBy: ws.ctx.userId! },
    select: { id: true },
  });
  const checklist = await onboarding.leavingCaseFor(tx, actorFor(ws), e.id);
  if (checklist?.status === "active")
    await onboarding.cancelCase(
      tx,
      actorFor(ws),
      checklist.id,
      "They're no longer leaving",
    );
  await audit(
    tx,
    ws.tenant.id,
    ws.ctx.userId!,
    "employee.leaving_cancelled",
    e.id,
  );
  return { ok: true };
}

export async function endAccessNow(
  tx: TenantTx,
  ws: Ready,
  employeeId: string,
  today: string,
): Promise<LeavingResult> {
  const e = await manageable(tx, ws, employeeId);
  if (!e) return { ok: false, message: "That person couldn't be found." };
  const l = await openLeaving(tx, ws.tenant.id, e.id);
  if (!l)
    return {
      ok: false,
      message: "Record their leaving first, then you can end their access.",
    };
  if (l.finalisedAt)
    return { ok: false, message: "Their access has already ended." };
  await finalise(tx, actorFor(ws), ws.tenant.timezone, {
    id: l.id,
    employeeId: e.id,
    lastDay: isoOf(l.lastDay),
    early: true,
    today,
  });
  return { ok: true };
}

/**
 * Finalises one leaving. `early` = access ends now, before the last day ends:
 * shifts from now on are released; otherwise from the day after the last day.
 */
async function finalise(
  tx: TenantTx,
  actor: SystemActor,
  timeZone: string,
  l: {
    id: string;
    employeeId: string;
    lastDay: string;
    early: boolean;
    today: string;
  },
) {
  const now = new Date();
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: l.employeeId } },
    select: { id: true, membershipId: true, endDate: true },
  });
  if (!e) return;
  const endDate = l.early && l.lastDay > l.today ? l.today : l.lastDay;
  await tx.employee.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: e.id } },
    data: { status: "left", endDate: asDate(endDate), updatedAt: now },
    select: { id: true },
  });
  if (e.membershipId)
    await tx.tenantMembership.updateMany({
      where: {
        tenantId: actor.tenantId,
        id: e.membershipId,
        status: { not: "left" },
      },
      data: { status: "left", updatedAt: now },
    });
  await tx.invitation.updateMany({
    where: { tenantId: actor.tenantId, employeeId: e.id, status: "pending" },
    data: { status: "revoked", revokedAt: now, updatedAt: now },
  });
  const from = l.early
    ? now
    : startOfDay(
        isoOf(new Date(asDate(l.lastDay).getTime() + 864e5)),
        timeZone,
      );
  const shifts = await rota.releaseShiftsFrom(tx, actor, e.id, from);
  const documents = await signing.withdrawOpenFor(tx, actor, e.id);
  await tx.employeeLeaving.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: l.id } },
    data: { finalisedAt: now, accessEndedEarly: l.early },
    select: { id: true },
  });
  await audit(tx, actor.tenantId, actor.userId, "employee.left", e.id, {
    early: l.early,
    shiftsReleased: shifts,
    documentsWithdrawn: documents,
  });
}

/**
 * Finalises every leaving whose last day has ended. Run as part of loading the
 * organisation on each request (resolve.ts); one indexed query when nothing is
 * due. The audit trail records the person who recorded the leaving.
 */
export async function finaliseDueLeavers(
  tx: TenantTx,
  tenantId: string,
  timeZone: string,
  today: string,
) {
  const due = await tx.employeeLeaving.findMany({
    where: {
      tenantId,
      cancelledAt: null,
      finalisedAt: null,
      lastDay: { lt: asDate(today) },
    },
    select: { id: true, employeeId: true, lastDay: true, recordedBy: true },
    take: 50,
  });
  for (const l of due)
    await finalise(
      tx,
      { tenantId, userId: l.recordedBy, membershipId: "", grants: new Map() },
      timeZone,
      {
        id: l.id,
        employeeId: l.employeeId,
        lastDay: isoOf(l.lastDay),
        early: false,
        today,
      },
    );
}
