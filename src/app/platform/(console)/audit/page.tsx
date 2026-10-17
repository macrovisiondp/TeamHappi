import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { platformAudit } from "@/lib/platform-access";
import { ScrollText } from "lucide-react";

export const metadata: Metadata = { title: "Audit log · Platform" };
export const instant = false;

const ACTION_LABEL: Record<string, string> = {
  "mfa.enrolment_started": "Started MFA set-up",
  "mfa.enabled": "Turned on MFA",
  "mfa.verified": "Verified with MFA",
  "mfa.failed": "Entered an incorrect MFA code",
  "mfa.locked": "MFA locked after repeated failures",
  "mfa.recovery_used": "Used a recovery code",
  "mfa.recovery_regenerated": "Created new recovery codes",
  "mfa.reset": "Reset MFA",
  "staff.granted": "Added platform staff",
  "staff.updated": "Changed staff permissions",
  "staff.suspended": "Suspended staff access",
  "staff.reactivated": "Reactivated staff access",
  "staff.revoked": "Revoked staff access",
  "tenant.suspended": "Suspended an organisation",
  "tenant.reactivated": "Reactivated an organisation",
  "integration.configured": "Saved integration settings",
  "integration.validated": "Tested an integration",
  "integration.activated": "Made an integration active",
  "ai.controls_changed": "Changed AI controls",
};

export default async function PlatformAuditPage() {
  const events = await platformAudit(200);
  if (!events)
    return (
      <PermissionDenied message="Viewing the audit log needs the “View the platform audit log” permission." />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform audit log"
        description="An append-only record of MFA and platform administration events. It never contains codes, passwords or secrets."
      />
      {events.length === 0 ? (
        <EmptyState icon={ScrollText} title="No events yet" />
      ) : (
        <Table caption="Platform audit events, newest first">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Event</Th>
              <Th>By</Th>
              <Th>About</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">
                  {formatDate(e.occurredAt)}, {formatTime(e.occurredAt)}
                </Td>
                <Td>
                  {ACTION_LABEL[e.action] ?? e.action}
                  <p className="text-xs text-ink-muted">{e.action}</p>
                </Td>
                <Td className="break-all">{e.actor ?? "System"}</Td>
                <Td className="break-all">
                  {e.targetType === "tenant" && e.targetId ? (
                    <a
                      href={`/platform/organisations/${e.targetId}`}
                      className="font-semibold text-forest underline"
                    >
                      Organisation
                    </a>
                  ) : (
                    (e.target ?? "—")
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
