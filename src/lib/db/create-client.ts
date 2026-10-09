import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import { PrismaClient } from "@/generated/prisma/client";

export type DbClient = PrismaClient;

// The application always connects as teamhappi_app (NOBYPASSRLS). Tenant
// context is applied per transaction by withTenant(), never per connection.
export function createDbClient(config: string | PoolConfig): DbClient {
  return new PrismaClient({ adapter: new PrismaPg(config) });
}
