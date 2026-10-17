import { MapPin, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { listSites } from "@/lib/workspace";

export const metadata: Metadata = { title: "Sites" };
export const instant = false;

export default async function SitesPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const sites = await listSites(ws);
  if (!sites)
    return (
      <PermissionDenied message="Your role doesn't include viewing sites." />
    );
  const canAdd = ws.grants.get("site.manage") === "all";
  const add = canAdd ? (
    <Button asChild>
      <Link href="/settings/sites/new">
        <Plus aria-hidden="true" />
        Add site
      </Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sites"
        description="The locations your organisation runs."
        actions={add}
      />
      {sites.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No sites yet"
          action={add ?? undefined}
        >
          {canAdd
            ? "Add your first site, such as your restaurant or kitchen. Teams and people are organised by site."
            : "Your organisation hasn't added any sites you can see yet."}
        </EmptyState>
      ) : (
        <Table caption="Sites">
          <thead>
            <tr>
              <Th>Site</Th>
              <Th>Location</Th>
              <Th>Status</Th>
              <Th className="text-right">Teams</Th>
              <Th className="text-right">Active staff</Th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <Td>
                  <Link
                    href={`/settings/sites/${s.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <p className="text-xs text-ink-muted">{s.code}</p>
                </Td>
                <Td>
                  {[s.town, s.postcode].filter(Boolean).join(", ") || "Not set"}
                </Td>
                <Td>
                  <Badge tone={s.status === "active" ? "success" : "neutral"}>
                    {s.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </Td>
                <Td className="text-right">{s.teams}</Td>
                <Td className="text-right">{s.activeStaff}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
