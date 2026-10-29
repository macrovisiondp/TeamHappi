import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { OnboardingTabs, RTW_STATE } from "@/features/onboarding/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Right to work" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function RightToWorkListPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  // Restricted (it shows who has time-limited permission): rtw.view only, audited.
  const data = await onboardingApi.rtwFollowUps(ws);
  if (!data)
    return (
      <PermissionDenied message="Only owners, administrators and HR managers can see right-to-work records." />
    );
  const canTemplates = ws.grants.get("onboarding.template.manage") === "all";
  const person = (p: (typeof data.attention)[number]) => (
    <>
      <Link
        href={`/people/${p.employeeId}/right-to-work`}
        prefetch={false}
        className="font-semibold underline-offset-4 hover:underline"
      >
        {p.name}
      </Link>
      {p.jobTitle ? (
        <p className="text-xs text-ink-muted">{p.jobTitle}</p>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Onboarding"
        description="Right-to-work follow-ups for people currently employed or about to start. Restricted, and every view is recorded."
      />
      <OnboardingTabs
        current="right-to-work"
        showTemplates={canTemplates}
        showRightToWork
      />

      <section
        aria-labelledby="attention-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="attention-heading" className="text-lg font-semibold">
          Needs attention
        </h2>
        {data.attention.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nothing due">
            No follow-up checks are due in the next 60 days, and no recorded
            problems.
          </EmptyState>
        ) : (
          <Table caption="Right-to-work checks needing attention">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>State</Th>
                <Th>Follow-up due by</Th>
                <Th>Permission ends</Th>
              </tr>
            </thead>
            <tbody>
              {data.attention.map((p) => (
                <tr key={p.employeeId}>
                  <Td>{person(p)}</Td>
                  <Td>
                    <Badge tone={RTW_STATE[p.state].tone}>
                      {RTW_STATE[p.state].label}
                    </Badge>
                  </Td>
                  <Td>{p.followUpDueOn ? formatDate(p.followUpDueOn) : "–"}</Td>
                  <Td>
                    {p.permissionEndsOn ? formatDate(p.permissionEndsOn) : "–"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="none-heading" className="flex flex-col gap-3">
        <h2 id="none-heading" className="text-lg font-semibold">
          No check recorded
        </h2>
        {data.unrecorded.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Everyone employed or about to start has a check recorded.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              If you checked these people before using TeamHappi, record those
              checks too, so follow-ups aren&rsquo;t missed.
            </p>
            <Table caption="People with no right-to-work check recorded">
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Employment</Th>
                </tr>
              </thead>
              <tbody>
                {data.unrecorded.map((p) => (
                  <tr key={p.employeeId}>
                    <Td>{person(p)}</Td>
                    <Td>
                      {p.employmentStatus === "pending"
                        ? "Not started yet"
                        : "Employed"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </section>
    </div>
  );
}
