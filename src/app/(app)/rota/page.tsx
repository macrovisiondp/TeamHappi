import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";

import { PlannedModule } from "@/components/states/states";

export const metadata: Metadata = { title: "Rota" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function RotaPage() {
  return (
    <PlannedModule
      title="Rota"
      icon={CalendarDays}
      summary="Plan weekly rotas across sites and teams, then publish them to staff."
      milestone="Milestone 4+ (Release 1 modules)"
      features={[
        "Weekly rota calendar by site and team",
        "Availability, shift changes and swaps where enabled",
        "Publish rotas and notify staff of changes",
        "Warn when someone isn't cleared or trained for a shift",
      ]}
    />
  );
}
