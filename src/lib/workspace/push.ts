// Push notifications for shift changes (M12).
//
// A member turns on alerts on a device; the browser's push subscription is
// stored for that membership in that organisation (RLS). When a manager's
// change affects someone's PUBLISHED shifts, each of their devices gets a short,
// generic alert with no names, times or places, so nothing private shows on a
// locked phone. Endpoints and keys are never logged. Sending happens outside
// any database transaction; endpoints the push service reports as gone (404 or
// 410) are marked removed.

import type { DbClient } from "@/lib/db/create-client";
import { withTenant } from "@/lib/tenancy";
import * as rota from "@/modules/rota";

import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export interface PushKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one push message; resolves to the push service's HTTP status. */
export type PushSender = (
  sub: StoredSubscription,
  payload: string,
) => Promise<number>;

const B64URL = (min: number, max: number) =>
  new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`);

/** Validates a subscription sent by the browser (untrusted). */
export function parseSubscription(raw: unknown): StoredSubscription | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  const endpoint = r.endpoint;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    endpoint.length > 1000 ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    !B64URL(80, 100).test(p256dh) ||
    !B64URL(16, 30).test(auth)
  )
    return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return { endpoint: url.toString(), p256dh, auth };
}

/** Turns alerts on for this device and the signed-in member. */
export async function saveSubscription(
  client: DbClient,
  ws: Ready,
  raw: unknown,
): Promise<{ ok: boolean }> {
  const sub = parseSubscription(raw);
  if (!sub) return { ok: false };
  return withTenant(client, ws.ctx, async (tx) => {
    const live = await tx.pushSubscription.findFirst({
      where: {
        tenantId: ws.tenant.id,
        endpoint: sub.endpoint,
        removedAt: null,
      },
      select: { id: true, membershipId: true },
    });
    if (live?.membershipId === ws.membershipId) return { ok: true };
    // The device was someone else's here (a shared phone): theirs stops.
    if (live)
      await tx.pushSubscription.update({
        where: { tenantId_id: { tenantId: ws.tenant.id, id: live.id } },
        data: { removedAt: new Date() },
        select: { id: true },
      });
    await tx.pushSubscription.create({
      data: { tenantId: ws.tenant.id, membershipId: ws.membershipId, ...sub },
      select: { id: true },
    });
    return { ok: true };
  });
}

/** Turns alerts off for this device (only the member's own). */
export async function removeSubscription(
  client: DbClient,
  ws: Ready,
  endpoint: unknown,
): Promise<{ ok: boolean }> {
  if (typeof endpoint !== "string" || endpoint.length > 1000)
    return { ok: false };
  return withTenant(client, ws.ctx, async (tx) => {
    const r = await tx.pushSubscription.updateMany({
      where: {
        tenantId: ws.tenant.id,
        membershipId: ws.membershipId,
        endpoint,
        removedAt: null,
      },
      data: { removedAt: new Date() },
    });
    return { ok: r.count > 0 };
  });
}

/** Whether this member has alerts on for any device here. */
export async function hasSubscription(client: DbClient, ws: Ready) {
  return withTenant(client, ws.ctx, (tx) =>
    tx.pushSubscription
      .count({
        where: {
          tenantId: ws.tenant.id,
          membershipId: ws.membershipId,
          removedAt: null,
        },
      })
      .then((n) => n > 0),
  );
}

export const SHIFT_ALERT = JSON.stringify({
  title: "TeamHappi",
  body: "Your shifts have changed. Tap to see them.",
  url: "/rota/me",
});

/**
 * Alerts everyone whose published shifts changed at or after `since` (set a
 * few seconds before the change, to allow for clock differences). Returns how
 * many devices were sent to and how many were removed as gone.
 */
export async function notifyShiftChanges(
  client: DbClient,
  ws: Ready,
  since: Date,
  send: PushSender,
): Promise<{ sent: number; removed: number }> {
  const subs = await withTenant(client, ws.ctx, async (tx) => {
    const members = await rota.membersWithChangedShifts(
      tx,
      ws.tenant.id,
      since,
    );
    if (!members.length) return [];
    return tx.pushSubscription.findMany({
      where: {
        tenantId: ws.tenant.id,
        membershipId: { in: members },
        removedAt: null,
      },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  });
  if (!subs.length) return { sent: 0, removed: 0 };
  const sent: string[] = [];
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        const status = await send(s, SHIFT_ALERT);
        if (status === 404 || status === 410) gone.push(s.id);
        else if (status >= 200 && status < 300) sent.push(s.id);
      } catch {
        // One device failing never stops the others; nothing is logged about it.
      }
    }),
  );
  const now = new Date();
  await withTenant(client, ws.ctx, async (tx) => {
    if (sent.length)
      await tx.pushSubscription.updateMany({
        where: { tenantId: ws.tenant.id, id: { in: sent } },
        data: { lastSentAt: now },
      });
    if (gone.length)
      await tx.pushSubscription.updateMany({
        where: { tenantId: ws.tenant.id, id: { in: gone } },
        data: { removedAt: now },
      });
  });
  return { sent: sent.length, removed: gone.length };
}
