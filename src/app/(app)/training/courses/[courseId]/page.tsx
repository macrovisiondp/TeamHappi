import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  AddRuleForm,
  CourseCommand,
  CourseForm,
  EditRule,
} from "@/features/training/controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { jobTitlesApi, trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Training course" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function TrainingCoursePage({
  params,
}: PageProps<"/training/courses/[courseId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const jobTitleOptions = await jobTitlesApi.options(ws);
  const { courseId } = await params;
  // Other organisations' courses, and anyone without training.manage: 404.
  const c = await trainingApi.getCourse(ws, courseId);
  if (!c) notFound();
  const interactive = c.completionMethod === "interactive";
  const [pkg, waiting] = interactive
    ? await Promise.all([
        trainingApi.packageSummary(ws, c.id),
        trainingApi.awaitingSignOff(ws, c.id),
      ])
    : [null, []];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/training/courses"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Courses
      </Link>
      <PageHeader
        title={c.name}
        description={c.description ?? undefined}
        actions={
          c.archived ? (
            <Badge tone="neutral">Archived</Badge>
          ) : c.isSuggested ? (
            <Badge tone="info" icon={null}>
              Suggested: review before use
            </Badge>
          ) : null
        }
      />
      {c.archived ? (
        <Alert tone="info" title="This course is archived">
          Its rules no longer apply. Completion records are kept in each
          person&rsquo;s history.
        </Alert>
      ) : (
        <>
          {pkg ? (
            <Card aria-labelledby="content-heading">
              <CardHeader>
                <div>
                  <CardTitle id="content-heading">Course content</CardTitle>
                  <CardDescription>
                    Course {pkg.code}, version {pkg.version}, imported{" "}
                    {formatDate(pkg.importedAt)}. To change it, import an
                    updated course file on the Courses page.
                  </CardDescription>
                </div>
              </CardHeader>
              <ol className="ml-5 list-decimal text-sm">
                {pkg.modules.map((m, i) => (
                  <li key={i}>
                    {m.title}
                    <span className="text-ink-muted">
                      {m.questions
                        ? ` · ${m.questions} quiz question${m.questions === 1 ? "" : "s"}`
                        : " · practice"}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="text-sm">
                Module quizzes: pass mark {pkg.modulePassPercent}%. Final
                assessment: {pkg.finalCount} questions drawn from {pkg.poolSize}{" "}
                ({pkg.safetyQuestions} safety question
                {pkg.safetyQuestions === 1 ? "" : "s"}, always included and must
                be right), pass mark {pkg.passPercent}%.
                {pkg.minutes ? ` About ${pkg.minutes} minutes.` : ""}
              </p>
              {pkg.practical ? (
                <p className="text-sm">
                  <span className="font-semibold">
                    Practical sign-off needed:{" "}
                  </span>
                  {pkg.practical.replaceAll("**", "")}
                </p>
              ) : null}
            </Card>
          ) : null}
          {pkg?.practical ? (
            <Card aria-labelledby="signoff-heading">
              <CardHeader>
                <div>
                  <CardTitle id="signoff-heading">
                    Awaiting practical sign-off
                  </CardTitle>
                  <CardDescription>
                    These people passed the final assessment. Sign off when
                    you&rsquo;ve seen them do the practical; that completes the
                    course and makes their certificate.
                  </CardDescription>
                </div>
              </CardHeader>
              {waiting.length === 0 ? (
                <p className="text-sm">Nobody is waiting.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {waiting.map((w) => (
                    <li
                      key={w.employeeId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">{w.name}</span>
                        <span className="text-sm text-ink-muted">
                          Passed {formatDate(w.passedAt)} with {w.scorePercent}%
                        </span>
                      </div>
                      <CourseCommand
                        courseId={c.id}
                        employeeId={w.employeeId}
                        intent="sign-off"
                        label="Sign off"
                        variant="primary"
                        confirm={{
                          title: `Sign off ${w.name}?`,
                          description:
                            "Confirm you've seen them carry out the practical safely. This completes the course for them.",
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
          <Card aria-labelledby="rules-heading">
            <CardHeader>
              <div>
                <CardTitle id="rules-heading">Who needs it</CardTitle>
                <CardDescription>
                  Rules are applied to everyone automatically, including new
                  starters and people who change site or job title. If several
                  rules apply to one person, they need the course once:
                  it&rsquo;s mandatory if any rule is, due on the earliest date.
                </CardDescription>
              </div>
            </CardHeader>
            {c.rules.length === 0 ? (
              <p className="text-sm">Nobody is required to do this yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {c.rules.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{r.target}</span>
                      <span className="text-sm text-ink-muted">
                        {r.mandatory ? "Mandatory" : "Recommended"} · due within{" "}
                        {r.dueDays} day{r.dueDays === 1 ? "" : "s"} · from{" "}
                        {formatDate(r.effectiveFrom)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <EditRule courseId={c.id} rule={r} />
                      <CourseCommand
                        courseId={c.id}
                        ruleId={r.id}
                        intent="remove-rule"
                        label="Remove"
                        confirm={{
                          title: `Remove the rule for ${r.target}?`,
                          description:
                            "People it applied to no longer need this course because of it. Their completion records are kept.",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card aria-labelledby="add-rule-heading">
            <CardTitle id="add-rule-heading">Add a rule</CardTitle>
            <AddRuleForm
              jobTitleOptions={jobTitleOptions}
              courseId={c.id}
              sites={c.options.sites}
              people={c.options.people}
            />
          </Card>
          <Card aria-labelledby="edit-heading">
            <CardTitle id="edit-heading">Course details</CardTitle>
            <CourseForm course={c} />
          </Card>
          <CourseCommand
            courseId={c.id}
            intent="archive"
            label="Archive course"
            variant="danger"
            confirm={{
              title: `Archive ${c.name}?`,
              description:
                "Its rules stop applying and it leaves the matrix. Everyone's completion records are kept.",
            }}
          />
        </>
      )}
    </div>
  );
}
