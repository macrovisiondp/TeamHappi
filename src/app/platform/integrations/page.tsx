import { BrainCircuit, CreditCard, HardDrive, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { HealthBadge, PreviewNotice } from "@/features/platform/components";
import {
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
  PROVIDER_STATE,
} from "@/features/platform/fixtures";
import { SERVICE_CATEGORIES } from "@/integrations/core/types";
import { providersFor } from "@/integrations/registry";

export const metadata: Metadata = { title: "Integrations · Platform" };
export const instant = false;

const ICONS = {
  email: Mail,
  storage: HardDrive,
  payments: CreditCard,
  ai: BrainCircuit,
} as const;

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        demo
        description="External services behind TeamHappi. Business features use one interface per service, so a provider can change without rewriting them."
      />
      <PreviewNotice />
      <ul className="grid gap-4 md:grid-cols-2">
        {SERVICE_CATEGORIES.map((category) => {
          const Icon = ICONS[category];
          const providers = providersFor(category);
          const active = providers.find((p) => PROVIDER_STATE[p.id]?.active);
          const headingId = `cat-${category}`;
          return (
            <li key={category} className="flex">
              <Card aria-labelledby={headingId} className="w-full">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-forest">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle id={headingId}>
                      <Link
                        href={`/platform/integrations/${category}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {CATEGORY_LABEL[category]}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {CATEGORY_DESCRIPTION[category]}
                    </CardDescription>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-ink-muted">Active provider</dt>
                    <dd className="font-semibold">{active?.name ?? "None"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Health</dt>
                    <dd>
                      <HealthBadge
                        status={
                          active
                            ? (PROVIDER_STATE[active.id]?.health ?? "unknown")
                            : "not-configured"
                        }
                      />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-ink-muted">Supported providers</dt>
                    <dd>{providers.map((p) => p.name).join(", ")}</dd>
                  </div>
                </dl>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
