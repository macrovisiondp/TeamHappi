import { GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { CourseCommand, CourseForm } from "@/features/training/controls";
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  METHOD_LABEL,
  TrainingTabs,
} from "@/features/training/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Training courses" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function TrainingCoursesPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (ws.grants.get("training.manage") !== "all")
    return (
      <PermissionDenied message="Managing training courses needs an owner, administrator or HR manager." />
    );
  const courses = (await trainingApi.listCourses(ws, true)) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Training"
        description="Your course catalogue, and who needs each course."
      />
      <TrainingTabs current="courses" showCourses />
      <Alert tone="info" title="Suggested courses are a starting point">
        Add a set of common UK hospitality courses, then edit them. They
        aren&rsquo;t legal requirements, and renewal periods are common
        practice: confirm them with your adviser or training provider. Nothing
        is required of anyone until you add a rule.
      </Alert>
      <CourseCommand intent="add-suggested" label="Add suggested courses" />

      {courses.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No courses yet">
          Add the suggested courses, or create your own below.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {courses.map((c) => (
            <li key={c.id}>
              <Card aria-label={c.name} className="h-full gap-2">
                <Link
                  href={`/training/courses/${c.id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {c.name}
                </Link>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral" icon={null}>
                    {KIND_LABEL[c.kind]}
                  </Badge>
                  <Badge tone="neutral" icon={null}>
                    {CATEGORY_LABEL[c.category] ?? c.category}
                  </Badge>
                  {c.isSuggested ? (
                    <Badge tone="info" icon={null}>
                      Suggested
                    </Badge>
                  ) : null}
                  {c.archived ? <Badge tone="neutral">Archived</Badge> : null}
                </div>
                <p className="text-sm text-ink-muted">
                  {METHOD_LABEL[c.completionMethod]} ·{" "}
                  {c.validityMonths
                    ? `renew every ${c.validityMonths} months`
                    : "doesn't expire"}{" "}
                  ·{" "}
                  {c.rules === 0
                    ? "nobody required yet"
                    : `${c.rules} rule${c.rules === 1 ? "" : "s"}`}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card aria-labelledby="new-course-heading">
        <CardTitle id="new-course-heading">Create a course</CardTitle>
        <CourseForm />
      </Card>
    </div>
  );
}
