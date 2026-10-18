import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { TemplateCommand, TemplateForm } from "@/features/onboarding/controls";
import { OnboardingTabs, SCOPE_LABEL } from "@/features/onboarding/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { listSites, onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Onboarding templates" };
export const instant = false;

export default async function OnboardingTemplatesPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (ws.grants.get("onboarding.template.manage") !== "all")
    return (
      <PermissionDenied message="Managing onboarding templates needs an owner, administrator or HR manager." />
    );
  const [templates, sites] = await Promise.all([
    onboardingApi.listTemplates(ws, true),
    listSites(ws),
  ]);
  const active = (templates ?? []).filter((t) => !t.archived);
  const archived = (templates ?? []).filter((t) => t.archived);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Onboarding"
        description="Templates are checklists you reuse. Each onboarding takes its own copy when it starts."
      />
      <OnboardingTabs current="templates" showTemplates />

      <Card aria-labelledby="suggested-heading">
        <CardHeader>
          <div>
            <CardTitle id="suggested-heading">
              Suggested UK hospitality templates
            </CardTitle>
            <CardDescription>
              Starting points for kitchen, front-of-house and bar teams. They
              are suggestions, not legal advice: review and edit them to fit
              your business. They don&rsquo;t include right-to-work checks,
              which are recorded separately.
            </CardDescription>
          </div>
        </CardHeader>
        <TemplateCommand
          intent="add-suggested"
          label="Add suggested templates"
          variant="primary"
        />
      </Card>

      <section
        aria-labelledby="templates-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="templates-heading" className="text-lg font-semibold">
          Your templates ({active.length})
        </h2>
        {active.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No templates yet">
            Add the suggested templates above, or create your own below.
          </EmptyState>
        ) : (
          <Table caption="Onboarding templates">
            <thead>
              <tr>
                <Th>Template</Th>
                <Th>Used for</Th>
                <Th className="text-right">Tasks</Th>
                <Th className="text-right">Version</Th>
              </tr>
            </thead>
            <tbody>
              {active.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link
                      href={`/onboarding/templates/${t.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {t.name}
                    </Link>
                    {t.isSuggested ? (
                      <Badge tone="info" icon={null} className="ml-2">
                        Suggested
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>{SCOPE_LABEL(t)}</Td>
                  <Td className="text-right tabular-nums">
                    {t.taskCount} ({t.requiredCount} required)
                  </Td>
                  <Td className="text-right tabular-nums">v{t.version}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <Card aria-labelledby="new-template-heading">
        <CardTitle id="new-template-heading">Create a template</CardTitle>
        <TemplateForm
          sites={(sites ?? [])
            .filter((s) => s.status === "active")
            .map((s) => ({ id: s.id, name: s.name }))}
        />
      </Card>

      {archived.length ? (
        <p className="text-sm text-ink-muted">
          Archived: {archived.map((t) => t.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
