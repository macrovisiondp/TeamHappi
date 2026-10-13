import { Settings } from "lucide-react";
import type { Metadata } from "next";

import { PlannedModule } from "@/components/states/states";

export const metadata: Metadata = { title: "Settings" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function SettingsPage() {
  return (
    <PlannedModule
      title="Settings"
      icon={Settings}
      summary="Manage your organisation, sites, teams, users and invitations."
      milestone="Milestones 3.5–3.7"
      features={[
        "Organisation details and time zone",
        "Sites and teams",
        "Users, roles and site-level permissions",
        "Invitations, and multi-factor authentication for administrators",
      ]}
    />
  );
}
