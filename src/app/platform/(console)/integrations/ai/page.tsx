import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AiControlsForm } from "@/features/platform-admin/integrations";
import { CategoryPage, when } from "@/features/platform/components";
import {
  AI_FEATURES,
  getPlatformAccess,
  hasGrant,
  integrationAdmin,
} from "@/lib/platform-access";

export const metadata: Metadata = { title: "AI · Platform" };
export const instant = false;

const FEATURE_LABEL: Record<(typeof AI_FEATURES)[number], string> = {
  "recruitment-drafts": "Recruitment message drafts",
  "job-descriptions": "Job description drafts",
  "training-drafts": "Training content drafts",
  "operational-summaries": "Operational summaries",
  "rota-suggestions": "Rota suggestions",
  "help-assistant": "Help assistant",
};

/** 1250 → "12.50", with integer arithmetic only. */
function pounds(pence: number): string {
  return `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, "0")}`;
}

async function AiControls() {
  const [read, access] = await Promise.all([
    integrationAdmin.ai(),
    getPlatformAccess(),
  ]);
  if (read.kind !== "ok") return null;
  const c = read.data;
  return (
    <Card aria-labelledby="ai-controls">
      <CardHeader>
        <CardTitle id="ai-controls">
          AI controls for all organisations
        </CardTitle>
        <Badge tone={c.killSwitch ? "danger" : "success"}>
          {c.killSwitch ? "Switched off" : "On"}
        </Badge>
      </CardHeader>
      <CardDescription>
        The kill switch stops every AI request at once, whatever the feature
        settings say. Requests are refused once any monthly limit is reached.
        Last changed: {when(c.updatedAt)}.
      </CardDescription>
      <AiControlsForm
        enabled={!c.killSwitch}
        features={AI_FEATURES.map((id) => ({ id, label: FEATURE_LABEL[id] }))}
        selected={c.features}
        requestLimit={c.requestLimit}
        tokenLimit={c.tokenLimit}
        spendLimit={pounds(c.spendLimitPence)}
        canManage={hasGrant(access, "integrations.manage")}
      />
    </Card>
  );
}

export default function AiIntegrationsPage() {
  return (
    <CategoryPage category="ai">
      <AiControls />
      <p className="text-sm text-ink-muted">
        AI never makes hiring, disciplinary, compliance or other employment
        decisions, and a person reviews every draft. Employee personal data,
        right-to-work evidence, health and pay information are never sent to an
        AI provider without a separately approved privacy design.
      </p>
    </CategoryPage>
  );
}
