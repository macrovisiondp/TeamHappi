import { CalendarDays } from "lucide-react";
import Link from "next/link";

import { getWorkspace, rotaApi } from "@/lib/workspace";

/**
 * Header link (M10.2, D8): "2 shift updates" when the signed-in person's own
 * published shifts are new or changed since they last looked. Nothing otherwise.
 */
export async function ShiftUpdatesLink() {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return null;
  const updates = await rotaApi.myUpdates(ws);
  if (!updates) return null;
  return (
    <Link
      href="/rota/me"
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-3 text-sm font-semibold text-white"
    >
      <CalendarDays aria-hidden="true" className="size-4" />
      {updates}
      <span className="hidden sm:inline">
        {" "}
        shift update{updates === 1 ? "" : "s"}
      </span>
      <span className="sr-only sm:hidden">
        {" "}
        shift update{updates === 1 ? "" : "s"}
      </span>
    </Link>
  );
}
