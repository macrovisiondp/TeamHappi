import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db/create-client";

import { isTenantContext, type TenantContext } from "./internal";

export type TenantTx = Prisma.TransactionClient;

export interface WithTenantOptions {
  /** Maximum transaction duration in ms (default 10 s). */
  timeoutMs?: number;
}

/**
 * The only way to run tenant-scoped queries.
 *
 * Opens a transaction, sets `app.tenant_id` (and `app.user_id`) with
 * set_config(..., is_local => true), then runs `fn`. The settings vanish at
 * COMMIT/ROLLBACK, so a pooled connection never carries one tenant's context to
 * the next request (safe with Neon's transaction-mode pooler). Queries inside
 * `fn` must use the `tx` client they are given.
 */
export async function withTenant<T>(
  client: DbClient,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  if (!isTenantContext(ctx))
    throw new Error("withTenant requires a TenantContext");
  return client.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                                set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      return fn(tx);
    },
    { maxWait: 5_000, timeout: options.timeoutMs ?? 10_000 },
  );
}
