import { AlertTriangle, Building2, KeyRound, Plug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  HealthBadge,
  PreviewNotice,
  when,
} from "@/features/platform/components";
import {
  AUDIT_EVENTS,
  CATEGORY_LABEL,
  PLATFORM_STATS,
  PROVIDER_STATE,
} from "@/features/platform/fixtures";
import { SERVICE_CATEGORIES } from "@/integrations/core/types";
import { providersFor } from "@/integrations/registry";

export const metadata: Metadata = { title: "Platform overview" };
export const instant = false;

export default function PlatformDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform overview"
        demo
        description="Health of the services every TeamHappi organisation depends on."
      />
      <PreviewNotice />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organisations"
          value={PLATFORM_STATS.organisations}
          detail="Synthetic tenants"
          icon={Building2}
        />
        <StatCard
          label="Active integrations"
          value={PLATFORM_STATS.activeIntegrations}
          detail="All synthetic adapters"
          icon={Plug}
        />
        <StatCard
          label="Needs attention"
          value={PLATFORM_STATS.needsAttention}
          detail="Payment webhook retries"
          icon={AlertTriangle}
          tone="attention"
        />
        <StatCard
          label="Credentials expiring"
          value={PLATFORM_STATS.expiringCredentials}
          detail="In the next 30 days"
          icon={KeyRound}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card aria-labelledby="active-heading">
          <CardHeader>
            <div>
              <CardTitle id="active-heading">Active providers</CardTitle>
              <CardDescription>
                One active provider per service.
              </CardDescription>
            </div>
          </CardHeader>
          <Table caption="Active provider and health for each service">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th>Provider</Th>
                <Th>Health</Th>
              </tr>
            </thead>
            <tbody>
              {SERVICE_CATEGORIES.map((category) => {
                const active = providersFor(category).find(
                  (p) => PROVIDER_STATE[p.id]?.active,
                );
                return (
                  <tr key={category}>
                    <Td>
                      <Link
                        href={`/platform/integrations/${category}`}
                        className="font-semibold text-forest underline-offset-4 hover:underline"
                      >
                        {CATEGORY_LABEL[category]}
                      </Link>
                    </Td>
                    <Td>{active?.name ?? "None"}</Td>
                    <Td>
                      <HealthBadge
                        status={
                          active
                            ? (PROVIDER_STATE[active.id]?.health ?? "unknown")
                            : "not-configured"
                        }
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card aria-labelledby="recent-heading">
          <CardTitle id="recent-heading">Recent platform activity</CardTitle>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {AUDIT_EVENTS.slice(0, 4).map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2.5">
                <span>{e.detail}</span>
                <span className="text-xs text-ink-muted">
                  {when(e.at)} · {e.actor}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/platform/integrations/audit"
            className="text-sm font-semibold text-forest underline-offset-4 hover:underline"
          >
            View the full audit log
          </Link>
        </Card>
      </div>
    </div>
  );
}
