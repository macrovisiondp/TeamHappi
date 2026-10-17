import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { withTenant, type TenantTx } from "@/lib/tenancy";

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
export type { DashboardData, PersonRow } from "./queries";
