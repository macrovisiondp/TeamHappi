import { LifeBuoy } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";

// Help centre (M17): open to everyone, signed in or not, so staff can read it
// before their invitation arrives. Nothing here reads organisation data.
export default function HelpLayout({ children }: LayoutProps<"/help">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4">
          <Brand />
          <Link
            href="/help"
            className="ml-2 flex items-center gap-1.5 rounded-full bg-sage px-3 py-1 text-sm font-semibold text-forest"
          >
            <LifeBuoy aria-hidden="true" className="size-4" />
            Help
          </Link>
          <Link
            href="/dashboard"
            className="ml-auto text-sm font-semibold text-forest underline-offset-4 hover:underline"
          >
            Open TeamHappi
          </Link>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 outline-none"
      >
        {children}
      </main>
    </div>
  );
}
