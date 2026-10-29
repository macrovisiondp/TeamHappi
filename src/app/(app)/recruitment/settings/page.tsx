import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { RecruitmentSettingsForm } from "@/features/recruitment/controls";
import { RecruitmentTabs } from "@/features/recruitment/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { recruitmentApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Recruitment settings" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function RecruitmentSettingsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const s = await recruitmentApi.settings(ws);
  if (!s || "ok" in s || !s.canEdit)
    return (
      <PermissionDenied message="Recruitment settings need an owner, administrator or HR manager." />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recruitment"
        description="Rename the pipeline stages, and set when candidate data is due for review. Hired, Rejected and Withdrawn keep their names."
      />
      <RecruitmentTabs
        current="settings"
        show={{ vacancies: true, review: true, settings: true }}
      />
      <Card aria-label="Recruitment settings">
        <RecruitmentSettingsForm
          labels={s.labels}
          retentionMonths={s.retentionMonths}
        />
      </Card>
    </div>
  );
}
