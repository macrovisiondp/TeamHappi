import type * as React from "react";

import { cn } from "@/lib/utils";

const controlClass =
  "h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-base text-ink shadow-xs placeholder:text-ink-muted/80 disabled:cursor-not-allowed disabled:bg-surface-muted aria-invalid:border-danger";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlClass, className)} {...props} />;
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(controlClass, "appearance-auto pr-8", className)}
      {...props}
    />
  );
}

/** Label + control + optional hint / error, wired with ids for screen readers. */
function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Field, Input, Select };
