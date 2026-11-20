import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/misc";
import { CourseRunner } from "@/features/training/course-runner";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Course" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/**
 * M15: an interactive course, for the person it applies to (ownership).
 * Anyone else, other organisations' courses and courses that don't apply: 404.
 */
export default async function MyCoursePage({
  params,
}: PageProps<"/training/me/[courseId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { courseId } = await params;
  const course = await trainingApi.learn(ws, courseId);
  if (!course) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/training/me"
        className="flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        My training
      </Link>
      <PageHeader title={course.name} description={course.who ?? undefined} />
      <CourseRunner course={course} />
    </div>
  );
}
