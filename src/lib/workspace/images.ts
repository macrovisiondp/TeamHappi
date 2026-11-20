// Profile photos and the organisation logo (M17). Tenant data: every query runs
// inside withTenant (RLS). Rules:
// - a photo can be set or removed by the person themselves (their linked
//   record) or by someone with employee.manage at the person's site;
// - anyone in the organisation can see photos (like a company directory);
// - the logo is set or removed by owners and administrators
//   (tenant.settings.manage) and seen by everyone in the organisation.

import { checkImage } from "@/lib/images";
import type { TenantTx } from "@/lib/tenancy";

import { can } from "./policy";
import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export type ImageResult = { ok: true } | { ok: false; message: string };

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

async function audit(
  tx: TenantTx,
  ws: Ready,
  action: string,
  targetType: string,
  targetId: string,
) {
  await tx.auditEvent.create({
    data: {
      tenantId: ws.tenant.id,
      actorUserId: ws.ctx.userId!,
      action,
      targetType,
      targetId,
      detail: {},
    },
    select: { id: true },
  });
}

/** May this member change this person's photo? */
async function photoTarget(tx: TenantTx, ws: Ready, employeeId: string) {
  if (!isUuid(employeeId)) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: employeeId } },
    select: { id: true, membershipId: true, primarySiteId: true },
  });
  if (!e) return null;
  const own = e.membershipId === ws.membershipId;
  const manager =
    e.primarySiteId === null
      ? ws.grants.get("employee.manage") === "all"
      : can(ws.grants, "employee.manage", e.primarySiteId);
  return own || manager ? e : null;
}

export async function setPhoto(
  tx: TenantTx,
  ws: Ready,
  employeeId: string,
  bytes: Uint8Array,
): Promise<ImageResult> {
  const e = await photoTarget(tx, ws, employeeId);
  if (!e) return { ok: false, message: "You can't change this photo." };
  const img = checkImage(bytes);
  if (!img.ok) return img;
  await tx.mediaImage.deleteMany({
    where: { tenantId: ws.tenant.id, kind: "employee_photo", employeeId: e.id },
  });
  await tx.mediaImage.create({
    data: {
      tenantId: ws.tenant.id,
      kind: "employee_photo",
      employeeId: e.id,
      contentType: img.contentType,
      bytes: Buffer.from(img.bytes),
      createdBy: ws.ctx.userId!,
    },
    select: { id: true },
  });
  await audit(tx, ws, "employee.photo_set", "employee", e.id);
  return { ok: true };
}

export async function removePhoto(
  tx: TenantTx,
  ws: Ready,
  employeeId: string,
): Promise<ImageResult> {
  const e = await photoTarget(tx, ws, employeeId);
  if (!e) return { ok: false, message: "You can't change this photo." };
  await tx.mediaImage.deleteMany({
    where: { tenantId: ws.tenant.id, kind: "employee_photo", employeeId: e.id },
  });
  await audit(tx, ws, "employee.photo_removed", "employee", e.id);
  return { ok: true };
}

const canBrand = (ws: Ready) =>
  ws.grants.get("tenant.settings.manage") === "all";

export async function setLogo(
  tx: TenantTx,
  ws: Ready,
  bytes: Uint8Array,
): Promise<ImageResult> {
  if (!canBrand(ws))
    return {
      ok: false,
      message: "Only owners and administrators can change the logo.",
    };
  const img = checkImage(bytes);
  if (!img.ok) return img;
  await tx.mediaImage.deleteMany({
    where: { tenantId: ws.tenant.id, kind: "organisation_logo" },
  });
  const row = await tx.mediaImage.create({
    data: {
      tenantId: ws.tenant.id,
      kind: "organisation_logo",
      contentType: img.contentType,
      bytes: Buffer.from(img.bytes),
      createdBy: ws.ctx.userId!,
    },
    select: { id: true },
  });
  await audit(tx, ws, "tenant.logo_set", "media_image", row.id);
  return { ok: true };
}

export async function removeLogo(
  tx: TenantTx,
  ws: Ready,
): Promise<ImageResult> {
  if (!canBrand(ws))
    return {
      ok: false,
      message: "Only owners and administrators can change the logo.",
    };
  await tx.mediaImage.deleteMany({
    where: { tenantId: ws.tenant.id, kind: "organisation_logo" },
  });
  await audit(tx, ws, "tenant.logo_removed", "tenant", ws.tenant.id);
  return { ok: true };
}

/** The image itself, for the image routes (anyone in the organisation). */
export async function readImage(
  tx: TenantTx,
  ws: Ready,
  what: { kind: "photo"; employeeId: string } | { kind: "logo" },
) {
  if (what.kind === "photo" && !isUuid(what.employeeId)) return null;
  const row = await tx.mediaImage.findFirst({
    where:
      what.kind === "photo"
        ? {
            tenantId: ws.tenant.id,
            kind: "employee_photo",
            employeeId: what.employeeId,
          }
        : { tenantId: ws.tenant.id, kind: "organisation_logo" },
    select: { id: true, contentType: true, bytes: true },
  });
  return row
    ? {
        id: row.id,
        contentType: row.contentType,
        bytes: new Uint8Array(row.bytes),
      }
    : null;
}

/** Ids of current photos (the id changes when a photo is replaced). */
export async function photoIds(
  tx: TenantTx,
  ws: Ready,
  employeeIds: string[],
): Promise<Map<string, string>> {
  if (!employeeIds.length) return new Map();
  const rows = await tx.mediaImage.findMany({
    where: {
      tenantId: ws.tenant.id,
      kind: "employee_photo",
      employeeId: { in: employeeIds },
    },
    select: { id: true, employeeId: true },
  });
  return new Map(rows.map((r) => [r.employeeId!, r.id]));
}

export async function logoId(tx: TenantTx, ws: Ready) {
  const row = await tx.mediaImage.findFirst({
    where: { tenantId: ws.tenant.id, kind: "organisation_logo" },
    select: { id: true },
  });
  return row?.id ?? null;
}
