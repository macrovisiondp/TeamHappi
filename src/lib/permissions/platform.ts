// Platform (Macrovision staff) grants. Separate from tenant permissions
// (catalogue.ts): no platform grant implies any tenant membership, and no tenant
// role implies a platform grant. Mirrors the CHECK constraint on
// platform_staff.grants (migration 20261021120000_platform_mfa).

export const PLATFORM_GRANTS = [
  "staff.manage",
  "tenant.view",
  "tenant.suspend",
  "tenant.create",
  "integrations.manage",
  "audit.view",
] as const;

export type PlatformGrantCode = (typeof PLATFORM_GRANTS)[number];

export const GRANT_LABELS: Record<PlatformGrantCode, string> = {
  "staff.manage": "Manage platform staff",
  "tenant.view": "View client organisations",
  "tenant.suspend": "Suspend and reactivate organisations",
  "tenant.create": "Create organisations",
  "integrations.manage": "Manage integrations",
  "audit.view": "View the platform audit log",
};

export function knownGrants(grants: readonly string[]): PlatformGrantCode[] {
  return [...new Set(grants)].filter((g): g is PlatformGrantCode =>
    (PLATFORM_GRANTS as readonly string[]).includes(g),
  );
}
