import { Plus, UsersRound } from "lucide-react";
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
import { listTeams } from "@/lib/workspace";

export const metadata: Metadata = { title: "Teams" };
export const instant = false;

export default async function TeamsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const teams = await listTeams(ws);
  if (!teams)
    return (
      <PermissionDenied message="Your role doesn't include viewing sites and teams." />
    );
  const canAdd = ws.grants.has("team.manage");
  const add = canAdd ? (
    <Button asChild>
      <Link href="/settings/teams/new">
        <Plus aria-hidden="true" />
        Add team
      </Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Teams"
        description="Groups of people at each site."
        actions={add}
      />
      {teams.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No teams yet"
          action={add ?? undefined}
        >
          Teams such as Kitchen or Front of house help organise people at each
          site. Add a site first if you haven&apos;t already.
        </EmptyState>
      ) : (
        <Table caption="Teams">
          <thead>
            <tr>
              <Th>Team</Th>
              <Th>Site</Th>
              <Th>Status</Th>
              <Th className="text-right">Members</Th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link
                    href={`/settings/teams/${t.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {t.name}
                  </Link>
                </Td>
                <Td>{t.siteName}</Td>
                <Td>
                  <Badge
                    tone={t.archived || !t.siteActive ? "neutral" : "success"}
                  >
                    {t.archived
                      ? "Inactive"
                      : t.siteActive
                        ? "Active"
                        : "Site inactive"}
                  </Badge>
                </Td>
                <Td className="text-right">{t.members}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
