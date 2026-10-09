import type { DbClient } from "@/lib/db/create-client";

import { isUuid, trustedTenantContext, type TenantContext } from "./internal";
import { withTenant } from "./with-tenant";

/**
 * Turns a (user, requested tenant) pair into a TenantContext, or null.
 *
 * `userId` must come from the server-side session; `tenantId` is the tenant the
 * user asked to work in and is treated as untrusted. The lookup runs under RLS
 * scoped to the requested tenant, so it can only find that tenant's rows. The
 * context is returned only if the tenant is active and the user holds an active
 * membership in it; every other case (malformed id, unknown tenant, other
 * tenant, suspended, left, invited) returns null and callers respond 404.
 */
export async function resolveTenantContext(
  client: DbClient,
  input: { userId: string; tenantId: string },
): Promise<TenantContext | null> {
  if (!isUuid(input.userId) || !isUuid(input.tenantId)) return null;
  const candidate = trustedTenantContext(input.tenantId, input.userId);

  const allowed = await withTenant(client, candidate, async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { status: true },
    });
    if (tenant?.status !== "active") return false;
    const membership = await tx.tenantMembership.findUnique({
      where: {
        tenantId_userId: { tenantId: input.tenantId, userId: input.userId },
      },
      select: { status: true },
    });
    return membership?.status === "active";
  });

  return allowed ? candidate : null;
}
