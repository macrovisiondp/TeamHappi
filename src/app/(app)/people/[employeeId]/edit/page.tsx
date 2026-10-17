import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PermissionDenied } from "@/components/states/states";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { fullName } from "@/features/people/directory";
import { EmployeeForm } from "@/features/setup/forms";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { can, formOptions, getPerson } from "@/lib/workspace";

export const metadata: Metadata = { title: "Edit person" };
export const instant = false;

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function EditPersonPage({
  params,
}: PageProps<"/people/[employeeId]/edit">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { employeeId } = await params;
  const person = await getPerson(ws, employeeId);
  if (!person) notFound();
  const allowed =
    person.primarySiteId === null
      ? ws.grants.get("employee.manage") === "all"
      : can(ws.grants, "employee.manage", person.primarySiteId);
  if (!allowed)
    return (
      <PermissionDenied message="Your role doesn't include editing this person's record." />
    );

  const options = await formOptions(ws, "employee.manage");
  // Keep the current site in the list even if it's now inactive.
  const sites =
    person.primarySiteId &&
    !options.sites.some((s) => s.id === person.primarySiteId)
      ? [
          {
            id: person.primarySiteId,
            name: person.primarySite?.name ?? "Current site",
          },
          ...options.sites,
        ]
      : options.sites;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/people/${person.id}`}
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to {fullName(person)}
      </Link>
      <PageHeader title={`Edit ${fullName(person)}`} />
      <Card>
        <EmployeeForm
          sites={sites}
          teams={options.teams}
          employee={{
            id: person.id,
            givenName: person.givenName,
            familyName: person.familyName,
            preferredName: person.preferredName,
            jobTitle: person.jobTitle,
            employeeNumber: person.employeeNumber,
            email: person.email,
            phoneNumber: person.phoneNumber,
            status: person.status,
            startDate: iso(person.startDate),
            endDate: iso(person.endDate),
            primarySiteId: person.primarySiteId,
            teamIds: person.teams.map((t) => t.teamId),
          }}
        />
      </Card>
    </div>
  );
}
