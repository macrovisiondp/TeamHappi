import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  AddJobTitles,
  RemoveJobTitle,
} from "@/features/setup/job-title-controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { jobTitlesApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Job titles" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/**
 * M16: the organisation's job titles. Once the list has any, every job-title
 * box (people, vacancies, training rules, onboarding templates, starter packs)
 * becomes a choice from it, so a typo can't drop someone's training.
 */
export default async function JobTitlesPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (ws.grants.get("tenant.settings.manage") !== "all")
    return (
      <PermissionDenied message="Managing job titles needs an owner or administrator." />
    );
  const { titles, unlisted } = await jobTitlesApi.list(ws);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job titles"
        description="Training rules, onboarding templates and starter packs are matched to people by job title. Keep one list so they always match."
      />
      {titles.length === 0 ? (
        <Alert tone="info" title="No list yet">
          Job titles are typed freely at the moment. Add your titles below and
          every job-title box becomes a choice from this list.
        </Alert>
      ) : null}
      {unlisted.length ? (
        <Alert
          tone="warning"
          title="Some staff have titles that aren't on the list"
        >
          {unlisted.map((u) => `${u.name} (${u.staff})`).join(", ")}. Add them
          below, or change those people&rsquo;s job titles.
        </Alert>
      ) : null}
      {titles.length ? (
        <Card aria-labelledby="titles-heading">
          <CardTitle id="titles-heading">Your job titles</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {titles.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span>
                  <span className="font-semibold">{t.name}</span>
                  <span className="block text-sm text-ink-muted">
                    {t.staff === 0
                      ? "Nobody has this title yet"
                      : `${t.staff} ${t.staff === 1 ? "person" : "people"}`}
                  </span>
                </span>
                <RemoveJobTitle id={t.id} name={t.name} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card aria-labelledby="add-heading">
        <CardTitle id="add-heading">Add job titles</CardTitle>
        <CardDescription>
          Use the exact titles your training and onboarding plans use.
        </CardDescription>
        <AddJobTitles />
      </Card>
    </div>
  );
}
