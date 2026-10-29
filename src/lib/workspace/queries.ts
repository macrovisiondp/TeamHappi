import type { DbClient } from "@/lib/db/create-client";
import { isUuid, withTenant } from "@/lib/tenancy";

import { scopeOf, siteIdsFor } from "./policy";
import type { Workspace } from "./resolve";

// Real workspace queries (M4.1). Every query runs inside withTenant (RLS:
// this organisation only) AND applies the member's site scope in the WHERE
// clause, so out-of-scope rows are never loaded.

type Ready = Extract<Workspace, { kind: "ready" }>;

/** Today's date in the organisation's time zone, as a UTC-midnight Date. */
function today(timezone: string, offsetDays = 0): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function employeeScope(ws: Ready) {
  const scope = scopeOf(ws.grants, "employee.view");
  if (!scope) return null;
  const siteIds = siteIdsFor(scope);
  return siteIds === null ? {} : { primarySiteId: { in: siteIds } };
}

function siteScope(ws: Ready) {
  const scope = scopeOf(ws.grants, "site.view");
  if (!scope) return null;
  const siteIds = siteIdsFor(scope);
  return siteIds === null ? {} : { id: { in: siteIds } };
}

export interface DashboardData {
  canViewPeople: boolean;
  canViewSites: boolean;
  counts: {
    sites: number;
    active: number;
    startingSoon: number;
    teams: number;
  };
  sites: { id: string; name: string; code: string; activeStaff: number }[];
  startingSoon: {
    id: string;
    name: string;
    startDate: Date | null;
    siteName: string | null;
  }[];
}

export async function dashboardData(
  client: DbClient,
  ws: Ready,
): Promise<DashboardData> {
  const people = employeeScope(ws);
  const sites = siteScope(ws);
  const from = today(ws.tenant.timezone);
  const until = today(ws.tenant.timezone, 30);

  return withTenant(client, ws.ctx, async (tx) => {
    const siteRows = sites
      ? await tx.site.findMany({
          where: { ...sites, status: "active" },
          select: { id: true, name: true, code: true },
          orderBy: { name: "asc" },
        })
      : [];
    const teams = sites
      ? await tx.team.count({
          where: {
            archived: false,
            site: { ...sites, status: "active" },
          },
        })
      : 0;

    const activeBySite = people
      ? await tx.employee.groupBy({
          by: ["primarySiteId"],
          where: { ...people, status: "active" },
          _count: { _all: true },
        })
      : [];
    const active = activeBySite.reduce((n, r) => n + r._count._all, 0);

    const soon = people
      ? await tx.employee.findMany({
          where: {
            ...people,
            status: "pending",
            startDate: { gte: from, lte: until },
          },
          select: {
            id: true,
            givenName: true,
            preferredName: true,
            familyName: true,
            startDate: true,
            primarySite: { select: { name: true } },
          },
          orderBy: [{ startDate: "asc" }, { familyName: "asc" }],
          take: 10,
        })
      : [];

    const staffBySite = new Map(
      activeBySite.map((r) => [r.primarySiteId, r._count._all]),
    );
    return {
      canViewPeople: people !== null,
      canViewSites: sites !== null,
      counts: {
        sites: siteRows.length,
        active,
        startingSoon: soon.length,
        teams,
      },
      sites: siteRows.map((s) => ({
        ...s,
        activeStaff: staffBySite.get(s.id) ?? 0,
      })),
      startingSoon: soon.map((e) => ({
        id: e.id,
        name: `${e.preferredName ?? e.givenName} ${e.familyName}`,
        startDate: e.startDate,
        siteName: e.primarySite?.name ?? null,
      })),
    };
  });
}

export interface PersonRow {
  id: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  preferredName: string | null;
  role: string | null;
  status: "pending" | "active" | "left";
  siteId: string | null;
  startDate: string | null;
}

/** People within the member's employee.view scope, or null without the permission. */
export async function listPeople(
  client: DbClient,
  ws: Ready,
): Promise<{
  people: PersonRow[];
  sites: { id: string; name: string }[];
} | null> {
  const people = employeeScope(ws);
  if (!people) return null;
  return withTenant(client, ws.ctx, async (tx) => {
    const rows = await tx.employee.findMany({
      where: people,
      select: {
        id: true,
        employeeNumber: true,
        givenName: true,
        familyName: true,
        preferredName: true,
        jobTitle: true,
        status: true,
        primarySiteId: true,
        startDate: true,
      },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      take: 2000,
    });
    const siteIds = [
      ...new Set(
        rows.map((r) => r.primarySiteId).filter((v): v is string => !!v),
      ),
    ];
    const sites = siteIds.length
      ? await tx.site.findMany({
          where: { id: { in: siteIds } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];
    return {
      people: rows.map((r) => ({
        id: r.id,
        employeeNumber: r.employeeNumber,
        givenName: r.givenName,
        familyName: r.familyName,
        preferredName: r.preferredName,
        role: r.jobTitle,
        status: r.status,
        siteId: r.primarySiteId,
        startDate: r.startDate?.toISOString() ?? null,
      })),
      sites,
    };
  });
}

/**
 * One person, or null when the id is malformed, belongs to another
 * organisation, or is outside the member's scope (callers respond 404).
 */
export async function getPerson(
  client: DbClient,
  ws: Ready,
  employeeId: string,
) {
  const people = employeeScope(ws);
  if (!people || !isUuid(employeeId)) return null;
  return withTenant(client, ws.ctx, (tx) =>
    tx.employee.findFirst({
      where: { AND: [{ id: employeeId }, people] },
      select: {
        id: true,
        employeeNumber: true,
        givenName: true,
        familyName: true,
        preferredName: true,
        email: true,
        phoneNumber: true,
        status: true,
        startDate: true,
        endDate: true,
        jobTitle: true,
        primarySiteId: true,
        // M7.3: whether the record is linked to a TeamHappi login.
        membershipId: true,
        primarySite: { select: { name: true } },
        teams: {
          select: {
            teamId: true,
            team: { select: { name: true, archived: true } },
          },
        },
      },
    }),
  );
}

// --- Organisation setup (M4.2) ---------------------------------------------

export async function organisationSettings(client: DbClient, ws: Ready) {
  return withTenant(client, ws.ctx, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ws.tenant.id },
      select: { legalName: true, slug: true, status: true, timezone: true },
    });
    const sites = await tx.site.count({ where: { status: "active" } });
    const teams = await tx.team.count({
      where: { archived: false, site: { status: "active" } },
    });
    const people = await tx.employee.count({
      where: { status: { not: "left" } },
    });
    return { ...tenant, counts: { sites, teams, people } };
  });
}

export interface SiteRow {
  id: string;
  name: string;
  code: string;
  town: string | null;
  postcode: string | null;
  addressLine: string | null;
  timezone: string;
  status: "active" | "archived";
  teams: number;
  activeStaff: number;
}

/** Sites in the member's site.view scope (active and archived), or null. */
export async function listSites(
  client: DbClient,
  ws: Ready,
): Promise<SiteRow[] | null> {
  const where = siteScope(ws);
  if (!where) return null;
  return withTenant(client, ws.ctx, async (tx) => {
    const sites = await tx.site.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        town: true,
        postcode: true,
        addressLine: true,
        timezone: true,
        status: true,
        _count: { select: { teams: { where: { archived: false } } } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    const staff = await tx.employee.groupBy({
      by: ["primarySiteId"],
      where: {
        status: "active",
        primarySiteId: { in: sites.map((s) => s.id) },
      },
      _count: { _all: true },
    });
    const bySite = new Map(staff.map((r) => [r.primarySiteId, r._count._all]));
    return sites.map(({ _count, ...s }) => ({
      ...s,
      teams: _count.teams,
      activeStaff: bySite.get(s.id) ?? 0,
    }));
  });
}

export async function getSite(client: DbClient, ws: Ready, siteId: string) {
  const where = siteScope(ws);
  if (!where || !isUuid(siteId)) return null;
  return withTenant(client, ws.ctx, (tx) =>
    tx.site.findFirst({
      where: { AND: [{ id: siteId }, where] },
      select: {
        id: true,
        name: true,
        code: true,
        addressLine: true,
        town: true,
        postcode: true,
        timezone: true,
        status: true,
        teams: {
          select: { id: true, name: true, archived: true },
          orderBy: { name: "asc" },
        },
      },
    }),
  );
}

export interface TeamRow {
  id: string;
  name: string;
  archived: boolean;
  siteId: string;
  siteName: string;
  siteActive: boolean;
  members: number;
}

/** Teams at sites in the member's site.view scope, or null. */
export async function listTeams(
  client: DbClient,
  ws: Ready,
): Promise<TeamRow[] | null> {
  const where = siteScope(ws);
  if (!where) return null;
  return withTenant(client, ws.ctx, async (tx) => {
    const teams = await tx.team.findMany({
      where: { site: where },
      select: {
        id: true,
        name: true,
        archived: true,
        siteId: true,
        site: { select: { name: true, status: true } },
        _count: { select: { members: true } },
      },
      orderBy: [
        { archived: "asc" },
        { site: { name: "asc" } },
        { name: "asc" },
      ],
    });
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      archived: t.archived,
      siteId: t.siteId,
      siteName: t.site.name,
      siteActive: t.site.status === "active",
      members: t._count.members,
    }));
  });
}

export async function getTeam(client: DbClient, ws: Ready, teamId: string) {
  const where = siteScope(ws);
  if (!where || !isUuid(teamId)) return null;
  return withTenant(client, ws.ctx, (tx) =>
    tx.team.findFirst({
      where: { id: teamId, site: where },
      select: {
        id: true,
        name: true,
        archived: true,
        siteId: true,
        site: { select: { name: true } },
        members: {
          select: {
            employee: {
              select: {
                id: true,
                givenName: true,
                preferredName: true,
                familyName: true,
                status: true,
              },
            },
          },
        },
      },
    }),
  );
}

/**
 * Active sites (and their active teams) where the member holds `code`, for
 * form choices. The server re-checks every submitted id regardless.
 */
export async function formOptions(
  client: DbClient,
  ws: Ready,
  code: "site.manage" | "team.manage" | "employee.manage",
) {
  const scope = scopeOf(ws.grants, code);
  if (!scope) return { sites: [], teams: [] };
  const siteIds = siteIdsFor(scope);
  const where = siteIds === null ? {} : { id: { in: siteIds } };
  return withTenant(client, ws.ctx, async (tx) => {
    const sites = await tx.site.findMany({
      where: { ...where, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const teams = await tx.team.findMany({
      where: { archived: false, siteId: { in: sites.map((s) => s.id) } },
      select: { id: true, name: true, siteId: true },
      orderBy: [{ name: "asc" }],
    });
    return { sites, teams };
  });
}
