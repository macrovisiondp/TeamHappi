import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "border-line bg-surface-muted text-ink",
  success: "border-success-border bg-success-bg text-success",
  warning: "border-warning-border bg-warning-bg text-warning",
  danger: "border-danger-border bg-danger-bg text-danger",
  info: "border-info-border bg-info-bg text-info",
};

const toneIcon: Record<Tone, LucideIcon> = {
  neutral: CircleDashed,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

/**
 * Status label. Always renders an icon AND text, so status never depends on
 * colour alone (WCAG 1.4.1).
 */
function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: Tone; icon?: LucideIcon | null }) {
  const Icon = icon === null ? null : (icon ?? toneIcon[tone]);
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {children}
    </span>
  );
}

export { Badge };
