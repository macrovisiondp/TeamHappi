// Creates a real organisation (tenant) with its standard roles and makes an
// existing, verified sign-in account its owner. Run it yourself, from the
// TeamHappi folder:
//
//   node scripts/create-organisation.mjs --name "Joemis Kitchen" --owner you@example.com
//        (shows what it would do; changes nothing)
//   node scripts/create-organisation.mjs --name "Joemis Kitchen" --owner you@example.com --yes
//        (creates it, in one transaction)
//
// Mirrors createTenant() (src/platform/tenancy/create-tenant.ts): tenant, the
// six system roles with their permissions, an active owner membership and an
// organisation-wide owner role assignment. tests/unit/create-organisation-script.test.ts
// fails if the roles here drift from src/lib/permissions/catalogue.ts.
//
// Uses DATABASE_MIGRATION_URL (owner role) from .env.local and refuses any
// host other than localhost or the approved Neon dev endpoint. This is the
// interim path until Platform Admin can create organisations (M3.5).

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALL = [
  "tenant.settings.manage",
  "site.view",
  "site.manage",
  "team.manage",
  "member.invite",
  "role.assign",
  "role.manage",
  "employee.view",
  "employee.manage",
  "onboarding.view",
  "onboarding.manage",
  "onboarding.template.manage",
  "onboarding.signoff",
  "rtw.view",
  "rtw.record",
];

export const SCRIPT_SYSTEM_ROLES = [
  { key: "owner", name: "Tenant owner", permissions: ALL },
  { key: "admin", name: "Tenant administrator", permissions: ALL },
  {
    key: "hr_manager",
    name: "HR manager",
    permissions: [
      "site.view",
      "employee.view",
      "employee.manage",
      "onboarding.view",
      "onboarding.manage",
      "onboarding.template.manage",
      "onboarding.signoff",
      "rtw.view",
      "rtw.record",
    ],
  },
  { key: "recruiter", name: "Recruiter", permissions: ["site.view"] },
  {
    key: "site_manager",
    name: "Site manager",
    permissions: [
      "site.view",
      "team.manage",
      "employee.view",
      "onboarding.view",
      "onboarding.manage",
    ],
  },
  { key: "worker", name: "Worker", permissions: [] },
];

export function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

const ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "ep-ancient-shape-zan162ud.c-2.eu-west-2.aws.neon.tech",
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { default: pg } = await import("pg");
  const name = arg("name")?.trim();
  const ownerEmail = arg("owner")?.trim().toLowerCase();
  const slug = arg("slug") ?? (name ? slugify(name) : "");
  const apply = process.argv.includes("--yes");
  if (!name || name.length > 200 || !ownerEmail) {
    console.error(
      'Usage: node scripts/create-organisation.mjs --name "Organisation name" --owner email [--slug slug] [--yes]',
    );
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
    console.error(`"${slug}" is not a valid slug; pass --slug.`);
    process.exit(1);
  }

  const url =
    process.env.DATABASE_MIGRATION_URL ??
    (existsSync(".env.local")
      ? readFileSync(".env.local", "utf8")
          .match(/^DATABASE_MIGRATION_URL=(.*)$/m)?.[1]
          ?.trim()
      : undefined);
  if (!url) {
    console.error(
      "DATABASE_MIGRATION_URL is missing (run from the TeamHappi folder).",
    );
    process.exit(1);
  }
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.includes(host)) {
    console.error(`Refusing to write to ${host}.`);
    process.exit(1);
  }

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const owner = (
      await c.query(
        `SELECT id, name, email_verified FROM "user" WHERE email = $1`,
        [ownerEmail],
      )
    ).rows[0];
    if (!owner) throw new Error(`No sign-in account uses ${ownerEmail}.`);
    if (!owner.email_verified)
      throw new Error(`${ownerEmail} has not verified its email address.`);
    const taken = await c.query(`SELECT 1 FROM tenant WHERE slug = $1`, [slug]);
    if (taken.rowCount)
      throw new Error(`An organisation already uses the slug "${slug}".`);

    console.log(
      `${apply ? "Creating" : "Would create"} "${name}" (slug ${slug}) on ${host}, owner ${owner.name} <${ownerEmail}>, with roles: ${SCRIPT_SYSTEM_ROLES.map((r) => r.name).join(", ")}.`,
    );
    if (!apply) {
      console.log("Nothing changed. Add --yes to create it.");
      return;
    }

    await c.query("BEGIN");
    try {
      const tenantId = (
        await c.query(
          `INSERT INTO tenant (slug, legal_name) VALUES ($1, $2) RETURNING id`,
          [slug, name],
        )
      ).rows[0].id;
      let ownerRoleId;
      for (const role of SCRIPT_SYSTEM_ROLES) {
        const roleId = (
          await c.query(
            `INSERT INTO role (tenant_id, key, name, is_system) VALUES ($1, $2, $3, true) RETURNING id`,
            [tenantId, role.key, role.name],
          )
        ).rows[0].id;
        if (role.key === "owner") ownerRoleId = roleId;
        for (const code of role.permissions)
          await c.query(
            `INSERT INTO role_permission (tenant_id, role_id, permission_code) VALUES ($1, $2, $3)`,
            [tenantId, roleId, code],
          );
      }
      const membershipId = (
        await c.query(
          `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
          [tenantId, owner.id],
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO role_assignment (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)`,
        [tenantId, membershipId, ownerRoleId],
      );
      await c.query("COMMIT");
      console.log(
        `Done. Sign in as ${ownerEmail} to open the ${name} workspace.`,
      );
    } catch (error) {
      await c.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error(`Nothing was changed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
