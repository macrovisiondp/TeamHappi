import { GraduationCap } from "lucide-react";
import type { Metadata } from "next";

import { PlannedModule } from "@/components/states/states";

export const metadata: Metadata = { title: "Training" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function TrainingPage() {
  return (
    <PlannedModule
      title="Training"
      icon={GraduationCap}
      summary="Assign required training by role or site and track completion and renewals."
      milestone="Milestone 4+ (Release 1 modules)"
      features={[
        "Required training by role, site or person",
        "Completion, certificates and expiry tracking",
        "Renewal reminders",
        "Flag expired mandatory training when building the rota",
      ]}
    />
  );
}
