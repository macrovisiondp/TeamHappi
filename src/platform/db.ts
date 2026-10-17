import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import { PrismaClient } from "@/generated/prisma/client";

export type PlatformDbClient = PrismaClient;

// Connects as teamhappi_platform (ADR-0009): the tenant registry (read; status
// only for writes), the platform audit trail and a counts-only summary
// function. It has NO access to sites, teams, employees, documents,
// memberships, sessions or MFA data. Only src/platform/** may create it.
export function createPlatformDbClient(
  config: string | PoolConfig,
): PlatformDbClient {
  return new PrismaClient({ adapter: new PrismaPg(config) });
}
