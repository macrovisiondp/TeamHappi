import { Building2, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  OrganisationStatusBadge,
  SubscriptionBadge,
} from "@/features/platform-admin/organisation-badges";
import { formatDate } from "@/lib/format";
import { organisationAdmin } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Organisations · Platform" };
export const instant = false;

export default async function OrganisationsPage({
  searchParams,
}: PageProps<"/platform/organisations">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const result = await organisationAdmin.list(query);
  if (result.kind === "forbidden")
    return (
      <PermissionDenied message="Viewing client organisations needs the “View client organisations” permission." />
    );
  if (result.kind === "not_configured")
    return (
      <Alert
        tone="warning"
        title="Organisation management isn't configured yet"
      >
        This deployment has no platform database connection
        (PLATFORM_DATABASE_URL). See docs/operations/m5.2-neon-approval.md.
      </Alert>
    );
  const orgs = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Client organisations"
        description="Every organisation on TeamHappi, with summary figures. Employee records stay private to each organisation."
      />
      <form
        role="search"
        aria-label="Find an organisation"
        className="flex flex-wrap items-end gap-3"
      >
        <Field id="org-search" label="Search by name">
          <Input
            id="org-search"
            name="q"
            type="search"
            defaultValue={query}
            className="max-w-sm"
          />
        </Field>
        <Button type="submit" variant="secondary">
          <Search aria-hidden="true" />
          Search
        </Button>
      </form>
      <p role="status" className="text-sm text-ink-muted">
        {orgs.length} {orgs.length === 1 ? "organisation" : "organisations"}
        {query ? ` matching “${query}”` : ""}
      </p>
      {orgs.length === 0 ? (
        <EmptyState icon={Building2} title="No organisations found" />
      ) : (
        <Table caption="Client organisations">
          <thead>
            <tr>
              <Th>Organisation</Th>
              <Th>Status</Th>
              <Th>Subscription</Th>
              <Th className="text-right">Sites</Th>
              <Th className="text-right">Members</Th>
              <Th className="text-right">People</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <Td>
                  <Link
                    href={`/platform/organisations/${o.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {o.name}
                  </Link>
                  <p className="text-xs text-ink-muted">{o.slug}</p>
                </Td>
                <Td>
                  <OrganisationStatusBadge status={o.status} />
                </Td>
                <Td>
                  <SubscriptionBadge status={o.subscriptionStatus} />
                  {o.subscriptionStatus === "trial" && o.trialEndsAt ? (
                    <p className="text-xs text-ink-muted">
                      Ends {formatDate(o.trialEndsAt)}
                    </p>
                  ) : null}
                </Td>
                <Td className="text-right">{o.activeSites}</Td>
                <Td className="text-right">{o.activeMembers}</Td>
                <Td className="text-right">{o.people}</Td>
                <Td className="whitespace-nowrap">{formatDate(o.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
