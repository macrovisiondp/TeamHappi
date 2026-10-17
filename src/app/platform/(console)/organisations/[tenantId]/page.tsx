import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  OrganisationStatusBadge,
  SubscriptionBadge,
} from "@/features/platform-admin/organisation-badges";
import { OrganisationStatusControl } from "@/features/platform-admin/organisation-status";
import { formatDate, formatTime } from "@/lib/format";
import {
  getPlatformAccess,
  hasGrant,
  organisationAdmin,
} from "@/lib/platform-access";
import { Building2, MapPin, UserCheck, Users } from "lucide-react";

export const metadata: Metadata = { title: "Organisation · Platform" };
export const instant = false;

const EVENT: Record<string, string> = {
  "tenant.suspended": "Suspended",
  "tenant.reactivated": "Reactivated",
};

export default async function OrganisationPage({
  params,
}: PageProps<"/platform/organisations/[tenantId]">) {
  const { tenantId } = await params;
  const result = await organisationAdmin.get(tenantId);
  if (result.kind === "forbidden")
    return (
      <PermissionDenied message="Viewing client organisations needs the “View client organisations” permission." />
    );
  if (result.kind === "not_configured")
    return (
      <Alert
        tone="warning"
        title="Organisation management isn't configured yet"
      />
    );
  const org = result.data;
  if (!org) notFound();
  const [access, history] = await Promise.all([
    getPlatformAccess(),
    organisationAdmin.history(org.id),
  ]);
  const canChange =
    hasGrant(access, "tenant.suspend") &&
    (org.status === "active" || org.status === "suspended");

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/platform/organisations"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All organisations
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold md:text-3xl">{org.name}</h1>
          <p className="text-sm text-ink-muted">
            {org.slug} · created {formatDate(org.createdAt)} · {org.timezone}
          </p>
          <div className="flex flex-wrap gap-2">
            <OrganisationStatusBadge status={org.status} />
            <SubscriptionBadge status={org.subscriptionStatus} />
          </div>
        </div>
        {canChange ? (
          <OrganisationStatusControl
            tenantId={org.id}
            name={org.name}
            status={org.status as "active" | "suspended"}
          />
        ) : null}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active sites"
          value={org.activeSites}
          detail={`${org.archivedSites} inactive`}
          icon={MapPin}
        />
        <StatCard
          label="Active members"
          value={org.activeMembers}
          detail="People who can sign in"
          icon={UserCheck}
        />
        <StatCard
          label="People"
          value={org.people}
          detail="Employee records (not leavers)"
          icon={Users}
        />
        <StatCard
          label="Trial"
          value={
            org.subscriptionStatus === "trial"
              ? org.trialEndsAt
                ? formatDate(org.trialEndsAt)
                : "No end set"
              : "—"
          }
          detail={org.plan ? `Plan: ${org.plan}` : "No plan yet"}
          icon={Building2}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="owners">
          <CardTitle id="owners">Owners</CardTitle>
          {org.owners.length ? (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {org.owners.map((o) => (
                <li
                  key={`${o.name}-${o.email}`}
                  className="flex flex-col py-2.5"
                >
                  <span className="font-semibold">{o.name}</span>
                  <span className="break-all text-ink-muted">{o.email}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No active owner.</p>
          )}
          <CardDescription>
            Contact details for support. Platform staff can&apos;t see this
            organisation&apos;s employee records.
          </CardDescription>
        </Card>

        <Card aria-labelledby="history">
          <CardTitle id="history">Administration history</CardTitle>
          {history && history.length ? (
            <Table caption="Platform actions on this organisation">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">
                      {formatDate(e.occurredAt)}, {formatTime(e.occurredAt)}
                    </Td>
                    <Td>
                      {EVENT[e.action] ?? e.action}
                      {typeof e.detail.reason === "string" ? (
                        <p className="text-xs text-ink-muted">
                          {e.detail.reason}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="break-words">{e.actor ?? "System"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-muted">No platform actions yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
