import { BrainCircuit, CreditCard, HardDrive, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  ENVIRONMENT_LABEL,
  NotConfiguredNotice,
  PreviewNotice,
  when,
} from "@/features/platform/components";
import {
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
} from "@/features/platform/labels";
import { getProvider } from "@/integrations/registry";
import { integrationAdmin } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Integrations · Platform" };
export const instant = false;

const ICONS = {
  email: Mail,
  storage: HardDrive,
  payments: CreditCard,
  ai: BrainCircuit,
} as const;

export default async function IntegrationsPage() {
  const read = await integrationAdmin.overview();
  if (read.kind === "forbidden") return <PermissionDenied />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="External services behind TeamHappi. Business features use one interface per service, so a provider can change without rewriting them."
      />
      <PreviewNotice />
      {read.kind === "not_configured" ? (
        <NotConfiguredNotice />
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Environment: {ENVIRONMENT_LABEL[read.data[0]!.environment]}
          </p>
          <ul className="grid gap-4 md:grid-cols-2">
            {read.data.map((state) => {
              const Icon = ICONS[state.category];
              const active = state.activeProviderId
                ? getProvider(state.activeProviderId)
                : undefined;
              const headingId = `cat-${state.category}`;
              return (
                <li key={state.category} className="flex">
                  <Card aria-labelledby={headingId} className="w-full">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-forest">
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <CardTitle id={headingId}>
                          <Link
                            href={`/platform/integrations/${state.category}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {CATEGORY_LABEL[state.category]}
                          </Link>
                        </CardTitle>
                        <CardDescription>
                          {CATEGORY_DESCRIPTION[state.category]}
                        </CardDescription>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-ink-muted">Active provider</dt>
                        <dd className="font-semibold">
                          {active?.name ?? "None"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Since</dt>
                        <dd>{active ? when(state.activatedAt) : "Not set"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-ink-muted">Supported providers</dt>
                        <dd>
                          {state.providers
                            .map((p) => getProvider(p.providerId)?.name)
                            .join(", ")}
                        </dd>
                      </div>
                    </dl>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
