import { Building2, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/misc";
import { NoOrganisation } from "@/features/workspace/components";
import { getWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Choose an organisation" };
export const instant = false;

export default async function OrganisationsPage({
  searchParams,
}: PageProps<"/organisations">) {
  const ws = await getWorkspace();
  if (!ws) redirect("/sign-in");
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { error } = await searchParams;
  const current = ws.kind === "ready" ? ws.tenant.id : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Choose an organisation"
        description="You belong to more than one organisation. Pick the one you want to work in; you can switch at any time from the top bar."
      />
      {error ? (
        <Alert
          tone="warning"
          title="That organisation isn't available"
          role="alert"
        >
          Your access may have changed. Choose one of the organisations below.
        </Alert>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {ws.memberships.map((m) => (
          <li key={m.tenantId}>
            <form action="/api/v1/workspace/select" method="post">
              <input type="hidden" name="tenantId" value={m.tenantId} />
              <button
                type="submit"
                className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card hover:bg-sage"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-forest">
                  <Building2 aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.name}</span>
                  {m.tenantId === current ? (
                    <span className="text-sm text-ink-muted">Current</span>
                  ) : null}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 text-ink-muted"
                />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
