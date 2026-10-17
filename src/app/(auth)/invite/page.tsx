import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { InviteAccept } from "@/features/members/invite-accept";

export const metadata: Metadata = {
  title: "Join your team",
  // Invite pages are personal: keep them out of search engines.
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return (
    <Card className="gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          You&rsquo;ve been invited to TeamHappi
        </h1>
        <p className="text-sm text-muted-foreground">
          Check the details below, then join your organisation.
        </p>
      </div>
      <InviteAccept />
    </Card>
  );
}
