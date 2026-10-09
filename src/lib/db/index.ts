import "server-only";

import { serverEnv } from "@/lib/env";

import { createDbClient, type DbClient } from "./create-client";

export type { DbClient } from "./create-client";

const globalForDb = globalThis as unknown as { teamhappiDb?: DbClient };

// One pooled client per server instance (reused across hot reloads in dev).
// Business code must not query through this directly; use withTenant().
export function db(): DbClient {
  if (globalForDb.teamhappiDb) return globalForDb.teamhappiDb;
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const client = createDbClient(url);
  globalForDb.teamhappiDb = client;
  return client;
}
