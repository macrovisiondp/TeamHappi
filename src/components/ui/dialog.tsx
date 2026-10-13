"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Accessible modal built on the native <dialog> element: showModal() gives focus
 * trapping, an inert background and Escape-to-close without extra libraries.
 */
function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  placement = "center",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  placement?: "center" | "left";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // backdrop click
      }}
      className={cn(
        "m-0 max-h-dvh bg-surface text-ink shadow-pop backdrop:bg-ink/40",
        placement === "center"
          ? "top-1/2 left-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-1/2 rounded-2xl p-6"
          : "top-0 left-0 h-dvh w-[min(20rem,85vw)] rounded-r-2xl p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="text-sm text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-11 shrink-0 place-items-center rounded-[10px] hover:bg-sage"
          aria-label="Close"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}

export { Dialog };
