// Organisation setup writes (M4.2). Every function:
// - takes a READY workspace resolved from the server session (never a tenant id
//   from the browser) and runs inside withTenant(), so RLS confines it to that
//   organisation and composite foreign keys reject cross-tenant links;
// - checks the member's permission and site scope itself (not only the UI);
// - re-validates input with the shared schemas;
// - never hard-deletes core records (sites/teams are archived, employees "left").
// Audit events are added when the audit foundation (M3.2) exists.

import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db/create-client";
import type { PermissionCode } from "@/lib/permissions/catalogue";
import { isUuid, withTenant, type TenantTx } from "@/lib/tenancy";
import {
  employeeSchema,
  fieldErrors,
  organisationSchema,
  siteSchema,
  teamSchema,
  type FieldErrors,
} from "@/lib/validation/organisation";

import { can } from "./policy";
import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export type MutationResult<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict";
      message: string;
      fieldErrors?: FieldErrors;
    };

const forbidden = (message = "Your role doesn't allow this change.") =>
  ({ ok: false, code: "forbidden", message }) as const;
const notFound = (what: string) =>
  ({
    ok: false,
    code: "not_found",
    message: `That ${what} couldn't be found.`,
  }) as const;
const invalid = (
  errors: FieldErrors,
  message = "Check the highlighted fields.",
) => ({ ok: false, code: "invalid", message, fieldErrors: errors }) as const;
const conflict = (field: string, message: string) =>
  ({
    ok: false,
    code: "conflict",
    message,
    fieldErrors: { [field]: message },
  }) as const;

const isOrgWide = (ws: Ready, code: PermissionCode) =>
  ws.grants.get(code) === "all";

function uniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

const run = <T>(
  client: DbClient,
  ws: Ready,
  fn: (tx: TenantTx) => Promise<T>,
) => withTenant(client, ws.ctx, fn);

// --- Organisation -----------------------------------------------------------

export async function updateOrganisation(
  client: DbClient,
  ws: Ready,
  raw: unknown,
): Promise<MutationResult> {
  if (!isOrgWide(ws, "tenant.settings.manage")) return forbidden();
  const parsed = organisationSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  await run(client, ws, (tx) =>
    tx.tenant.update({
      where: { id: ws.tenant.id },
      data: { legalName: parsed.data.name, timezone: parsed.data.timezone },
      select: { id: true },
    }),
  );
  return { ok: true, data: { id: ws.tenant.id } };
}

// --- Sites ------------------------------------------------------------------

function codeFromName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  return base.length >= 2 ? base : `SITE${base}`;
}

export async function createSite(
  client: DbClient,
  ws: Ready,
  raw: unknown,
): Promise<MutationResult> {
  if (!isOrgWide(ws, "site.manage"))
    return forbidden("Only organisation-wide site managers can add sites.");
  const parsed = siteSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const { code, ...rest } = parsed.data;
  try {
    return await run(client, ws, async (tx) => {
      let finalCode = code;
      if (!finalCode) {
        const base = codeFromName(rest.name);
        const taken = new Set(
          (
            await tx.site.findMany({
              where: { code: { startsWith: base } },
              select: { code: true },
            })
          ).map((s) => s.code),
        );
        finalCode = base;
        for (let n = 2; taken.has(finalCode); n++) finalCode = `${base}-${n}`;
      }
      const site = await tx.site.create({
        data: { tenantId: ws.tenant.id, code: finalCode, ...rest },
        select: { id: true },
      });
      return { ok: true as const, data: site };
    });
  } catch (error) {
    if (uniqueViolation(error))
      return conflict("code", "Another site already uses this code");
    throw error;
  }
}

export async function updateSite(
  client: DbClient,
  ws: Ready,
  siteId: string,
  raw: unknown,
): Promise<MutationResult> {
  if (!isUuid(siteId)) return notFound("site");
  if (!can(ws.grants, "site.manage", siteId)) return forbidden();
  const parsed = siteSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  try {
    return await run(client, ws, async (tx) => {
      const existing = await tx.site.findUnique({
        where: { id: siteId },
        select: { code: true },
      });
      if (!existing) return notFound("site");
      await tx.site.update({
        where: { id: siteId },
        data: { ...parsed.data, code: parsed.data.code ?? existing.code },
        select: { id: true },
      });
      return { ok: true as const, data: { id: siteId } };
    });
  } catch (error) {
    if (uniqueViolation(error))
      return conflict("code", "Another site already uses this code");
    throw error;
  }
}

export async function setSiteStatus(
  client: DbClient,
  ws: Ready,
  siteId: string,
  status: "active" | "archived",
): Promise<MutationResult> {
  if (!isUuid(siteId)) return notFound("site");
  if (!can(ws.grants, "site.manage", siteId)) return forbidden();
  const updated = await run(client, ws, (tx) =>
    tx.site.updateMany({ where: { id: siteId }, data: { status } }),
  );
  return updated.count ? { ok: true, data: { id: siteId } } : notFound("site");
}

// --- Teams ------------------------------------------------------------------

async function activeSite(tx: TenantTx, siteId: string) {
  return tx.site.findFirst({
    where: { id: siteId, status: "active" },
    select: { id: true },
  });
}

export async function createTeam(
  client: DbClient,
  ws: Ready,
  raw: unknown,
): Promise<MutationResult> {
  const parsed = teamSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const { name, siteId } = parsed.data;
  if (!can(ws.grants, "team.manage", siteId))
    return forbidden("You can only add teams at sites you manage.");
  try {
    return await run(client, ws, async (tx) => {
      if (!(await activeSite(tx, siteId)))
        return invalid({ siteId: "Choose an active site" });
      const team = await tx.team.create({
        data: { tenantId: ws.tenant.id, siteId, name },
        select: { id: true },
      });
      return { ok: true as const, data: team };
    });
  } catch (error) {
    if (uniqueViolation(error))
      return conflict("name", "This site already has a team with that name");
    throw error;
  }
}

export async function updateTeam(
  client: DbClient,
  ws: Ready,
  teamId: string,
  raw: unknown,
): Promise<MutationResult> {
  if (!isUuid(teamId)) return notFound("team");
  const parsed = teamSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  try {
    return await run(client, ws, async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { siteId: true },
      });
      if (!team || !can(ws.grants, "site.view", team.siteId))
        return notFound("team");
      if (
        !can(ws.grants, "team.manage", team.siteId) ||
        !can(ws.grants, "team.manage", parsed.data.siteId)
      )
        return forbidden();
      if (
        parsed.data.siteId !== team.siteId &&
        !(await activeSite(tx, parsed.data.siteId))
      )
        return invalid({ siteId: "Choose an active site" });
      await tx.team.update({
        where: { id: teamId },
        data: parsed.data,
        select: { id: true },
      });
      return { ok: true as const, data: { id: teamId } };
    });
  } catch (error) {
    if (uniqueViolation(error))
      return conflict("name", "This site already has a team with that name");
    throw error;
  }
}

export async function setTeamArchived(
  client: DbClient,
  ws: Ready,
  teamId: string,
  archived: boolean,
): Promise<MutationResult> {
  if (!isUuid(teamId)) return notFound("team");
  return run(client, ws, async (tx) => {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      select: { siteId: true },
    });
    if (!team) return notFound("team");
    if (!can(ws.grants, "team.manage", team.siteId)) return forbidden();
    await tx.team.update({
      where: { id: teamId },
      data: { archived },
      select: { id: true },
    });
    return { ok: true as const, data: { id: teamId } };
  });
}

// --- Employees --------------------------------------------------------------

/** Next free "E0001"-style number in this organisation. */
async function nextEmployeeNumber(tx: TenantTx): Promise<string> {
  const rows = await tx.employee.findMany({
    where: { employeeNumber: { startsWith: "E" } },
    select: { employeeNumber: true },
  });
  const max = rows.reduce((m, r) => {
    const n = /^E(\d+)$/.exec(r.employeeNumber);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `E${String(max + 1).padStart(4, "0")}`;
}

const canManageAt = (ws: Ready, siteId: string | null) =>
  siteId === null
    ? isOrgWide(ws, "employee.manage")
    : can(ws.grants, "employee.manage", siteId);

/** Teams the member may assign: active, at an active site they manage people at. */
async function assignableTeams(
  tx: TenantTx,
  ws: Ready,
  teamIds: readonly string[],
) {
  if (!teamIds.length) return new Map<string, string>();
  const teams = await tx.team.findMany({
    where: {
      id: { in: [...teamIds] },
      archived: false,
      site: { status: "active" },
    },
    select: { id: true, siteId: true },
  });
  return new Map(
    teams
      .filter((t) => can(ws.grants, "employee.manage", t.siteId))
      .map((t) => [t.id, t.siteId]),
  );
}

const date = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);

export async function createEmployee(
  client: DbClient,
  ws: Ready,
  raw: unknown,
): Promise<MutationResult> {
  if (!ws.grants.has("employee.manage")) return forbidden();
  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const { teamIds, employeeNumber, startDate, endDate, ...fields } =
    parsed.data;
  if (!canManageAt(ws, fields.primarySiteId))
    return fields.primarySiteId
      ? forbidden("You can only add people at sites you manage.")
      : invalid({ primarySiteId: "Choose a site" });
  try {
    return await run(client, ws, async (tx) => {
      if (fields.primarySiteId && !(await activeSite(tx, fields.primarySiteId)))
        return invalid({ primarySiteId: "Choose an active site" });
      const teams = await assignableTeams(tx, ws, teamIds);
      if (teams.size !== new Set(teamIds).size)
        return invalid({ teamIds: "Choose teams at sites you manage" });
      const employee = await tx.employee.create({
        data: {
          tenantId: ws.tenant.id,
          employeeNumber: employeeNumber ?? (await nextEmployeeNumber(tx)),
          ...fields,
          startDate: date(startDate),
          endDate: date(endDate),
        },
        select: { id: true },
      });
      if (teams.size)
        await tx.teamMember.createMany({
          data: [...teams.keys()].map((teamId) => ({
            tenantId: ws.tenant.id,
            teamId,
            employeeId: employee.id,
          })),
        });
      return { ok: true as const, data: employee };
    });
  } catch (error) {
    if (uniqueViolation(error))
      return conflict(
        "employeeNumber",
        "Another person already has this employee number",
      );
    throw error;
  }
}

export async function updateEmployee(
  client: DbClient,
  ws: Ready,
  employeeId: string,
  raw: unknown,
): Promise<MutationResult> {
  if (!isUuid(employeeId)) return notFound("person");
  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const { teamIds, employeeNumber, startDate, endDate, ...fields } =
    parsed.data;
  try {
    return await run(client, ws, async (tx) => {
      const existing = await tx.employee.findUnique({
        where: { id: employeeId },
        select: {
          primarySiteId: true,
          employeeNumber: true,
          teams: {
            select: { teamId: true, team: { select: { siteId: true } } },
          },
        },
      });
      // Out of scope looks the same as missing.
      const visible =
        existing &&
        (existing.primarySiteId === null
          ? ws.grants.get("employee.view") === "all"
          : can(ws.grants, "employee.view", existing.primarySiteId));
      if (!existing || !visible) return notFound("person");
      if (!canManageAt(ws, existing.primarySiteId)) return forbidden();
      if (!canManageAt(ws, fields.primarySiteId))
        return fields.primarySiteId
          ? forbidden("You can only move people to sites you manage.")
          : invalid({ primarySiteId: "Choose a site" });
      if (
        fields.primarySiteId &&
        fields.primarySiteId !== existing.primarySiteId &&
        !(await activeSite(tx, fields.primarySiteId))
      )
        return invalid({ primarySiteId: "Choose an active site" });

      // Team changes touch only teams this member manages; others are kept.
      const desired = new Set(teamIds);
      const current = new Map(
        existing.teams.map((t) => [t.teamId, t.team.siteId]),
      );
      const toAdd = [...desired].filter((id) => !current.has(id));
      const addable = await assignableTeams(tx, ws, toAdd);
      if (addable.size !== toAdd.length)
        return invalid({ teamIds: "Choose teams at sites you manage" });
      const toRemove = [...current]
        .filter(
          ([id, siteId]) =>
            !desired.has(id) && can(ws.grants, "employee.manage", siteId),
        )
        .map(([id]) => id);

      await tx.employee.update({
        where: { id: employeeId },
        data: {
          ...fields,
          employeeNumber: employeeNumber ?? existing.employeeNumber,
          startDate: date(startDate),
          endDate: date(endDate),
        },
        select: { id: true },
      });
      if (toRemove.length)
        await tx.teamMember.deleteMany({
          where: { employeeId, teamId: { in: toRemove } },
        });
      if (addable.size)
        await tx.teamMember.createMany({
          data: [...addable.keys()].map((teamId) => ({
            tenantId: ws.tenant.id,
            teamId,
            employeeId,
          })),
        });
      return { ok: true as const, data: { id: employeeId } };
    });
  } catch (error) {
    if (uniqueViolation(error))
      return conflict(
        "employeeNumber",
        "Another person already has this employee number",
      );
    throw error;
  }
}
