import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { MfaVerify } from "@/features/platform-admin/mfa";
import { formatTime } from "@/lib/format";
import { getPlatformAccess } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Verify · Platform" };
export const instant = false;

export default async function MfaVerifyPage({
  searchParams,
}: PageProps<"/platform/mfa/verify">) {
  const access = await getPlatformAccess();
  if (access.kind === "enrol") redirect("/platform/mfa/setup");
  const { next } = await searchParams;
  const lockedUntil = access.kind === "verify" ? access.lockedUntil : null;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Confirm it's you"
        description={
          access.kind === "staff"
            ? "This action needs a fresh check with your authenticator app."
            : "Enter the code from your authenticator app to open Platform Admin."
        }
      />
      {lockedUntil ? (
        <Alert tone="warning" title="MFA is temporarily locked" role="alert">
          Too many incorrect codes. Try again after {formatTime(lockedUntil)}.
        </Alert>
      ) : null}
      <Card>
        <MfaVerify next={typeof next === "string" ? next : undefined} />
      </Card>
    </div>
  );
}
