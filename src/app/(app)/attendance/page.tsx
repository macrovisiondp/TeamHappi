import { Clock } from "lucide-react";
import type { Metadata } from "next";

import { PlannedModule } from "@/components/states/states";

export const metadata: Metadata = { title: "Attendance" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function AttendancePage() {
  return (
    <PlannedModule
      title="Attendance"
      icon={Clock}
      summary="See who has clocked in, compare planned and actual hours, and approve timesheets."
      milestone="Milestone 4+ (Release 1 modules)"
      features={[
        "Clock in and out, including on poor connections",
        "Planned versus actual hours",
        "Manager review and approval of timesheets",
        "Approved hours handed to payroll in a later release",
      ]}
    />
  );
}
