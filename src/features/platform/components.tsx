import { KeyRound, Power, ShieldCheck } from "lucide-react";
import type * as React from "react";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  ProviderControls,
  ProviderPicker,
} from "@/features/platform-admin/integrations";
import type {
  DeploymentEnvironment,
  HealthStatus,
  ProviderReadiness,
  ServiceCategory,
} from "@/integrations/core/types";
import { PROVIDER_FIELDS } from "@/integrations/fields";
import { getProvider, type ProviderDefinition } from "@/integrations/registry";
import { formatDate, formatTime } from "@/lib/format";
import {
  getPlatformAccess,
  hasGrant,
  integrationAdmin,
  type IntegrationCategoryState,
} from "@/lib/platform-access";

import { CATEGORY_DESCRIPTION, CATEGORY_LABEL } from "./labels";

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
  synthetic: { tone: "info", label: "Test adapter" },
  "adapter-ready": { tone: "neutral", label: "Needs live approval" },
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

export function when(iso: string | Date | null): string {
  return iso ? `${formatDate(iso)}, ${formatTime(iso)}` : "Never";
}

export const ENVIRONMENT_LABEL: Record<DeploymentEnvironment, string> = {
  local: "Local development",
  preview: "Preview deployment",
  production: "Production",
};

export function PreviewNotice() {
  const approved = integrationAdmin
    .approvedLive()
    .map((id) => getProvider(id)?.name ?? id);
  return (
    <Alert tone="info" title="Live providers need your approval">
      {approved.length
        ? `Approved for live use: ${approved.join(", ")}. `
        : "No live provider is approved yet. "}
      Everything else stays off: settings can be saved and tested, but no real
      email, payment or AI call happens until you approve that provider.
    </Alert>
  );
}

export function NotConfiguredNotice() {
  return (
    <Alert tone="warning" title="Integration settings aren't configured here">
      This deployment has no platform database connection
      (PLATFORM_DATABASE_URL), so integration settings can&rsquo;t be read or
      saved.
    </Alert>
  );
}

function display(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function ProviderCard({
  provider,
  state,
  canManage,
  returnTo,
}: {
  provider: ProviderDefinition;
  state: IntegrationCategoryState["providers"][number];
  canManage: boolean;
  returnTo: string;
}) {
  const headingId = `provider-${provider.id}`;
  const fields = PROVIDER_FIELDS[provider.id] ?? [];
  const settings = state.latest?.settings ?? {};
  const values = Object.fromEntries(
    Object.entries(settings).map(([k, v]) => [k, display(v)]),
  );
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id={headingId}>{provider.name}</CardTitle>
          <CardDescription>{provider.summary}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.active ? (
            <Badge tone="success" icon={Power}>
              Active
            </Badge>
          ) : null}
          <ReadinessBadge readiness={provider.readiness} />
        </div>
      </CardHeader>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-ink-muted">Settings</dt>
          <dd>
            {state.latest
              ? `Version ${state.latest.version}, saved ${when(state.latest.createdAt)}`
              : "Not saved yet"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-ink-muted">Last successful test</dt>
          <dd>{when(state.latest?.validatedAt ?? null)}</dd>
        </div>
        {fields
          .filter((f) => settings[f.name] !== undefined)
          .map((f) => (
            <div key={f.name} className="flex flex-col gap-0.5">
              <dt className="text-ink-muted">{f.label}</dt>
              <dd className="break-words">{display(settings[f.name])}</dd>
            </div>
          ))}
        {state.credentials.length ? (
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <dt className="flex items-center gap-1.5 text-ink-muted">
              <KeyRound aria-hidden="true" className="size-4" />
              Credentials in this deployment (values are never shown)
            </dt>
            <dd>
              <ul className="flex flex-wrap gap-2">
                {state.credentials.map((c) => (
                  <li key={c.name}>
                    <Badge tone={c.present ? "success" : "neutral"}>
                      {c.name}: {c.present ? "set" : "not set"}
                    </Badge>
                  </li>
                ))}
              </ul>
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

      {canManage ? (
        <ProviderControls
          providerId={provider.id}
          name={provider.name}
          fields={fields}
          values={values}
          active={state.active}
          available={provider.readiness !== "planned"}
          returnTo={returnTo}
        />
      ) : null}
    </Card>
  );
}

/**
 * Shared layout for /platform/integrations/{email,payments,ai}: the current
 * provider, a dropdown to choose a provider, and only that provider's
 * settings. Test adapters aren't offered in production (they can't run there).
 */
export async function CategoryPage({
  category,
  selected,
  children,
}: {
  category: ServiceCategory;
  selected?: string;
  children?: React.ReactNode;
}) {
  const [read, access] = await Promise.all([
    integrationAdmin.category(category),
    getPlatformAccess(),
  ]);
  if (read.kind === "forbidden") return <PermissionDenied />;
  const canManage = hasGrant(access, "integrations.manage");
  const returnTo = `/platform/integrations/${category}`;
  const production =
    read.kind === "ok" && read.data.environment === "production";
  const states =
    read.kind === "ok"
      ? read.data.providers.filter(
          (st) =>
            !(
              production &&
              getProvider(st.providerId)?.readiness === "synthetic"
            ),
        )
      : [];
  const activeId = read.kind === "ok" ? read.data.activeProviderId : null;
  const chosen =
    states.find((st) => st.providerId === selected) ??
    states.find((st) => st.providerId === activeId) ??
    states[0];
  const provider = chosen ? getProvider(chosen.providerId) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={CATEGORY_LABEL[category]}
        description={CATEGORY_DESCRIPTION[category]}
      />
      {read.kind === "not_configured" ? (
        <NotConfiguredNotice />
      ) : (
        <Card aria-labelledby="current-heading">
          <CardHeader>
            <CardTitle id="current-heading">Current provider</CardTitle>
            <Badge tone={activeId ? "success" : "neutral"}>
              {activeId ? (getProvider(activeId)?.name ?? activeId) : "None"}
            </Badge>
          </CardHeader>
          <CardDescription>
            {ENVIRONMENT_LABEL[read.data.environment]}.{" "}
            {activeId
              ? `Active since ${when(read.data.activatedAt)}.`
              : "Nothing is sent for this service until a provider is set up and made active."}{" "}
            {canManage
              ? "Changes need an authenticator check within the last 15 minutes."
              : "Changing providers needs the “Manage integrations” permission."}
          </CardDescription>
        </Card>
      )}
      {chosen && provider ? (
        <section
          aria-labelledby="setup-heading"
          className="flex flex-col gap-4"
        >
          <h2 id="setup-heading" className="text-lg font-semibold">
            Set up a provider
          </h2>
          <ProviderPicker
            selected={provider.id}
            options={states.map((st) => {
              const p = getProvider(st.providerId)!;
              const notes = [
                st.active ? "active" : null,
                p.readiness === "synthetic" ? "test only" : null,
                p.readiness === "planned" ? "coming later" : null,
              ].filter(Boolean);
              return {
                id: p.id,
                label: notes.length
                  ? `${p.name} (${notes.join(", ")})`
                  : p.name,
              };
            })}
          />
          <ProviderCard
            provider={provider}
            state={chosen}
            canManage={canManage}
            returnTo={returnTo}
          />
        </section>
      ) : null}
      {children}
    </div>
  );
}
