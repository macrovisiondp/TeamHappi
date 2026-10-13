import { Construction, ShieldX, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";

/** Shown when the server refuses an action or page (403). Never a client-side check. */
export function PermissionDenied({
  message = "You don't have permission to view this page. If you think you should, ask an administrator in your organisation.",
}: {
  message?: string;
}) {
  return (
    <EmptyState
      icon={ShieldX}
      title="You don't have access to this"
      action={
        <Button asChild variant="secondary">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    >
      {message}
    </EmptyState>
  );
}

/** Overview page for a module whose screens are not built yet. */
export function PlannedModule({
  title,
  icon,
  summary,
  features,
  milestone,
}: {
  title: string;
  icon: LucideIcon;
  summary: string;
  features: string[];
  milestone: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={summary} />
      <EmptyState icon={icon} title={`${title} is on the way`}>
        <p>Planned for {milestone}. Nothing here is live yet.</p>
      </EmptyState>
      <section
        aria-labelledby="planned-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="planned-heading" className="text-lg font-semibold">
          What this module will do
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm"
            >
              <Construction
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-forest"
              />
              {feature}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SectionHeading({
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}) {
  return (
    <h2 id={id} className="text-lg font-semibold">
      {children}
    </h2>
  );
}
