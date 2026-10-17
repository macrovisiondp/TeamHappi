import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { EmployeeForm } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formOptions } from "@/lib/workspace";

export const metadata: Metadata = { title: "Add a person" };
export const instant = false;

export default async function NewPersonPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (!ws.grants.has("employee.manage"))
    return (
      <PermissionDenied message="Your role doesn't include adding people." />
    );
  const { sites, teams } = await formOptions(ws, "employee.manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add a person"
        description="Creates an employee record. It doesn't create a login or send an invitation."
      />
      {sites.length === 0 ? (
        <EmptyState icon={MapPin} title="Add a site first">
          <p>
            Every person belongs to a site.{" "}
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
          <EmployeeForm sites={sites} teams={teams} />
        </Card>
      )}
    </div>
  );
}
