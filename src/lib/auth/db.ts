import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import { PrismaClient } from "@/generated/prisma/client";

export type AuthDbClient = PrismaClient;

// Connects as teamhappi_auth (ADR-0008): identity tables only. Never use this
// client for tenant data; it has no grants there.
export function createAuthDbClient(config: string | PoolConfig): AuthDbClient {
  return new PrismaClient({ adapter: new PrismaPg(config) });
}
