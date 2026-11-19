// "Get started" (owner onboarding): the first steps for a new organisation,
// each ticked off from what's actually there, never by hand. Shown to members
// who can manage the organisation's settings (owners and admins) until every
// step is done. Counts only; no personal data.

import type { Route } from "next";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant } from "@/lib/tenancy";

import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export interface GetStartedStep {
  id: string;
  label: string;
  hint: string;
  href: Route;
  done: boolean;
}

export async function getStarted(
  client: DbClient,
  ws: Ready,
): Promise<GetStartedStep[] | null> {
  if (ws.grants.get("tenant.settings.manage") !== "all") return null;
  const t = ws.tenant.id;
  const c = await withTenant(client, ws.ctx, async (tx) => {
    const [tenant, sites, teams, people, members, invites, policies, rotas] =
      await Promise.all([
        tx.tenant.findUnique({
          where: { id: t },
          select: { createdAt: true, updatedAt: true },
        }),
        tx.site.count({ where: { tenantId: t, status: "active" } }),
        tx.team.count({ where: { tenantId: t } }),
        tx.employee.count({ where: { tenantId: t } }),
        tx.tenantMembership.count({ where: { tenantId: t, status: "active" } }),
        tx.invitation.count({ where: { tenantId: t } }),
        tx.signDocument.count({
          where: { tenantId: t, kind: "policy", archivedAt: null },
        }),
        tx.rotaWeek.count({ where: { tenantId: t, status: "published" } }),
      ]);
    return {
      detailsChecked:
        !!tenant &&
        tenant.updatedAt.getTime() - tenant.createdAt.getTime() > 1000,
      sites,
      teams,
      people,
      // More than the owner, or anyone invited.
      invited: members > 1 || invites > 1,
      policies,
      rotas,
    };
  });
  return [
    {
      id: "details",
      label: "Check your organisation's details",
      hint: "Name and time zone",
      href: "/settings",
      done: c.detailsChecked,
    },
    {
      id: "sites",
      label: "Add your sites",
      hint: "Each restaurant, bar or venue",
      href: "/settings/sites",
      done: c.sites > 0,
    },
    {
      id: "teams",
      label: "Add your teams",
      hint: "For example Front of House and Kitchen",
      href: "/settings/teams",
      done: c.teams > 0,
    },
    {
      id: "people",
      label: "Add your people",
      hint: "Staff records; logins come later",
      href: "/people/new",
      done: c.people > 0,
    },
    {
      id: "invite",
      label: "Invite your managers",
      hint: "So they can run their sites",
      href: "/settings/members",
      done: c.invited,
    },
    {
      id: "documents",
      label: "Upload documents to sign",
      hint: "Policies new starters sign on their phone",
      href: "/onboarding/documents",
      done: c.policies > 0,
    },
    {
      id: "rota",
      label: "Publish your first rota",
      hint: "Staff see their shifts on My shifts",
      href: "/rota",
      done: c.rotas > 0,
    },
  ];
}
