import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { GetStartedStep } from "@/lib/workspace/get-started";

/** The owner's first steps, until they're all done. */
export function GetStarted({ steps }: { steps: readonly GetStartedStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <Card aria-labelledby="get-started" className="gap-3">
      <CardTitle id="get-started">Get started</CardTitle>
      <CardDescription>
        A few steps to set up your organisation. Each ticks itself off when
        it&rsquo;s done.
      </CardDescription>
      <Progress
        value={Math.round((done / steps.length) * 100)}
        label={`${done} of ${steps.length} steps done`}
      />
      <ol className="flex flex-col divide-y divide-line">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            {s.done ? (
              <CheckCircle2
                aria-hidden="true"
                className="size-5 shrink-0 text-success"
              />
            ) : (
              <Circle
                aria-hidden="true"
                className="size-5 shrink-0 text-ink-muted"
              />
            )}
            <div className="flex flex-col">
              <Link
                href={s.href}
                className={`inline-flex min-h-6 items-center text-sm font-semibold underline-offset-4 hover:underline ${s.done ? "text-ink-muted" : "text-forest"}`}
              >
                {s.label}
                <span className="sr-only">
                  {s.done ? " (done)" : " (to do)"}
                </span>
              </Link>
              <span className="text-xs text-ink-muted">{s.hint}</span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
