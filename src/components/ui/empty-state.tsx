import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong/50 bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-full bg-sage text-forest">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? (
        <div className="max-w-md text-sm text-ink-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
