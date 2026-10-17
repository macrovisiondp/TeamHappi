import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { TeamForm } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formOptions } from "@/lib/workspace";

export const metadata: Metadata = { title: "Add a team" };
export const instant = false;

export default async function NewTeamPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (!ws.grants.has("team.manage"))
    return (
      <PermissionDenied message="Your role doesn't include managing teams." />
    );
  const { sites } = await formOptions(ws, "team.manage");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Add a team" description="Teams belong to one site." />
      {sites.length === 0 ? (
        <EmptyState icon={MapPin} title="Add a site first">
          <p>
            Teams belong to a site.{" "}
            <Link
              href="/settings/sites"
              className="font-semibold text-forest underline"
            >
              Go to sites
            </Link>
          </p>
        </EmptyState>
      ) : (
        <Card>
          <TeamForm sites={sites} />
        </Card>
      )}
    </div>
  );
}
