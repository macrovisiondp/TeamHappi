import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { getPlatformAccess } from "@/lib/platform-access";

import Loading from "../../(app)/loading";

export const instant = false;

// Every console page needs active platform staff WITH MFA verified in this
// session (within 12 hours). Set-up and verification live outside this group.
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <RequireMfa>{children}</RequireMfa>
    </Suspense>
  );
}

async function RequireMfa({ children }: { children: ReactNode }) {
  const access = await getPlatformAccess();
  if (access.kind === "enrol") redirect("/platform/mfa/setup");
  if (access.kind === "verify") redirect("/platform/mfa/verify");
  if (access.kind !== "staff") redirect("/sign-in?next=/platform");
  return children;
}
