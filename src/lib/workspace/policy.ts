// Pure workspace rules (M4.1): which organisation a request runs in, and what
// the member may see there. No I/O, so every branch is unit-tested.

import type { PermissionCode } from "@/lib/permissions/catalogue";

export type TenantStatus = "active" | "suspended" | "offboarding" | "closed";
export type MembershipStatus = "invited" | "active" | "suspended" | "left";

/** One row of app.my_memberships(): the signed-in user's own memberships. */
export interface MembershipSummary {
  tenantId: string;
  name: string;
  slug: string;
  tenantStatus: TenantStatus;
  membershipStatus: MembershipStatus;
}

export function isUsable(m: MembershipSummary): boolean {
  return m.tenantStatus === "active" && m.membershipStatus === "active";
}

export type OrganisationChoice =
  | { kind: "selected"; tenantId: string }
  | { kind: "choose"; options: MembershipSummary[] }
  | { kind: "none"; blocked: MembershipSummary[] };

/**
 * Picks the organisation for this request. `preferredTenantId` comes from a
 * browser cookie and is UNTRUSTED: it is honoured only if it names one of the
 * user's usable memberships; otherwise it is ignored.
 */
export function chooseOrganisation(
  memberships: readonly MembershipSummary[],
  preferredTenantId: string | undefined,
): OrganisationChoice {
  const usable = memberships.filter(isUsable);
  const preferred = usable.find((m) => m.tenantId === preferredTenantId);
  if (preferred) return { kind: "selected", tenantId: preferred.tenantId };
  if (usable.length === 1)
    return { kind: "selected", tenantId: usable[0]!.tenantId };
  if (usable.length > 1) return { kind: "choose", options: usable };
  return { kind: "none", blocked: memberships.filter((m) => !isUsable(m)) };
}

/** "all" = organisation-wide; otherwise the set of site ids in scope. */
export type Scope = "all" | ReadonlySet<string>;
export type Grants = ReadonlyMap<PermissionCode, Scope>;

export interface AssignmentGrant {
  siteId: string | null;
  permissions: readonly string[];
}

/** Combines role assignments into a scope per permission. */
export function grantsFrom(assignments: readonly AssignmentGrant[]): Grants {
  const grants = new Map<PermissionCode, Scope>();
  for (const a of assignments) {
    for (const code of a.permissions as PermissionCode[]) {
      const current = grants.get(code);
      if (current === "all") continue;
      if (a.siteId === null) {
        grants.set(code, "all");
      } else {
        grants.set(code, new Set([...(current ?? []), a.siteId]));
      }
    }
  }
  return grants;
}

export function scopeOf(grants: Grants, code: PermissionCode): Scope | null {
  return grants.get(code) ?? null;
}

/** Whether the permission applies organisation-wide or to `siteId`. */
export function can(
  grants: Grants,
  code: PermissionCode,
  siteId?: string | null,
): boolean {
  const scope = grants.get(code);
  if (!scope) return false;
  if (scope === "all") return true;
  return siteId != null && scope.has(siteId);
}

/** Site ids for a query filter, or null for "no restriction". */
export function siteIdsFor(scope: Scope): string[] | null {
  return scope === "all" ? null : [...scope];
}
