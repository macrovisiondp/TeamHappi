import { Building2, MapPin, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { OrganisationForm } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { organisationSettings } from "@/lib/workspace";

export const metadata: Metadata = { title: "Organisation settings" };
export const instant = false;

export default async function OrganisationSettingsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const org = await organisationSettings(ws);
  const canEdit = ws.grants.get("tenant.settings.manage") === "all";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Organisation"
        description="Your organisation's details. Status and web address are managed by TeamHappi."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active sites" value={org.counts.sites} icon={MapPin} />
        <StatCard
          label="Active teams"
          value={org.counts.teams}
          icon={UsersRound}
        />
        <StatCard
          label="People"
          value={org.counts.people}
          detail="Excluding leavers"
          icon={Building2}
        />
      </div>
      <Card aria-labelledby="org-details">
        <CardTitle id="org-details">Details</CardTitle>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">Status</dt>
            <dd>
              <Badge tone={org.status === "active" ? "success" : "warning"}>
                {org.status === "active" ? "Active" : org.status}
              </Badge>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">Web address name</dt>
            <dd className="font-medium">{org.slug}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">Time zone</dt>
            <dd className="font-medium">{org.timezone}</dd>
          </div>
        </dl>
        {canEdit ? (
          <OrganisationForm name={org.legalName} timezone={org.timezone} />
        ) : (
          <CardDescription>
            Only organisation owners and administrators can change these
            details.
          </CardDescription>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card aria-labelledby="next-sites">
          <CardTitle id="next-sites">Sites</CardTitle>
          <CardDescription>
            Each location where your team works.
          </CardDescription>
          <Link
            href="/settings/sites"
            className="font-semibold text-forest underline-offset-4 hover:underline"
          >
            Manage sites
          </Link>
        </Card>
        <Card aria-labelledby="next-teams">
          <CardTitle id="next-teams">Teams</CardTitle>
          <CardDescription>
            Groups such as Kitchen or Front of house, at each site.
          </CardDescription>
          <Link
            href="/settings/teams"
            className="font-semibold text-forest underline-offset-4 hover:underline"
          >
            Manage teams
          </Link>
        </Card>
      </div>
    </div>
  );
}
