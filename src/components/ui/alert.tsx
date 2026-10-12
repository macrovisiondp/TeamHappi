import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger" | "demo";

const styles: Record<AlertTone, { box: string; icon: LucideIcon }> = {
  info: { box: "border-info-border bg-info-bg text-info", icon: Info },
  success: {
    box: "border-success-border bg-success-bg text-success",
    icon: CheckCircle2,
  },
  warning: {
    box: "border-warning-border bg-warning-bg text-warning",
    icon: AlertTriangle,
  },
  danger: {
    box: "border-danger-border bg-danger-bg text-danger",
    icon: XCircle,
  },
  demo: { box: "border-demo-border bg-demo text-demo-fg", icon: FlaskConical },
};

function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const { box, icon: Icon } = styles[tone];
  return (
    <div
      role={role}
      className={cn("flex gap-3 rounded-xl border p-4 text-sm", box, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="text-ink">{children}</div> : null}
      </div>
    </div>
  );
}

export { Alert };
