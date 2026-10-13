import { Power } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CategoryPage } from "@/features/platform/components";
import { AI_DEMO } from "@/features/platform/fixtures";
import { PRIVILEGED_DISABLED_REASON } from "@/lib/platform-access/policy";

export const metadata: Metadata = { title: "AI · Platform" };
export const instant = false;

export default function AiIntegrationsPage() {
  return (
    <CategoryPage category="ai">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card aria-labelledby="ai-switch">
          <CardHeader>
            <CardTitle id="ai-switch">AI for all organisations</CardTitle>
            <Badge tone={AI_DEMO.killSwitch ? "danger" : "success"}>
              {AI_DEMO.killSwitch ? "Switched off" : "On"}
            </Badge>
          </CardHeader>
          <CardDescription>
            The kill switch stops every AI request at once, whatever the feature
            settings say.
          </CardDescription>
          <Button
            variant="secondary"
            disabled
            disabledReason={PRIVILEGED_DISABLED_REASON}
          >
            <Power aria-hidden="true" />
            Turn AI on
          </Button>
        </Card>

        <Card aria-labelledby="ai-features">
          <CardTitle id="ai-features">Features</CardTitle>
          <ul className="flex flex-col gap-2 text-sm">
            {AI_DEMO.features.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2"
              >
                <span>{f.label}</span>
                <Badge tone={f.enabled ? "success" : "neutral"}>
                  {f.enabled ? "On" : "Off"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="ai-budget">
          <CardTitle id="ai-budget">Budget this month</CardTitle>
          <dl className="grid gap-2 text-sm">
            {(
              [
                ["Requests", AI_DEMO.budget.requests],
                ["Tokens", AI_DEMO.budget.tokens],
                ["Estimated spend", AI_DEMO.budget.spend],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <CardDescription>
            Requests are refused once any limit is reached. Default model:{" "}
            {AI_DEMO.defaultModel}.
          </CardDescription>
        </Card>
      </div>
      <p className="text-sm text-ink-muted">
        AI never makes hiring, disciplinary, compliance or other employment
        decisions, and a person reviews every draft. Employee personal data,
        right-to-work evidence, health and pay information are never sent to an
        AI provider without a separately approved privacy design.
      </p>
    </CategoryPage>
  );
}
