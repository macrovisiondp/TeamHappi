import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A calm, inline problem message for a form: what's wrong, in one line, with
 * any field problems underneath. No "error" headings or codes.
 */
export function FormError({
  message,
  details,
  className,
}: {
  message: string;
  details?: readonly string[];
  className?: string;
}) {
  const extra = (details ?? []).filter((d) => d && d !== message);
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-2.5 rounded-lg bg-danger-bg/70 px-3 py-2.5 text-sm text-danger",
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <p>{message}</p>
        {extra.length ? (
          <ul className="list-disc pl-4 text-ink">
            {[...new Set(extra)].map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
