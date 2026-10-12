import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";

import Loading from "./loading";

// Session-gated routes render per request and redirect signed-out visitors, so
// they opt out of instant-navigation prefetch validation (Next 16 guide:
// authentication with Cache Components).
export const instant = false;

// Every route in this group requires a signed-in, verified user. The session is
// validated on the server against the database on each request (no cache), so
// sign-out and revocation apply immediately. Tenant context is added in M3.3.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      userMenu={
        <Suspense>
          <UserMenu />
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

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="truncate" title={user.email}>
        Signed in as <span className="font-medium">{user.name}</span>
      </p>
      <SignOutButton />
    </div>
  );
}
