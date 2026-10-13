"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isActive, NAV_SETS, type NavSet } from "./nav";

export function SidebarNav({
  onNavigate,
  navSet = "tenant",
}: {
  onNavigate?: () => void;
  navSet?: NavSet;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={navSet === "platform" ? "Platform" : "Main"}>
      <ul className="flex flex-col gap-1">
        {NAV_SETS[navSet].map(({ href, label, icon: Icon, stage, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-sage text-forest-strong"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                )}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span className="flex-1">{label}</span>
                {stage === "planned" ? (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                    Planned
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
