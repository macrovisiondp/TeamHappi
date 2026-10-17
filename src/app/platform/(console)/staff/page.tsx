import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { AddStaffForm, StaffMember } from "@/features/platform-admin/staff";
import { getPlatformAccess, staffAdmin } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Staff · Platform" };
export const instant = false;

export default async function StaffPage() {
  const access = await getPlatformAccess();
  const staff = await staffAdmin.list();
  if (!staff || access.kind !== "staff")
    return (
      <PermissionDenied message="Managing platform staff needs the “Manage platform staff” permission." />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform staff"
        description="Macrovision people who can use Platform Admin. Platform access is separate from any client organisation, and every change is audited."
      />
      <Card aria-labelledby="add-staff">
        <CardTitle id="add-staff">Add platform staff</CardTitle>
        <CardDescription>
          Only existing, verified TeamHappi accounts can be added. They must set
          up MFA before they can use Platform Admin. Changes need a recent MFA
          check.
        </CardDescription>
        <AddStaffForm />
      </Card>
      <section aria-labelledby="staff-list" className="flex flex-col gap-3">
        <h2 id="staff-list" className="text-lg font-semibold">
          Current staff
        </h2>
        {staff.map((m) => (
          <StaffMember
            key={m.userId}
            member={{
              userId: m.userId,
              name: m.name,
              email: m.email,
              status: m.status,
              grants: m.grants,
              mfaEnrolled: m.mfaEnrolled,
              isSelf: m.userId === access.viewer.userId,
            }}
          />
        ))}
      </section>
    </div>
  );
}
