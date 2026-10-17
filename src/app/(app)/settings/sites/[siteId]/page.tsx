import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { SiteForm, SiteStatusChange } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { can, getSite } from "@/lib/workspace";

export const metadata: Metadata = { title: "Site" };
export const instant = false;

export default async function SitePage({
  params,
}: PageProps<"/settings/sites/[siteId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { siteId } = await params;
  const site = await getSite(ws, siteId);
  if (!site) notFound();
  const canManage = can(ws.grants, "site.manage", site.id);
  const active = site.status === "active";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/settings/sites"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All sites
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold md:text-3xl">{site.name}</h1>
          <Badge tone={active ? "success" : "neutral"}>
            {active ? "Active" : "Inactive"}
          </Badge>
        </div>
        {canManage ? (
          <SiteStatusChange id={site.id} name={site.name} active={active} />
        ) : null}
      </header>
      {canManage ? (
        <Card aria-labelledby="site-edit">
          <CardTitle id="site-edit">Site details</CardTitle>
          <SiteForm
            defaultTimezone={ws.tenant.timezone}
            site={{
              id: site.id,
              name: site.name,
              code: site.code,
              addressLine: site.addressLine,
              town: site.town,
              postcode: site.postcode,
              timezone: site.timezone,
            }}
          />
        </Card>
      ) : (
        <Card aria-labelledby="site-view">
          <CardTitle id="site-view">Site details</CardTitle>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Code", site.code],
                ["Address", site.addressLine ?? "Not set"],
                ["Town or city", site.town ?? "Not set"],
                ["Postcode", site.postcode ?? "Not set"],
                ["Time zone", site.timezone],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <Card aria-labelledby="site-teams">
        <CardTitle id="site-teams">Teams at this site</CardTitle>
        {site.teams.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {site.teams.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 py-2.5"
              >
                <Link
                  href={`/settings/teams/${t.id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {t.name}
                </Link>
                {t.archived ? <Badge>Inactive</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No teams yet.</p>
        )}
      </Card>
    </div>
  );
}
