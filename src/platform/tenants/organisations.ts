// Client organisation management for Platform Admin (M5.2, ADR-0009).
//
// Runs as teamhappi_platform. Reads the tenant registry and per-organisation
// COUNTS (app.platform_tenant_summaries); never employee, site, team or
// document details. Status changes need a PlatformStaffActor holding
// "tenant.suspend" (which requires MFA within 15 minutes) and are written
// together with their audit event in one transaction.

import type { PlatformStaffActor } from "@/platform/authz/internal";
import { assertPlatformGrant } from "@/platform/authz/internal";
import type { PlatformDbClient } from "@/platform/db";

export type TenantStatus = "active" | "suspended" | "offboarding" | "closed";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";

export interface OrganisationSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  plan: string | null;
  createdAt: Date;
  activeSites: number;
  archivedSites: number;
  activeMembers: number;
  people: number;
  owners: { name: string; email: string | null }[];
}

interface SummaryRow {
  tenant_id: string;
  active_sites: number;
  archived_sites: number;
  active_members: number;
  people: number;
  owner_names: string[];
  owner_emails: (string | null)[];
}

async function summaries(
  db: PlatformDbClient,
): Promise<Map<string, SummaryRow>> {
  const rows = await db.$queryRaw<SummaryRow[]>`
    SELECT tenant_id::text, active_sites, archived_sites, active_members, people,
           owner_names, owner_emails
    FROM app.platform_tenant_summaries()`;
  return new Map(rows.map((r) => [r.tenant_id, r]));
}

const tenantSelect = {
  id: true,
  legalName: true,
  slug: true,
  status: true,
  timezone: true,
  subscriptionStatus: true,
  trialEndsAt: true,
  plan: true,
  createdAt: true,
} as const;

function toSummary(
  t: {
    id: string;
    legalName: string;
    slug: string;
    status: TenantStatus;
    timezone: string;
    subscriptionStatus: SubscriptionStatus;
    trialEndsAt: Date | null;
    plan: string | null;
    createdAt: Date;
  },
  s: SummaryRow | undefined,
): OrganisationSummary {
  return {
    id: t.id,
    name: t.legalName,
    slug: t.slug,
    status: t.status,
    timezone: t.timezone,
    subscriptionStatus: t.subscriptionStatus,
    trialEndsAt: t.trialEndsAt,
    plan: t.plan,
    createdAt: t.createdAt,
    activeSites: s?.active_sites ?? 0,
    archivedSites: s?.archived_sites ?? 0,
    activeMembers: s?.active_members ?? 0,
    people: s?.people ?? 0,
    owners: (s?.owner_names ?? []).map((name, i) => ({
      name,
      email: s?.owner_emails[i] ?? null,
    })),
  };
}

/** Every organisation, optionally filtered by name or slug. */
export async function listOrganisations(
  db: PlatformDbClient,
  query?: string,
): Promise<OrganisationSummary[]> {
  const q = query?.trim().slice(0, 100);
  const tenants = await db.tenant.findMany({
    where: q
      ? {
          OR: [
            { legalName: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
          ],
        }
      : undefined,
    select: tenantSelect,
    orderBy: [{ legalName: "asc" }],
    take: 500,
  });
  const counts = await summaries(db);
  return tenants.map((t) => toSummary(t, counts.get(t.id)));
}

export async function getOrganisation(
  db: PlatformDbClient,
  tenantId: string,
): Promise<OrganisationSummary | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return null;
  const t = await db.tenant.findUnique({
    where: { id: tenantId },
    select: tenantSelect,
  });
  if (!t) return null;
  return toSummary(t, (await summaries(db)).get(t.id));
}

export type StatusChangeResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "invalid" | "conflict"; message: string };

/**
 * Suspends or reactivates an organisation. Only active <-> suspended:
 * offboarding and closing are separate, later procedures. Members lose (or
 * regain) access on their next request, because every request re-checks the
 * organisation's status.
 */
export async function setOrganisationStatus(
  db: PlatformDbClient,
  actor: PlatformStaffActor,
  tenantId: string,
  next: "active" | "suspended",
  reason: string,
): Promise<StatusChangeResult> {
  assertPlatformGrant(actor, "tenant.suspend");
  const why = reason.trim();
  if (next === "suspended" && (why.length < 5 || why.length > 300))
    return {
      ok: false,
      code: "invalid",
      message: "Give a short reason (5–300 characters).",
    };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId))
    return {
      ok: false,
      code: "not_found",
      message: "That organisation couldn't be found.",
    };

  return db.$transaction(async (tx) => {
    const current = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, legalName: true },
    });
    if (!current)
      return {
        ok: false,
        code: "not_found",
        message: "That organisation couldn't be found.",
      } as const;
    const from = current.status;
    if (from === next)
      return {
        ok: false,
        code: "conflict",
        message:
          next === "active"
            ? "It's already active."
            : "It's already suspended.",
      } as const;
    if (from !== "active" && from !== "suspended")
      return {
        ok: false,
        code: "conflict",
        message: `Organisations that are ${from} can't be changed here.`,
      } as const;
    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: next },
      select: { id: true },
    });
    await tx.platformAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        action:
          next === "suspended" ? "tenant.suspended" : "tenant.reactivated",
        targetType: "tenant",
        targetId: tenantId,
        detail: { from, to: next, ...(why ? { reason: why } : {}) },
      },
      select: { id: true },
    });
    return { ok: true } as const;
  });
}
