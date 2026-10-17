import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { MfaSetup } from "@/features/platform-admin/mfa";
import { getPlatformAccess } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Set up MFA · Platform" };
export const instant = false;

export default async function MfaSetupPage() {
  const access = await getPlatformAccess();
  if (access.kind === "verify") redirect("/platform/mfa/verify");
  if (access.kind === "staff") redirect("/platform/dashboard");
  // "none" is already a 404 in the platform layout.
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Set up multi-factor authentication"
        description="Platform Admin can change every client organisation, so it needs a second step at sign-in: a code from an authenticator app on your phone."
      />
      <Card>
        <MfaSetup />
      </Card>
    </div>
  );
}
