import { Suspense, type ReactNode } from "react";

import { Brand } from "./brand";
import { MainNav } from "./main-nav";

// Signed-in application frame. On phones the sidebar becomes a top bar.
export function AppShell({
  children,
  userMenu,
}: {
  children: ReactNode;
  userMenu?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-b bg-card md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex flex-col gap-3 p-3 md:gap-6 md:p-4">
          <Brand />
          <Suspense>
            <MainNav />
          </Suspense>
          {userMenu ? <div className="md:mt-auto">{userMenu}</div> : null}
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-8">
        {children}
      </main>
    </div>
  );
}
