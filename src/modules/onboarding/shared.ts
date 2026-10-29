// Helpers shared by the onboarding and compliance services (internal to the
// module; not exported from index.ts except the Result type).

import { z } from "zod";

import { isUuid, type TenantTx } from "@/lib/tenancy";

import type { Actor } from "./policy";

export type Result<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict";
      message: string;
      fieldErrors?: Record<string, string>;
    };

export const forbidden = (message = "Your role doesn't allow this change.") =>
  ({ ok: false, code: "forbidden", message }) as const;
export const notFound = (what: string) =>
  ({
    ok: false,
    code: "not_found",
    message: `That ${what} couldn't be found.`,
  }) as const;
export const conflict = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;
export const invalid = (
  fieldErrors: Record<string, string>,
  message = "Check the highlighted fields.",
) => ({ ok: false, code: "invalid", message, fieldErrors }) as const;

export const zodErrors = (e: z.ZodError) =>
  Object.fromEntries(
    e.issues.map((i) => [String(i.path[0] ?? "form"), i.message]),
  );

export const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date | null) =>
  d ? d.toISOString().slice(0, 10) : null;

export async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType:
    | "onboarding_template"
    | "onboarding_case"
    | "onboarding_task"
    | "onboarding_document"
    | "rtw_check"
    | "employee",
  targetId: string | null,
  detail: Record<string, string | number | boolean | null> = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType,
      targetId,
      detail,
    },
    select: { id: true },
  });
}

export const uniqueViolation = (e: unknown) =>
  // Prisma's unique-constraint error code (the module can't import the client).
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "P2002";

/** Active members (who can own a case or a task, or have done a check). */
export async function assignableMembers(tx: TenantTx, actor: Actor) {
  const memberships = await tx.tenantMembership.findMany({
    where: { tenantId: actor.tenantId, status: "active" },
    select: { id: true, userId: true },
  });
  const users = await tx.user.findMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return memberships
    .map((m) => ({ id: m.id, name: names.get(m.userId) ?? "Member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** null = not given; false = not an active member of this organisation. */
export async function activeMember(
  tx: TenantTx,
  actor: Actor,
  membershipId: unknown,
) {
  if (
    membershipId === null ||
    membershipId === undefined ||
    membershipId === ""
  )
    return null;
  if (typeof membershipId !== "string" || !isUuid(membershipId)) return false;
  const m = await tx.tenantMembership.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: membershipId } },
    select: { status: true },
  });
  return m?.status === "active" ? membershipId : false;
}

/** Display names for user ids (who completed, signed off, recorded). */
export async function userNames(tx: TenantTx, ids: readonly (string | null)[]) {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  const users = unique.length
    ? await tx.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, name: true },
      })
    : [];
  return new Map(users.map((u) => [u.id, u.name]));
}
