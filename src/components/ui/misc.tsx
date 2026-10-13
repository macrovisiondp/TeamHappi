import { FlaskConical } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Initials avatar. Decorative: the name is always shown next to it. */
function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-16 text-xl",
  };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[#fbe0d9] font-semibold text-[#7a2e1f]",
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-lg bg-surface-muted", className)}
    />
  );
}

/** Marks a screen or value as synthetic demo data. */
function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-demo-border bg-demo px-2.5 py-0.5 text-xs font-semibold text-demo-fg",
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      Demo data
    </span>
  );
}

function PageHeader({
  title,
  description,
  demo = false,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  demo?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
          {demo ? <DemoBadge /> : null}
        </div>
        {description ? (
          <p className="max-w-2xl text-sm text-ink-muted md:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true";
  }>;
  tone?: "default" | "attention";
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <span
          className={cn(
            "grid size-9 place-items-center rounded-full",
            tone === "attention"
              ? "bg-warning-bg text-warning"
              : "bg-sage text-forest",
          )}
        >
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
      </div>
      <p className="font-heading text-3xl font-bold tabular-nums">{value}</p>
      {detail ? <p className="text-sm text-ink-muted">{detail}</p> : null}
    </div>
  );
}

export { Avatar, DemoBadge, PageHeader, Skeleton, StatCard };
