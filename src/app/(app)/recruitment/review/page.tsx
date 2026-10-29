import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { AnonymiseButton } from "@/features/recruitment/controls";
import { RecruitmentTabs } from "@/features/recruitment/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { recruitmentApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Candidate data review" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/** Decision D6: candidates past the review date, anonymised by hand (nothing automatic). */
export default async function RecruitmentReviewPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const data = await recruitmentApi.retention(ws);
  if (!data || "ok" in data)
    return (
      <PermissionDenied message="Reviewing candidate data needs an owner, administrator or HR manager." />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recruitment"
        description="Candidate data due for review under your retention period."
      />
      <RecruitmentTabs
        current="review"
        show={{ vacancies: true, review: true, settings: true }}
      />
      <Alert tone="info" title={`Review after ${data.retentionMonths} months`}>
        Candidates appear here {data.retentionMonths} months after their last
        application ended. Anonymising removes their name, contact details,
        notes and interview feedback, and keeps stage history for reporting.
        Nothing is removed automatically. Confirm the period with your adviser.
      </Alert>
      {data.due.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing due">
          No candidate data is due for review.
        </EmptyState>
      ) : (
        <Table caption="Candidates due for review">
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th>Applied for</Th>
              <Th>Due since</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {data.due.map((c) => (
              <tr key={c.id}>
                <Td className="font-semibold">{c.name}</Td>
                <Td>{c.vacancies.join(", ")}</Td>
                <Td>{formatDate(c.dueOn)}</Td>
                <Td>
                  <AnonymiseButton candidateId={c.id} name={c.name} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
