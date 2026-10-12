import type { ComponentProps } from "react";

export function FormField({
  id,
  label,
  ...input
}: ComponentProps<"input"> & { id: string; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className="h-11 rounded-md border bg-card px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        {...input}
      />
    </div>
  );
}
