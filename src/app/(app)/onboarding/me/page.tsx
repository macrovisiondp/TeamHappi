import { CheckCircle2, ClipboardCheck, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { MyTaskAction } from "@/features/onboarding/my-controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { onboardingApi, trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "My onboarding" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/**
 * M7.3: an employee's own onboarding, phone first. Reached through their own
 * linked record (ownership), never through a role.
 */
export default async function MyOnboardingPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const me = await onboardingApi.mine(ws);

  if (!me?.onboarding)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My onboarding" />
        <EmptyState icon={ClipboardCheck} title="Nothing to do yet">
          {me
            ? "When your manager starts your onboarding, your tasks appear here."
            : "Your TeamHappi login isn't linked to a staff record yet. Ask your manager to invite you from your record."}
        </EmptyState>
      </div>
    );

  const o = me.onboarding;
  // M8.2: their outstanding training, as a pointer to My training.
  const training = await trainingApi.mine(ws);
  const trainingToDo = (training?.required ?? []).filter(
    (c) => c.status !== "up_to_date",
  );
  const todo = o.myTasks.filter((t) => !t.done);
  const done = o.myTasks.filter((t) => t.done);
  const bring = o.documents.filter((d) => d.needed);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome, ${me.firstName}`}
        description={`Your onboarding${o.siteName ? ` at ${o.siteName}` : ""}. You start on ${formatDate(o.startDate)}.`}
      />

      <Card aria-labelledby="overall-heading">
        <CardTitle id="overall-heading">How it&rsquo;s going</CardTitle>
        <Progress
          value={o.overall.percent}
          label={`${o.overall.finished} of ${o.overall.total} onboarding steps finished`}
        />
        <CardDescription>
          {o.status === "completed"
            ? "Your onboarding is complete. Welcome aboard!"
            : `${o.overall.finished} of ${o.overall.total} steps finished, including the ones your manager does.`}
        </CardDescription>
      </Card>

      <section aria-labelledby="todo-heading" className="flex flex-col gap-3">
        <h2 id="todo-heading" className="text-lg font-semibold">
          For you to do
        </h2>
        {todo.length === 0 ? (
          <p className="flex items-center gap-2 text-base">
            <CheckCircle2 aria-hidden="true" className="size-5 text-forest" />
            You&rsquo;re all done. Thank you!
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {todo.map((t) => (
              <li key={t.id}>
                <Card aria-label={t.title} className="gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-semibold">{t.title}</span>
                    <div className="flex flex-wrap gap-2">
                      {t.category === "policy" ? (
                        <Badge tone="info" icon={null}>
                          Read and confirm
                        </Badge>
                      ) : null}
                      {t.overdue ? (
                        <Badge tone="warning">Overdue</Badge>
                      ) : t.dueOn ? (
                        <Badge tone="neutral" icon={null}>
                          By {formatDate(t.dueOn)}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {t.guidance ? (
                    <p className="text-base whitespace-pre-line">
                      {t.guidance}
                    </p>
                  ) : null}
                  {o.status === "active" ? (
                    <MyTaskAction
                      taskId={t.id}
                      title={t.title}
                      isPolicy={t.category === "policy"}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {trainingToDo.length ? (
        <section
          aria-labelledby="training-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="training-heading" className="text-lg font-semibold">
            Training to complete
          </h2>
          <ul className="flex flex-col gap-1 text-base">
            {trainingToDo.map((c) => (
              <li key={c.courseId}>
                {c.name}
                {c.dueOn && (c.status === "due" || c.status === "overdue") ? (
                  <span className="text-sm text-ink-muted">
                    {" "}
                    · by {formatDate(c.dueOn)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <Link
            href="/training/me"
            className="w-fit text-base font-semibold text-forest underline-offset-4 hover:underline"
          >
            Open My training
          </Link>
        </section>
      ) : null}

      {bring.length ? (
        <section
          aria-labelledby="bring-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="bring-heading" className="text-lg font-semibold">
            Documents to bring
          </h2>
          <p className="text-sm text-ink-muted">
            Bring the originals. Your manager will look at them and record that
            they&rsquo;ve seen them.
          </p>
          <ul className="flex flex-col gap-2">
            {bring.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-base">
                <FileText
                  aria-hidden="true"
                  className="size-5 text-ink-muted"
                />
                {d.title}
                {d.required ? null : (
                  <span className="text-sm text-ink-muted">
                    (if you have it)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {done.length ? (
        <section aria-labelledby="done-heading" className="flex flex-col gap-3">
          <h2 id="done-heading" className="text-lg font-semibold">
            Done
          </h2>
          <ul className="flex flex-col gap-2">
            {done.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-base">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-forest"
                />
                <span>
                  {t.title}
                  {t.byManager ? (
                    <span className="block text-sm text-ink-muted">
                      Recorded by your manager
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
