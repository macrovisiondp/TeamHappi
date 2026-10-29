import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { InviteForm } from "@/features/members/members";
import { fullName } from "@/features/people/directory";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { getPerson, membersPage } from "@/lib/workspace";

export const metadata: Metadata = { title: "Invite to TeamHappi" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/**
 * M7.3: invite a person's record to TeamHappi. Accepting the invitation links
 * the record to the new login, so they can complete their own onboarding.
 */
export default async function InvitePersonPage({
  params,
}: PageProps<"/people/[employeeId]/invite">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { employeeId } = await params;
  const person = await getPerson(ws, employeeId);
  if (!person) notFound();
  const page = await membersPage(ws);
  if (!page?.canInvite)
    return (
      <PermissionDenied message="Only owners and administrators can invite people to TeamHappi." />
    );
  const name = fullName(person);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/people/${person.id}`}
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {name}
      </Link>
      <PageHeader
        title={`Invite ${name} to TeamHappi`}
        description="They'll get their own login, linked to this record, so they can see and complete their onboarding tasks on their phone. They never see right-to-work details or anyone else's records."
      />
      {person.membershipId ? (
        <Alert tone="info" title="Already linked">
          This record is already linked to a TeamHappi login.
        </Alert>
      ) : person.status === "left" ? (
        <Alert tone="info" title="This person has left">
          People who have left can&rsquo;t be invited from their record.
        </Alert>
      ) : (
        <Card aria-label="Invitation">
          <InviteForm
            roles={page.roles.filter((r) => r.grantable)}
            sites={page.sites}
            person={{
              employeeId: person.id,
              email: person.email,
              siteId: person.primarySiteId,
            }}
          />
        </Card>
      )}
    </div>
  );
}
