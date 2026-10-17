import { Badge, type Tone } from "@/components/ui/badge";

const STATUS: Record<string, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  offboarding: { tone: "neutral", label: "Offboarding" },
  closed: { tone: "neutral", label: "Closed" },
};

const SUBSCRIPTION: Record<string, { tone: Tone; label: string }> = {
  trial: { tone: "info", label: "Trial" },
  active: { tone: "success", label: "Subscribed" },
  past_due: { tone: "warning", label: "Payment overdue" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function OrganisationStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SubscriptionBadge({ status }: { status: string }) {
  const s = SUBSCRIPTION[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
