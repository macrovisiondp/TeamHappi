// Append-only platform audit trail (M5.1, ADR-0013). Written by the auth
// role; the database rejects UPDATE/DELETE/TRUNCATE. Details are metadata only:
// never codes, secrets, tokens or personal documents.

import { redact } from "@/integrations/core/redact";

import type { AuthDbClient } from "./db";

export type PlatformAuditAction =
  | "mfa.enrolment_started"
  | "mfa.enabled"
  | "mfa.verified"
  | "mfa.failed"
  | "mfa.locked"
  | "mfa.recovery_used"
  | "mfa.recovery_regenerated"
  | "mfa.reset"
  | "staff.granted"
  | "staff.updated"
  | "staff.suspended"
  | "staff.reactivated"
  | "staff.revoked"
  | "tenant.suspended"
  | "tenant.reactivated";

export interface PlatformAuditInput {
  action: PlatformAuditAction;
  actorUserId: string | null;
  targetUserId?: string | null;
  detail?: Record<string, string | number | boolean | null | string[]>;
}

type Tx = Pick<AuthDbClient, "platformAuditEvent">;

export async function recordPlatformEvent(
  db: Tx,
  input: PlatformAuditInput,
): Promise<void> {
  await db.platformAuditEvent.create({
    data: {
      action: input.action,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      targetType: input.targetUserId ? "user" : null,
      targetId: input.targetUserId ?? null,
      detail: redact(input.detail ?? {}),
    },
    select: { id: true },
  });
}

export interface PlatformAuditRow {
  id: string;
  occurredAt: Date;
  action: string;
  actor: string | null;
  target: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
}

/** Newest first. Actor and target are shown by name and email. */
export async function listPlatformEvents(
  db: AuthDbClient,
  limit = 100,
  target?: { type: string; id: string },
): Promise<PlatformAuditRow[]> {
  const events = await db.platformAuditEvent.findMany({
    where: target
      ? { targetType: target.type, targetId: target.id }
      : undefined,
    orderBy: { occurredAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
  const ids = [
    ...new Set(
      events.flatMap((e) => [e.actorUserId, e.targetUserId]).filter(Boolean),
    ),
  ] as string[];
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const label = (id: string | null) => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u ? `${u.name} <${u.email}>` : "Unknown user";
  };
  return events.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    action: e.action,
    actor: label(e.actorUserId),
    target: label(e.targetUserId),
    targetType: e.targetType,
    targetId: e.targetId,
    detail: (e.detail ?? {}) as Record<string, unknown>,
  }));
}
