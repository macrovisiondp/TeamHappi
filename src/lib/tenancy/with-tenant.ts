import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db/create-client";

import { isTenantContext, type TenantContext } from "./internal";
import { txBudget } from "./tx-budget";

export type TenantTx = Prisma.TransactionClient;

/**
 * The only way to run tenant-scoped queries.
 *
 * Opens a transaction and sets `app.tenant_id`, `app.user_id` and
 * `app.context_token` with set_config(..., is_local => true) before running
 * `fn`. The settings vanish at COMMIT/ROLLBACK, so a pooled connection never
 * carries one tenant's context to the next request (safe with Neon's
 * transaction-mode pooler). The database honours the context only while the
 * token matches the current transaction, so a session-level value can never
 * apply to a later transaction.
 *
 * Time limits come from tx-budget.ts (10 s per transaction, 5 s to acquire one);
 * callers cannot change them.
 *
 * This is the only file allowed to call set_config (enforced by ESLint and by
 * tests/unit/static-guards.test.ts). Queries inside `fn` must use `tx`.
 */
export async function withTenant<T>(
  client: DbClient,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!isTenantContext(ctx))
    throw new Error("withTenant requires a TenantContext");
  return client.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                                set_config('app.user_id', ${ctx.userId ?? ""}, true),
                                set_config('app.context_token', app.context_token(), true)`;
      return fn(tx);
    },
    { maxWait: txBudget().maxWaitMs, timeout: txBudget().timeoutMs },
  );
}
