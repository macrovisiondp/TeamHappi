import { UserPlus } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { DEMO_EMPLOYEES, DEMO_SITES } from "@/features/demo/fixtures";
import { DEMO_STATUSES } from "@/features/people/directory";
import { PeopleDirectory } from "@/features/people/people-directory";

export const metadata: Metadata = { title: "People" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function PeoplePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        demo
        description="Everyone across your sites: roles, status and where they work."
        actions={
          <Button disabled disabledReason="Invitations arrive in Milestone 3.6">
            <UserPlus aria-hidden="true" />
            Invite person
          </Button>
        }
      />
      <Alert tone="demo" title="Demo staff directory">
        These people are fictional. The live directory will show your
        organisation&apos;s employee records once the People module is connected
        (Milestone 3.7).
      </Alert>
      <PeopleDirectory
        employees={DEMO_EMPLOYEES}
        sites={DEMO_SITES}
        statuses={DEMO_STATUSES}
        hrefBase="/demo/people"
        caption="Staff directory (demo data)"
      />
    </div>
  );
}
