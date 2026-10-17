import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AccountMenu } from "@/components/layout/header-controls";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/misc";
import { OrganisationSwitcher } from "@/features/workspace/components";
import { getCurrentUser } from "@/lib/auth";

import Loading from "./loading";

// Session-gated routes render per request and redirect signed-out visitors, so
// they opt out of instant-navigation prefetch validation (Next 16 guide:
// authentication with Cache Components).
export const instant = false;

// Every route in this group requires a signed-in, verified user. The session is
// validated on the server against the database on each request (no cache), so
// sign-out and revocation apply immediately. The organisation (workspace) is
// resolved on the server from the session for every request (M4.1); pages
// query only through it.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      organisation={
        <Suspense fallback={<Skeleton className="h-11 w-40" />}>
          <OrganisationSwitcher />
        </Suspense>
      }
      accountMenu={
        <Suspense fallback={<Skeleton className="h-11 w-24" />}>
          <UserAccountMenu />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <RequireUser>{children}</RequireUser>
      </Suspense>
    </AppShell>
  );
}

async function RequireUser({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return children;
}

async function UserAccountMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <AccountMenu name={user.name} email={user.email} />;
}
