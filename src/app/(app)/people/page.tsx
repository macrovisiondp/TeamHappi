import { UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { PermissionDenied } from "@/components/states/states";
import { EMPLOYMENT_STATUSES } from "@/features/people/directory";
import { PeopleDirectory } from "@/features/people/people-directory";
import { listPeople } from "@/lib/workspace";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";

export const metadata: Metadata = { title: "People" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function PeoplePage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const result = await listPeople(ws);
  if (!result)
    return (
      <PermissionDenied message="Your role doesn't include viewing employee records. Ask an administrator in your organisation if you need access." />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        description={`Employee records at ${ws.tenant.name}.`}
        actions={
          ws.grants.has("employee.manage") ? (
            <Button asChild>
              <Link href="/people/new">
                <UserPlus aria-hidden="true" />
                Add person
              </Link>
            </Button>
          ) : undefined
        }
      />
      {result.people.length ? (
        <PeopleDirectory
          employees={result.people}
          sites={result.sites}
          statuses={EMPLOYMENT_STATUSES}
          hrefBase="/people"
          caption={`Staff directory, ${ws.tenant.name}`}
        />
      ) : (
        <EmptyState
          icon={Users}
          title="No people yet"
          action={
            ws.grants.has("employee.manage") ? (
              <Button asChild>
                <Link href="/people/new">
                  <UserPlus aria-hidden="true" />
                  Add your first person
                </Link>
              </Button>
            ) : undefined
          }
        >
          Employee records you can see will appear here once they&apos;re added.
        </EmptyState>
      )}
    </div>
  );
}
