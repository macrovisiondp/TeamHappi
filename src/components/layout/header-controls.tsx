"use client";

import { Bell, ChevronDown, LogOut, Menu, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { DemoBadge } from "@/components/ui/misc";
import { DEMO_NOTIFICATIONS } from "@/features/demo/fixtures";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import { useDisclosure } from "./use-disclosure";

const iconButton =
  "relative grid size-11 place-items-center rounded-[10px] text-ink hover:bg-sage";

export function MobileNavButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(iconButton, "lg:hidden")}
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Navigation"
        placement="left"
      >
        <div className="flex flex-col gap-4">
          <Brand />
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </Dialog>
    </>
  );
}

/**
 * Display-only until M3.3: the active organisation will come from the server
 * session (validated membership). The browser never chooses a tenant.
 */
export function OrganisationSelector({
  organisation,
}: {
  organisation: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Organisation
      </label>
      <select
        id={id}
        disabled
        title="Switching organisation arrives with organisation sign-in (Milestone 3.3)"
        className="h-11 max-w-[16rem] min-w-0 truncate rounded-[10px] border border-line bg-surface px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-100"
      >
        <option>{organisation}</option>
      </select>
    </div>
  );
}

export function NotificationsMenu() {
  const { open, toggle, containerRef, triggerRef } = useDisclosure();
  const panelId = useId();
  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={iconButton}
        aria-label={`Notifications, ${DEMO_NOTIFICATIONS.length} demo items`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <Bell aria-hidden="true" className="size-5" />
        <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-forest px-1 text-[10px] leading-4 font-bold text-white">
          {DEMO_NOTIFICATIONS.length}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-pop"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Notifications</h2>
            <DemoBadge />
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {DEMO_NOTIFICATIONS.map((n) => (
              <li key={n.id} className="py-2.5 text-sm">
                <p>{n.text}</p>
                <p className="text-xs text-ink-muted">
                  {formatDate(n.at)}, {formatTime(n.at)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AccountMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const { open, toggle, containerRef, triggerRef } = useDisclosure();
  const panelId = useId();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
    } finally {
      router.replace("/sign-in");
      router.refresh();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex h-11 items-center gap-2 rounded-[10px] px-2 hover:bg-sage"
      >
        <span className="grid size-8 place-items-center rounded-full bg-forest text-white">
          <UserRound aria-hidden="true" className="size-4" />
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-semibold md:inline">
          {name}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 text-ink-muted" />
        <span className="sr-only">Account menu for {name}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-pop"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-ink-muted">{email}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex min-h-11 w-full items-center gap-2 rounded-[10px] px-3 text-sm font-medium hover:bg-sage disabled:opacity-60"
          >
            <LogOut aria-hidden="true" className="size-4" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
