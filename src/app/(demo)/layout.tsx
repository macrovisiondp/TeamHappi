import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AccountMenu } from "@/components/layout/header-controls";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/misc";
import { getCurrentUser } from "@/lib/auth";
import { getPlatformAccess } from "@/lib/platform-access";

import Loading from "../(app)/loading";

export const instant = false;

// The labelled demo workspace: synthetic data only, no database queries, its
// own navigation. Signed-in users only (it is a product preview, not public).
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      navSet="demo"
      organisation={
        <p className="flex items-center gap-1.5 rounded-full border border-demo-border bg-demo px-3 py-1 text-xs font-semibold text-demo-fg">
          <FlaskConical aria-hidden="true" className="size-3.5" />
          Demo workspace
        </p>
      }
      accountMenu={
        <Suspense fallback={<Skeleton className="h-11 w-24" />}>
          <UserAccountMenu />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <RequireUser>
          <div className="flex flex-col gap-6">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
              You&apos;re exploring a demo workspace with fictional data.
              <Link
                href="/dashboard"
                className="font-semibold text-forest underline-offset-4 hover:underline"
              >
                Go to your workspace
              </Link>
            </p>
            {children}
          </div>
        </RequireUser>
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
  const platform = await getPlatformAccess();
  return (
    <AccountMenu
      name={user.name}
      email={user.email}
      links={
        platform.kind === "none"
          ? []
          : [{ href: "/platform", label: "Platform Admin" }]
      }
    />
  );
}
