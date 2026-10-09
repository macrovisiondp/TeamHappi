import { randomBytes } from "node:crypto";

import pg from "pg";
import { inject } from "vitest";

import { createDbClient, type DbClient } from "@/lib/db/create-client";
import { issuePlatformStaffActorForTests } from "@/platform/authz/internal";
import { createTenant } from "@/platform/tenancy/create-tenant";

export const urls = inject("db");

/** Prisma client connected as teamhappi_app (the real application role). */
export function appDb(max = 5): DbClient {
  return createDbClient({ connectionString: urls.appUrl, max });
}

/** Raw pg client as an arbitrary role. */
export async function withPg<T>(
  url: string,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Superuser connection for fixtures and inspection (bypasses RLS). */
export const admin = <T>(fn: (c: pg.Client) => Promise<T>) =>
  withPg(urls.adminUrl, fn);

const suffix = () => randomBytes(4).toString("hex");

/** Stand-in for a Milestone 3 platform-staff session (tests only). */
export const platformStaff = issuePlatformStaffActorForTests(
  "01900000-0000-7000-8000-000000000001",
  ["tenant.create"],
);

export async function createUser(name: string): Promise<string> {
  return admin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO "user" (name, email) VALUES ($1, $2) RETURNING id`,
      [name, `${name.toLowerCase()}-${suffix()}@example.test`],
    );
    return r.rows[0]!.id;
  });
}

export interface TenantFixture {
  tenantId: string;
  ownerUserId: string;
  siteId: string;
  teamId: string;
  employeeId: string;
  documentId: string;
  roleAssignmentId: string;
}

/** A tenant created through the real createTenant() path, plus synthetic records. */
export async function createTenantFixture(
  db: DbClient,
  label: string,
): Promise<TenantFixture> {
  const ownerUserId = await createUser(`${label}-owner`);
  const { tenant, membershipId } = await createTenant(db, platformStaff, {
    slug: `${label}-${suffix()}`,
    legalName: `${label} Hospitality Ltd`,
    ownerUserId,
  });
  const tenantId = tenant.id;

  return admin(async (c) => {
    const one = async (sql: string, params: unknown[]) =>
      (await c.query<{ id: string }>(sql, params)).rows[0]!.id;
    const siteId = await one(
      `INSERT INTO site (tenant_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, `S-${suffix()}`, `${label} Central`],
    );
    const teamId = await one(
      `INSERT INTO team (tenant_id, site_id, name) VALUES ($1, $2, 'Kitchen') RETURNING id`,
      [tenantId, siteId],
    );
    const employeeId = await one(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id)
       VALUES ($1, $2, 'Sam', $3, $4) RETURNING id`,
      [tenantId, `E-${suffix()}`, label, siteId],
    );
    await c.query(
      `INSERT INTO team_member (tenant_id, team_id, employee_id) VALUES ($1, $2, $3)`,
      [tenantId, teamId, employeeId],
    );
    const documentId = await one(
      `INSERT INTO document (tenant_id, owner_employee_id, doc_type, sensitivity, storage_key, mime_type, size_bytes)
       VALUES ($1, $2, 'cv', 'confidential', $3, 'application/pdf', 1024) RETURNING id`,
      [tenantId, employeeId, `tenants/${tenantId}/documents/${suffix()}`],
    );
    const roleAssignmentId = await one(
      `SELECT id FROM role_assignment WHERE tenant_id = $1 AND membership_id = $2`,
      [tenantId, membershipId],
    );
    return {
      tenantId,
      ownerUserId,
      siteId,
      teamId,
      employeeId,
      documentId,
      roleAssignmentId,
    };
  });
}
