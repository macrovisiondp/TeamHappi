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
import { PreviewNotice, when } from "@/features/platform/components";
import { CATEGORY_LABEL } from "@/features/platform/labels";
import { getProvider } from "@/integrations/registry";
import { s3Status } from "@/integrations/storage/blob";
import {
  integrationAdmin,
  organisationAdmin,
  platformAudit,
} from "@/lib/platform-access";

export const metadata: Metadata = { title: "Platform overview" };
export const instant = false;

export default async function PlatformDashboardPage() {
  const [recent, orgs, integrations] = await Promise.all([
    platformAudit(5),
    organisationAdmin.list(),
    integrationAdmin.overview(),
  ]);
  // Storage is Amazon S3, switched on in Vercel (ADR-0014), not activated here.
  const s3On = s3Status().on;
  const categories = (integrations.kind === "ok" ? integrations.data : []).map(
    (c) =>
      c.category === "storage"
        ? {
            ...c,
            activeProviderId: s3On ? "aws-s3" : null,
            activatedAt: null,
          }
        : c,
  );
  // Only the keys of providers actually in use (not every possible provider).
  const credentials = categories.flatMap((c) =>
    c.providers
      .filter((p) => p.providerId === c.activeProviderId)
      .flatMap((p) => p.credentials),
  );
  const notSet = "Not available";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform overview"
        description="Client organisations and the services every TeamHappi organisation depends on."
      />
      <PreviewNotice />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organisations"
          value={orgs.kind === "ok" ? orgs.data.length : "–"}
          detail={orgs.kind === "ok" ? "Client workspaces" : notSet}
          icon={Building2}
        />
        <StatCard
          label="Active integrations"
          value={categories.filter((c) => c.activeProviderId).length}
          detail={`Of ${categories.length || 4} services`}
          icon={Plug}
        />
        <StatCard
          label="Services without a provider"
          value={categories.filter((c) => !c.activeProviderId).length}
          detail="Nothing is sent for these"
          icon={AlertTriangle}
          tone="attention"
        />
        <StatCard
          label="Credentials set"
          value={`${credentials.filter((c) => c.present).length} / ${credentials.length}`}
          detail="For the providers in use"
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
          <Table caption="Active provider for each service">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th>Provider</Th>
                <Th>Since</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.category}>
                  <Td>
                    <Link
                      href={`/platform/integrations/${c.category}`}
                      className="font-semibold text-forest underline-offset-4 hover:underline"
                    >
                      {CATEGORY_LABEL[c.category]}
                    </Link>
                  </Td>
                  <Td>
                    {c.activeProviderId
                      ? (getProvider(c.activeProviderId)?.name ??
                        c.activeProviderId)
                      : "None"}
                  </Td>
                  <Td>
                    {c.category === "storage" && c.activeProviderId
                      ? "Set in Vercel"
                      : c.activeProviderId
                        ? when(c.activatedAt)
                        : "–"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card aria-labelledby="recent-heading">
          <CardTitle id="recent-heading">Recent platform activity</CardTitle>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {(recent ?? []).map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2.5">
                <span>{e.action}</span>
                <span className="text-xs break-all text-ink-muted">
                  {when(e.occurredAt.toISOString())} · {e.actor ?? "System"}
                </span>
              </li>
            ))}
            {recent && recent.length === 0 ? (
              <li className="py-2.5 text-ink-muted">No events yet.</li>
            ) : null}
            {recent === null ? (
              <li className="py-2.5 text-ink-muted">
                Your role doesn&apos;t include the audit log.
              </li>
            ) : null}
          </ul>
          <Link
            href="/platform/audit"
            className="text-sm font-semibold text-forest underline-offset-4 hover:underline"
          >
            View the full audit log
          </Link>
        </Card>
      </div>
    </div>
  );
}
