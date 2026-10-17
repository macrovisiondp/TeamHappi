import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EMPLOYMENT_STATUSES, fullName } from "@/features/people/directory";
import { TeamForm, TeamStatusChange } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { can, formOptions, getTeam } from "@/lib/workspace";

export const metadata: Metadata = { title: "Team" };
export const instant = false;

export default async function TeamPage({
  params,
}: PageProps<"/settings/teams/[teamId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { teamId } = await params;
  const team = await getTeam(ws, teamId);
  if (!team) notFound();
  const canManage = can(ws.grants, "team.manage", team.siteId);
  const { sites } = canManage
    ? await formOptions(ws, "team.manage")
    : { sites: [] };
  // Keep the current site selectable even if it's now inactive.
  const siteChoices = sites.some((s) => s.id === team.siteId)
    ? sites
    : [{ id: team.siteId, name: team.site.name }, ...sites];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/settings/teams"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All teams
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold md:text-3xl">{team.name}</h1>
          <p className="text-sm text-ink-muted">{team.site.name}</p>
          <Badge tone={team.archived ? "neutral" : "success"}>
            {team.archived ? "Inactive" : "Active"}
          </Badge>
        </div>
        {canManage ? (
          <TeamStatusChange
            id={team.id}
            name={team.name}
            archived={team.archived}
          />
        ) : null}
      </header>
      {canManage ? (
        <Card aria-labelledby="team-edit">
          <CardTitle id="team-edit">Team details</CardTitle>
          <TeamForm
            team={{ id: team.id, name: team.name, siteId: team.siteId }}
            sites={siteChoices}
          />
        </Card>
      ) : null}
      <Card aria-labelledby="team-members">
        <CardTitle id="team-members">Members</CardTitle>
        {team.members.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {team.members.map(({ employee: e }) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 py-2.5"
              >
                <span className="font-semibold">{fullName(e)}</span>
                <Badge tone={EMPLOYMENT_STATUSES[e.status]!.tone}>
                  {EMPLOYMENT_STATUSES[e.status]!.label}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            No one in this team yet. Add people to teams from their record in
            People.
          </p>
        )}
      </Card>
    </div>
  );
}
