import { CheckCircle2, GraduationCap } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { METHOD_LABEL, StatusCell } from "@/features/training/labels";
import { ConfirmCourse } from "@/features/training/my-controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "My training" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/**
 * M8.2: a person's own training, phone first. Reached through their own
 * linked record (ownership), never through a role.
 */
export default async function MyTrainingPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const me = await trainingApi.mine(ws);

  if (!me)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My training" />
        <EmptyState icon={GraduationCap} title="Nothing to show yet">
          Your TeamHappi login isn&rsquo;t linked to a staff record. Ask your
          manager to invite you from your record.
        </EmptyState>
      </div>
    );

  // Content updated since they confirmed it: offered again to re-read.
  const reread = (c: (typeof me.required)[number]) =>
    c.confirmedVersion !== null && c.confirmedVersion < c.contentVersion;
  const toDo = me.required.filter(
    (c) => c.status !== "up_to_date" || reread(c),
  );
  const done = me.required.filter(
    (c) => c.status === "up_to_date" && !reread(c),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My training"
        description={`Hi ${me.firstName}. Here's the training your workplace asks you to do.`}
        actions={
          me.required.length ? (
            <Badge tone={me.upToDate ? "success" : "warning"}>
              {me.upToDate ? "Up to date" : "Training needed"}
            </Badge>
          ) : null
        }
      />

      {me.required.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No training required">
          When your workplace asks you to do some training, it appears here.
        </EmptyState>
      ) : (
        <section aria-labelledby="todo-heading" className="flex flex-col gap-3">
          <h2 id="todo-heading" className="text-lg font-semibold">
            To do
          </h2>
          {toDo.length === 0 ? (
            <p className="flex items-center gap-2 text-base">
              <CheckCircle2 aria-hidden="true" className="size-5 text-forest" />
              You&rsquo;re up to date. Thank you!
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {toDo.map((c) => {
                const updated = reread(c);
                return (
                  <li key={c.courseId}>
                    <Card aria-label={c.name} className="gap-3">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-base font-semibold">
                          {c.name}
                        </span>
                        <StatusCell s={c} />
                      </div>
                      {c.description ? (
                        <CardDescription>{c.description}</CardDescription>
                      ) : null}
                      {c.canConfirm && c.content ? (
                        <>
                          {updated ? (
                            <p className="text-sm font-semibold">
                              This was updated since you last confirmed it.
                            </p>
                          ) : null}
                          <details className="rounded-[10px] border border-line p-3">
                            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                              Read it
                            </summary>
                            <p className="mt-2 text-base whitespace-pre-line">
                              {c.content}
                            </p>
                          </details>
                          <ConfirmCourse
                            courseId={c.courseId}
                            name={c.name}
                            version={c.contentVersion}
                          />
                        </>
                      ) : (
                        <p className="text-sm">
                          {c.kind === "external"
                            ? "Done with a training provider. When you have your certificate, show it to your manager, who records it."
                            : "Given in person. Your manager records it when it's done."}
                        </p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {done.length ? (
        <section aria-labelledby="done-heading" className="flex flex-col gap-3">
          <h2 id="done-heading" className="text-lg font-semibold">
            Up to date
          </h2>
          <ul className="flex flex-col gap-2">
            {done.map((c) => (
              <li key={c.courseId} className="flex items-start gap-2 text-base">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-forest"
                />
                <span>
                  {c.name}
                  <span className="block text-sm text-ink-muted">
                    {c.expiresOn
                      ? `Valid until ${formatDate(c.expiresOn)}`
                      : "Doesn't expire"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {me.history.length ? (
        <section
          aria-labelledby="history-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="history-heading" className="text-lg font-semibold">
            My history
          </h2>
          <ul className="flex flex-col gap-2">
            {me.history.map((h) => (
              <li key={h.id} className="text-base">
                <span className="font-semibold">{h.courseName}</span>
                <span className="block text-sm text-ink-muted">
                  {formatDate(h.completedOn)} ·{" "}
                  {h.selfCompleted
                    ? "Confirmed by you"
                    : METHOD_LABEL[h.method]}
                  {h.provider ? ` · ${h.provider}` : ""}
                  {h.expiresOn ? ` · expires ${formatDate(h.expiresOn)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
