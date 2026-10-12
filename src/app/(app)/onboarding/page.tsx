import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";

import { PlannedModule } from "@/components/states/states";

export const metadata: Metadata = { title: "Onboarding" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function OnboardingPage() {
  return (
    <PlannedModule
      title="Onboarding"
      icon={ClipboardCheck}
      summary="Get new starters ready for their first shift, with every required step recorded."
      milestone="Milestone 4+ (Release 1 modules)"
      features={[
        "Onboarding checklists per role and site",
        "Record employer-led right-to-work checks, evidence and expiry dates",
        "Collect documents securely",
        "Mark a worker cleared to work only when required steps are complete",
      ]}
    />
  );
}
