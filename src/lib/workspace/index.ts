import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { withTenant, type TenantTx } from "@/lib/tenancy";

import * as mutations from "./mutations";
import * as queries from "./queries";
import { listMemberships, resolveWorkspace, type Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export {
  can,
  isUsable,
  scopeOf,
  siteIdsFor,
  type Grants,
  type MembershipSummary,
  type Scope,
} from "./policy";
export type { Workspace, WorkspaceUser } from "./resolve";

/** Holds only a PREFERENCE (a tenant id); every request re-validates it. */
export const ORGANISATION_COOKIE = "teamhappi.org";

/**
 * The workspace for this request, or null when signed out. Memoised per
 * request only, so suspensions, revoked memberships and expired sessions take
 * effect on the next request.
 */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!serverEnv().DATABASE_URL) return { kind: "none", user, blocked: [] };
  const preferred = (await cookies()).get(ORGANISATION_COOKIE)?.value;
  return resolveWorkspace(
    db(),
    { userId: user.userId, name: user.name, email: user.email },
    preferred,
  );
});

/** Runs tenant-scoped queries for a ready workspace (RLS applies). */
export function withWorkspace<T>(
  ws: Extract<Workspace, { kind: "ready" }>,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(db(), ws.ctx, fn);
}

/** Usable memberships of the signed-in user (for the switcher action). */
export async function myUsableTenantIds(userId: string): Promise<Set<string>> {
  if (!serverEnv().DATABASE_URL) return new Set();
  const memberships = await listMemberships(db(), userId);
  return new Set(
    memberships
      .filter(
        (m) => m.tenantStatus === "active" && m.membershipStatus === "active",
      )
      .map((m) => m.tenantId),
  );
}

export function organisationCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(serverEnv().APP_URL).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  };
}

/** Dashboard figures within the member's scope. */
export const dashboardData = (ws: Ready) => queries.dashboardData(db(), ws);
/** People within the member's employee.view scope, or null without it. */
export const listPeople = (ws: Ready) => queries.listPeople(db(), ws);
/** One person within scope, or null (respond 404). */
export const getPerson = (ws: Ready, employeeId: string) =>
  queries.getPerson(db(), ws, employeeId);
export type { DashboardData, PersonRow, SiteRow, TeamRow } from "./queries";
export type { MutationResult } from "./mutations";

export const organisationSettings = (ws: Ready) =>
  queries.organisationSettings(db(), ws);
export const listSites = (ws: Ready) => queries.listSites(db(), ws);
export const getSite = (ws: Ready, id: string) => queries.getSite(db(), ws, id);
export const listTeams = (ws: Ready) => queries.listTeams(db(), ws);
export const getTeam = (ws: Ready, id: string) => queries.getTeam(db(), ws, id);
export const formOptions = (
  ws: Ready,
  code: "site.manage" | "team.manage" | "employee.manage",
) => queries.formOptions(db(), ws, code);

/** Writes (M4.2). Each checks permissions and site scope itself. */
export const mutate = {
  updateOrganisation: (ws: Ready, raw: unknown) =>
    mutations.updateOrganisation(db(), ws, raw),
  createSite: (ws: Ready, raw: unknown) => mutations.createSite(db(), ws, raw),
  updateSite: (ws: Ready, id: string, raw: unknown) =>
    mutations.updateSite(db(), ws, id, raw),
  setSiteStatus: (ws: Ready, id: string, status: "active" | "archived") =>
    mutations.setSiteStatus(db(), ws, id, status),
  createTeam: (ws: Ready, raw: unknown) => mutations.createTeam(db(), ws, raw),
  updateTeam: (ws: Ready, id: string, raw: unknown) =>
    mutations.updateTeam(db(), ws, id, raw),
  setTeamArchived: (ws: Ready, id: string, archived: boolean) =>
    mutations.setTeamArchived(db(), ws, id, archived),
  createEmployee: (ws: Ready, raw: unknown) =>
    mutations.createEmployee(db(), ws, raw),
  updateEmployee: (ws: Ready, id: string, raw: unknown) =>
    mutations.updateEmployee(db(), ws, id, raw),
};
