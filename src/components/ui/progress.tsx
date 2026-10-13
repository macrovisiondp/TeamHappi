import { cn } from "@/lib/utils";

/** Labelled progress bar; the percentage is always shown as text too. */
export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className="h-full rounded-full bg-forest"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums">
        {pct}%
      </span>
    </div>
  );
}
