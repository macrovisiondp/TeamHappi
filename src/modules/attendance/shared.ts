// Shared helpers for the attendance module (M11.1).

import type { TenantTx } from "@/lib/tenancy";
import type * as rota from "@/modules/rota";

import { DEFAULT_LIMITS, type Limits } from "./policy";

export type Actor = rota.Actor;

export type Result<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict";
      message: string;
      fieldErrors?: Record<string, string>;
    };

export const uniqueViolation = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "P2002";

/** An audit event with ids and codes only (never reasons or notes). */
export async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetId: string,
  detail: Record<string, string | number | null> = {},
  targetType: "time_entry" | "attendance_settings" | "timesheet" = "time_entry",
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

/** The organisation's flag limits (defaults until someone saves them). */
export async function limitsFor(tx: TenantTx, actor: Actor): Promise<Limits> {
  const row = await tx.attendanceSettings.findUnique({
    where: { tenantId: actor.tenantId },
    select: { toleranceMinutes: true, missedClockOutHours: true },
  });
  return row ?? DEFAULT_LIMITS;
}
