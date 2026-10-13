import { Suspense, type ReactNode } from "react";

import { Brand } from "./brand";
import {
  MobileNavButton,
  NotificationsMenu,
  OrganisationSelector,
} from "./header-controls";
import type { NavSet } from "./nav";
import { SidebarNav } from "./sidebar-nav";

// Authenticated frame: sidebar on large screens, a top bar with a navigation
// drawer on smaller ones. `accountMenu` is rendered by the caller (it reads the
// session on the server). The platform variant is Macrovision's own console:
// it has its own navigation and no tenant selector or tenant notifications.
export function AppShell({
  children,
  accountMenu,
  organisation,
  navSet = "tenant",
}: {
  children: ReactNode;
  accountMenu?: ReactNode;
  organisation: string;
  navSet?: NavSet;
}) {
  const platform = navSet === "platform";
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-4">
          <Brand />
          <Suspense>
            <SidebarNav navSet={navSet} />
          </Suspense>
          <p className="mt-auto px-3 text-xs text-ink-muted">
            People first. Every shift.
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
          <div className="flex h-16 items-center gap-2 px-3 md:px-6">
            <Suspense>
              <MobileNavButton navSet={navSet} />
            </Suspense>
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-1 md:gap-2">
              {platform ? (
                <p className="hidden rounded-full bg-forest px-3 py-1 text-xs font-semibold text-white sm:block">
                  {organisation}
                </p>
              ) : (
                <>
                  <div className="hidden sm:block">
                    <OrganisationSelector organisation={organisation} />
                  </div>
                  <NotificationsMenu />
                </>
              )}
              {accountMenu}
            </div>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none md:px-8 md:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
