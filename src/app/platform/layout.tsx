import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { AccountMenu } from "@/components/layout/header-controls";
import { Skeleton } from "@/components/ui/misc";
import { PLATFORM_ORGANISATION } from "@/features/platform/fixtures";
import { getCurrentUser } from "@/lib/auth";
import { getPlatformAccess } from "@/lib/platform-access";

import Loading from "../(app)/loading";

// Session-gated: renders per request (see (app)/layout.tsx).
export const instant = false;

// Macrovision Platform Admin. Separate from every tenant's area: its own
// navigation, no tenant selector and no tenant data. Access is decided on the
// server for every request from the platform_staff register (never an email
// address); anyone who isn't active platform staff gets a 404, so the console's
// existence is not confirmed to them. MFA is enforced by (console)/layout.tsx.
export default function PlatformLayout({ children }: LayoutProps<"/platform">) {
  return (
    <AppShell
      navSet="platform"
      organisation={PLATFORM_ORGANISATION}
      accountMenu={
        <Suspense fallback={<Skeleton className="h-11 w-24" />}>
          <PlatformAccountMenu />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <RequirePlatformStaff>{children}</RequirePlatformStaff>
      </Suspense>
    </AppShell>
  );
}

async function RequirePlatformStaff({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const access = await getPlatformAccess();
  if (access.kind === "none") notFound();
  return children;
}

async function PlatformAccountMenu() {
  const access = await getPlatformAccess();
  if (access.kind === "none") return null;
  return <AccountMenu name={access.viewer.name} email={access.viewer.email} />;
}
