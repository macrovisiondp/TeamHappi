import { UserPlus } from "lucide-react";
import type { Metadata } from "next";

import { PlannedModule } from "@/components/states/states";

export const metadata: Metadata = { title: "Recruitment" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function RecruitmentPage() {
  return (
    <PlannedModule
      title="Recruitment"
      icon={UserPlus}
      summary="Advertise roles, review applications and move candidates through interviews to an offer."
      milestone="Milestone 4+ (Release 1 modules)"
      features={[
        "Create and approve vacancies, publish to your careers page",
        "Track applications through screening, interview and offer",
        "Schedule interviews and collect interviewer feedback",
        "Convert a hired candidate into an employee record",
      ]}
    />
  );
}
