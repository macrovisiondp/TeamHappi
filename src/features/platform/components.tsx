import { KeyRound, Power, Send, ShieldCheck, Wrench } from "lucide-react";
import type * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import type {
  HealthStatus,
  ProviderReadiness,
  ServiceCategory,
} from "@/integrations/core/types";
import { providersFor, type ProviderDefinition } from "@/integrations/registry";
import { formatDate, formatTime } from "@/lib/format";
import { PRIVILEGED_DISABLED_REASON } from "@/lib/platform-access/policy";

import {
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
  PROVIDER_STATE,
} from "./fixtures";

const HEALTH: Record<HealthStatus, { tone: Tone; label: string }> = {
  healthy: { tone: "success", label: "Healthy" },
  degraded: { tone: "warning", label: "Degraded" },
  down: { tone: "danger", label: "Down" },
  unknown: { tone: "neutral", label: "Unknown" },
  "not-configured": { tone: "neutral", label: "Not configured" },
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  const { tone, label } = HEALTH[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const READINESS: Record<ProviderReadiness, { tone: Tone; label: string }> = {
  synthetic: { tone: "info", label: "Synthetic adapter" },
  "adapter-ready": { tone: "neutral", label: "Awaiting approval" },
  planned: { tone: "neutral", label: "Planned" },
};

export function ReadinessBadge({
  readiness,
}: {
  readiness: ProviderReadiness;
}) {
  const { tone, label } = READINESS[readiness];
  return (
    <Badge tone={tone} icon={readiness === "synthetic" ? null : undefined}>
      {label}
    </Badge>
  );
}

export function when(iso: string | null): string {
  return iso ? `${formatDate(iso)}, ${formatTime(iso)}` : "Never";
}

export function PreviewNotice() {
  return (
    <Alert tone="demo" title="Integration settings: synthetic configuration">
      Nothing here is connected to a real provider yet. Changing providers,
      credentials or AI settings stays switched off until live connections are
      approved (Milestone 5.3).
    </Alert>
  );
}

function ProviderCard({ provider }: { provider: ProviderDefinition }) {
  const state = PROVIDER_STATE[provider.id];
  const headingId = `provider-${provider.id}`;
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id={headingId}>{provider.name}</CardTitle>
          <CardDescription>{provider.summary}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {state?.active ? (
            <Badge tone="success" icon={Power}>
              Active
            </Badge>
          ) : null}
          <ReadinessBadge readiness={provider.readiness} />
        </div>
      </CardHeader>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-ink-muted">Health</dt>
          <dd>
            <HealthBadge status={state?.health ?? "not-configured"} />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-ink-muted">Last validated</dt>
          <dd>{when(state?.lastValidatedAt ?? null)}</dd>
        </div>
        {state?.latencyMs !== null && state?.latencyMs !== undefined ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">Latency / errors (24 h)</dt>
            <dd className="tabular-nums">
              {state.latencyMs} ms / {state.errors24h}
            </dd>
          </div>
        ) : null}
        {Object.entries(state?.config ?? {}).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
        {provider.secretFields.length ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">Credentials</dt>
            <dd className="flex items-center gap-1.5">
              <KeyRound aria-hidden="true" className="size-4 text-ink-muted" />
              Write-only. Never shown after saving.
            </dd>
          </div>
        ) : null}
      </dl>

      {provider.restrictions?.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {provider.restrictions.map((r) => (
            <li key={r} className="flex items-start gap-2">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-forest"
              />
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled
          disabledReason={PRIVILEGED_DISABLED_REASON}
        >
          <Wrench aria-hidden="true" />
          Configure
          <span className="sr-only"> {provider.name}</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled
          disabledReason={PRIVILEGED_DISABLED_REASON}
        >
          <Send aria-hidden="true" />
          Test connection
          <span className="sr-only"> for {provider.name}</span>
        </Button>
        {!state?.active ? (
          <Button
            size="sm"
            disabled
            disabledReason={PRIVILEGED_DISABLED_REASON}
          >
            <Power aria-hidden="true" />
            Make active
            <span className="sr-only"> {provider.name}</span>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Shared layout for /platform/integrations/{email,storage,payments,ai}. */
export function CategoryPage({
  category,
  children,
}: {
  category: ServiceCategory;
  children?: React.ReactNode;
}) {
  const providers = providersFor(category);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={CATEGORY_LABEL[category]}
        demo
        description={CATEGORY_DESCRIPTION[category]}
      />
      <PreviewNotice />
      {children}
      <section
        aria-labelledby="providers-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="providers-heading" className="text-lg font-semibold">
          Providers
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
