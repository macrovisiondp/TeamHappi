import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { SiteForm } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";

export const metadata: Metadata = { title: "Add a site" };
export const instant = false;

export default async function NewSitePage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (ws.grants.get("site.manage") !== "all")
    return (
      <PermissionDenied message="Only organisation-wide site managers can add sites." />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add a site"
        description="A location where your team works."
      />
      <Card>
        <SiteForm defaultTimezone={ws.tenant.timezone} />
      </Card>
    </div>
  );
}
