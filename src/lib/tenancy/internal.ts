// Construction of TenantContext. Only the tenancy layer may import this file
// (enforced by ESLint): everywhere else a context must come from
// resolveTenantContext(), which proves an active membership first.

const TENANT_CONTEXT = Symbol("TenantContext");

export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly [TENANT_CONTEXT]: true;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function trustedTenantContext(
  tenantId: string,
  userId: string | null,
): TenantContext {
  if (!isUuid(tenantId)) throw new Error("Invalid tenant id");
  if (userId !== null && !isUuid(userId)) throw new Error("Invalid user id");
  return Object.freeze({ tenantId, userId, [TENANT_CONTEXT]: true as const });
}

export function isTenantContext(value: unknown): value is TenantContext {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TENANT_CONTEXT] === true &&
    isUuid((value as TenantContext).tenantId)
  );
}
