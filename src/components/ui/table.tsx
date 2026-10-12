import type * as React from "react";

import { cn } from "@/lib/utils";

/** Semantic table that scrolls inside its own container on narrow screens. */
function Table({
  caption,
  className,
  children,
}: {
  caption: string;
  className?: string;
  children: React.ReactNode;
}) {
  // The wrapper scrolls on narrow screens, so it must be reachable by keyboard
  // (WCAG 2.1.1; axe "scrollable-region-focusable") and named for screen readers.
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-2xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line bg-surface-muted px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

function Td({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "border-b border-line px-4 py-3 align-middle tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export { Table, Td, Th };
