// Personal and bank details (M14.2; DPIA docs/security/dpia-personal-and-bank-details.md).
//
// Who sees what:
//   - the person themselves (through their linked record): all of their own
//     details, with NI and bank numbers masked until they press Reveal;
//   - employee.personal (owners, admins, HR; organisation-wide): the same, for
//     anyone in the organisation, and may correct them;
//   - employee.view at the person's site (e.g. site managers): the emergency
//     contact only.
// The NI number and bank account are encrypted (the cipher is passed in by the
// workspace layer); only their last 4 characters are readable. Every change
// and every reveal is audited with ids and field NAMES only, never values.

import { isUuid, type TenantTx } from "@/lib/tenancy";
import { can, type Grants } from "@/lib/workspace/policy";

import type { FieldCipher } from "./cipher";

export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Grants;
}

export type Result<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict";
      message: string;
      fieldErrors?: Record<string, string>;
    };

const notFound = {
  ok: false,
  code: "not_found",
  message: "That person couldn't be found.",
} as const;
const invalid = (fieldErrors: Record<string, string>) =>
  ({
    ok: false,
    code: "invalid",
    message: "Check the highlighted fields.",
    fieldErrors,
  }) as const;
const keyOff = {
  ok: false,
  code: "conflict",
  message:
    "Bank and National Insurance details aren't switched on yet. Ask your TeamHappi administrator.",
} as const;

const ctx = (tenantId: string, employeeId: string, field: "ni" | "bank") =>
  `${tenantId}:${employeeId}:${field}`;

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  employeeId: string,
  detail: Record<string, string> = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType: "employee",
      targetId: employeeId,
      detail,
    },
    select: { id: true },
  });
}

/** How the actor relates to a person: self, full access, emergency only, or none. */
async function accessTo(tx: TenantTx, actor: Actor, employeeId: unknown) {
  if (typeof employeeId !== "string" || !isUuid(employeeId)) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: { id: true, membershipId: true, primarySiteId: true },
  });
  if (!e) return null;
  if (e.membershipId && e.membershipId === actor.membershipId)
    return { e, level: "self" as const };
  if (can(actor.grants, "employee.personal"))
    return { e, level: "full" as const };
  if (e.primarySiteId && can(actor.grants, "employee.view", e.primarySiteId))
    return { e, level: "emergency" as const };
  return null;
}

/** The signed-in person's own record id, if linked. */
export async function ownEmployeeId(tx: TenantTx, actor: Actor) {
  const e = await tx.employee.findUnique({
    where: {
      tenantId_membershipId: {
        tenantId: actor.tenantId,
        membershipId: actor.membershipId,
      },
    },
    select: { id: true, status: true },
  });
  return e && e.status !== "left" ? e.id : null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** What the actor may see of a person's details (masked where sensitive). */
export async function viewDetails(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
) {
  const a = await accessTo(tx, actor, employeeId);
  if (!a) return null;
  const p = await tx.employeePersonal.findUnique({
    where: {
      tenantId_employeeId: { tenantId: actor.tenantId, employeeId: a.e.id },
    },
  });
  const emergency = {
    name: p?.emergencyName ?? null,
    relationship: p?.emergencyRelationship ?? null,
    phone: p?.emergencyPhone ?? null,
  };
  if (a.level === "emergency") return { level: a.level, emergency } as const;
  return {
    level: a.level,
    emergency,
    address: {
      line1: p?.addressLine1 ?? null,
      line2: p?.addressLine2 ?? null,
      town: p?.town ?? null,
      postcode: p?.postcode ?? null,
    },
    dateOfBirth: iso(p?.dateOfBirth ?? null),
    niLast4: p?.niLast4 ?? null,
    bankLast4: p?.bankLast4 ?? null,
    updatedAt: p?.updatedAt ?? null,
  } as const;
}

export type DetailsView = NonNullable<Awaited<ReturnType<typeof viewDetails>>>;

// --- Validation ------------------------------------------------------------------------

const clean = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
const optional = (v: unknown) => clean(v) || null;

/** UK National Insurance number, e.g. "AB 12 34 56 C" (HMRC's format rules). */
export function normaliseNi(raw: string): string | null {
  const v = raw.replace(/\s+/g, "").toUpperCase();
  return /^(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(
    v,
  )
    ? v
    : null;
}

export function normaliseSortCode(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(v) ? v : null;
}

export function normaliseAccountNumber(raw: string): string | null {
  const v = raw.replace(/\s/g, "");
  return /^\d{8}$/.test(v) ? v : null;
}

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

export interface AboutInput {
  addressLine1?: unknown;
  addressLine2?: unknown;
  town?: unknown;
  postcode?: unknown;
  dateOfBirth?: unknown;
  emergencyName?: unknown;
  emergencyRelationship?: unknown;
  emergencyPhone?: unknown;
  /** Empty = keep the stored number (the form never shows it). */
  niNumber?: unknown;
}

/**
 * Saves "About you" for oneself, or for anyone with employee.personal. A blank
 * NI number keeps the stored one.
 */
export async function saveAbout(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
  raw: AboutInput,
  cipher: FieldCipher | null,
  today: string,
): Promise<Result> {
  const a = await accessTo(tx, actor, employeeId);
  if (!a || a.level === "emergency") return notFound;
  const errors: Record<string, string> = {};
  const line1 = optional(raw.addressLine1);
  const line2 = optional(raw.addressLine2);
  const town = optional(raw.town);
  const postcode = optional(raw.postcode)?.toUpperCase() ?? null;
  if (line1 && line1.length > 100)
    errors.addressLine1 = "Keep the first line to 100 characters";
  if (line2 && line2.length > 100)
    errors.addressLine2 = "Keep the second line to 100 characters";
  if (town && town.length > 60) errors.town = "Keep the town to 60 characters";
  if (postcode && !POSTCODE.test(postcode))
    errors.postcode = "Enter a UK postcode, like BN3 2AE";
  const dobRaw = clean(raw.dateOfBirth);
  let dob: string | null = null;
  if (dobRaw) {
    const ok =
      /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) &&
      !Number.isNaN(Date.parse(`${dobRaw}T00:00:00Z`));
    const age = ok ? Number(today.slice(0, 4)) - Number(dobRaw.slice(0, 4)) : 0;
    if (!ok || dobRaw > today || age < 13 || age > 100)
      errors.dateOfBirth = "Enter a real date of birth";
    else dob = dobRaw;
  }
  const eName = optional(raw.emergencyName);
  const eRel = optional(raw.emergencyRelationship);
  const ePhone = optional(raw.emergencyPhone);
  if (eName && eName.length > 100)
    errors.emergencyName = "Keep the name to 100 characters";
  if (eRel && eRel.length > 40)
    errors.emergencyRelationship = "Keep this to 40 characters";
  if (ePhone && !/^[+()\d][\d ()+-]{4,29}$/.test(ePhone))
    errors.emergencyPhone = "Enter a phone number";
  const niRaw = clean(raw.niNumber);
  let ni: string | null = null;
  if (niRaw) {
    ni = normaliseNi(niRaw);
    if (!ni)
      errors.niNumber = "Enter a National Insurance number, like AB 12 34 56 C";
    else if (!cipher) return keyOff;
  }
  if (Object.keys(errors).length) return invalid(errors);
  const fields = {
    addressLine1: line1,
    addressLine2: line2,
    town,
    postcode,
    dateOfBirth: dob ? new Date(`${dob}T00:00:00Z`) : null,
    emergencyName: eName,
    emergencyRelationship: eRel,
    emergencyPhone: ePhone,
    ...(ni
      ? {
          niCiphertext: cipher!.encrypt(ni, ctx(actor.tenantId, a.e.id, "ni")),
          niLast4: ni.slice(-4),
        }
      : {}),
    updatedBy: actor.userId,
    updatedAt: new Date(),
  };
  const row = await tx.employeePersonal.upsert({
    where: {
      tenantId_employeeId: { tenantId: actor.tenantId, employeeId: a.e.id },
    },
    create: { tenantId: actor.tenantId, employeeId: a.e.id, ...fields },
    update: fields,
    select: { id: true },
  });
  await audit(tx, actor, "personal.updated", a.e.id, {
    by: a.level,
    ni: ni ? "changed" : "unchanged",
  });
  return { ok: true, data: row };
}

/** Saves bank details (replacing any stored), encrypted. */
export async function saveBank(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
  raw: { accountName?: unknown; sortCode?: unknown; accountNumber?: unknown },
  cipher: FieldCipher | null,
): Promise<Result> {
  const a = await accessTo(tx, actor, employeeId);
  if (!a || a.level === "emergency") return notFound;
  if (!cipher) return keyOff;
  const errors: Record<string, string> = {};
  const name = clean(raw.accountName);
  if (!name || name.length > 60)
    errors.accountName = "Enter the name on the account";
  const sort = normaliseSortCode(clean(raw.sortCode));
  if (!sort) errors.sortCode = "Enter a 6-digit sort code";
  const account = normaliseAccountNumber(clean(raw.accountNumber));
  if (!account) errors.accountNumber = "Enter an 8-digit account number";
  if (Object.keys(errors).length) return invalid(errors);
  const sealed = cipher.encrypt(
    JSON.stringify({ name, sortCode: sort, accountNumber: account }),
    ctx(actor.tenantId, a.e.id, "bank"),
  );
  const data = {
    bankCiphertext: sealed,
    bankLast4: account!.slice(-4),
    updatedBy: actor.userId,
    updatedAt: new Date(),
  };
  const row = await tx.employeePersonal.upsert({
    where: {
      tenantId_employeeId: { tenantId: actor.tenantId, employeeId: a.e.id },
    },
    create: { tenantId: actor.tenantId, employeeId: a.e.id, ...data },
    update: data,
    select: { id: true },
  });
  await audit(tx, actor, "personal.bank_updated", a.e.id, { by: a.level });
  return { ok: true, data: row };
}

export type Revealed =
  | { field: "ni"; niNumber: string }
  | {
      field: "bank";
      accountName: string;
      sortCode: string;
      accountNumber: string;
    };

/** Shows an NI number or bank details in full. Always audited. */
export async function reveal(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
  field: unknown,
  cipher: FieldCipher | null,
): Promise<Result<Revealed>> {
  const a = await accessTo(tx, actor, employeeId);
  if (!a || a.level === "emergency" || (field !== "ni" && field !== "bank"))
    return notFound;
  if (!cipher) return keyOff;
  const p = await tx.employeePersonal.findUnique({
    where: {
      tenantId_employeeId: { tenantId: actor.tenantId, employeeId: a.e.id },
    },
    select: { niCiphertext: true, bankCiphertext: true },
  });
  const stored = field === "ni" ? p?.niCiphertext : p?.bankCiphertext;
  if (!stored)
    return {
      ok: false,
      code: "not_found",
      message: "Nothing has been entered yet.",
    };
  const plain = cipher.decrypt(stored, ctx(actor.tenantId, a.e.id, field));
  if (plain === null)
    return {
      ok: false,
      code: "conflict",
      message:
        "These details can't be read with the current key. Ask the person to enter them again.",
    };
  await audit(tx, actor, "personal.revealed", a.e.id, { field, by: a.level });
  if (field === "ni") return { ok: true, data: { field, niNumber: plain } };
  const b = JSON.parse(plain) as {
    name: string;
    sortCode: string;
    accountNumber: string;
  };
  return {
    ok: true,
    data: {
      field,
      accountName: b.name,
      sortCode: b.sortCode,
      accountNumber: b.accountNumber,
    },
  };
}
