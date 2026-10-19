import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PermissionDenied } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  TemplateCommand,
  TemplateForm,
  TemplateTaskForm,
} from "@/features/onboarding/controls";
import { CATEGORY_LABEL, OWNER_LABEL } from "@/features/onboarding/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { listSites, onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Onboarding template" };
export const instant = false;

const dueText = (d: number) =>
  d === 0
    ? "On the first day"
    : d < 0
      ? `${-d} day${d === -1 ? "" : "s"} before the start`
      : `${d} day${d === 1 ? "" : "s"} after the start`;

export default async function OnboardingTemplatePage({
  params,
}: PageProps<"/onboarding/templates/[templateId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  if (ws.grants.get("onboarding.template.manage") !== "all")
    return (
      <PermissionDenied message="Managing onboarding templates needs an owner, administrator or HR manager." />
    );
  const { templateId } = await params;
  const [t, sites] = await Promise.all([
    onboardingApi.getTemplate(ws, templateId),
    listSites(ws),
  ]);
  if (!t) notFound();
  const archived = t.archivedAt !== null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/onboarding/templates"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Templates
      </Link>
      <PageHeader
        title={t.name}
        description={`Version ${t.version}. Changes apply to onboarding started from now on; onboarding already started keeps its own copy.`}
        actions={
          t.isSuggested ? (
            <Badge tone="info" icon={null}>
              Suggested: review before use
            </Badge>
          ) : undefined
        }
      />

      {archived ? (
        <p className="text-sm">This template is archived.</p>
      ) : (
        <>
          <section
            aria-labelledby="tasks-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="tasks-heading" className="text-lg font-semibold">
              Tasks ({t.tasks.length})
            </h2>
            <ol className="flex flex-col gap-3">
              {t.tasks.map((task) => (
                <li key={task.id}>
                  <Card aria-label={task.title} className="gap-3">
                    <CardHeader>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-semibold">{task.title}</span>
                        <span className="text-sm text-ink-muted">
                          {CATEGORY_LABEL[task.category]} ·{" "}
                          {OWNER_LABEL[task.ownerKind]} ·{" "}
                          {dueText(task.dueOffsetDays)} ·{" "}
                          {task.required ? "Required" : "Optional"}
                        </span>
                      </div>
                      <TemplateCommand
                        templateId={t.id}
                        taskId={task.id}
                        intent="remove-task"
                        label={`Remove`}
                        confirm={{
                          title: `Remove "${task.title}"?`,
                          description:
                            "It won't be copied into new onboarding. Onboarding already started keeps it.",
                        }}
                      />
                    </CardHeader>
                    <details>
                      <summary className="inline-flex min-h-6 cursor-pointer items-center text-sm font-semibold text-forest">
                        Edit<span className="sr-only"> {task.title}</span>
                      </summary>
                      <div className="pt-3">
                        <TemplateTaskForm templateId={t.id} task={task} />
                      </div>
                    </details>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <Card aria-labelledby="add-task-heading">
            <CardTitle id="add-task-heading">Add a task</CardTitle>
            <CardDescription>
              Don&rsquo;t add right-to-work checks as tasks: they&rsquo;ll be
              recorded separately, with their own safeguards.
            </CardDescription>
            <TemplateTaskForm templateId={t.id} />
          </Card>

          <Card aria-labelledby="details-heading">
            <CardTitle id="details-heading">Template details</CardTitle>
            <TemplateForm
              template={{
                id: t.id,
                name: t.name,
                description: t.description,
                scope: t.scope,
                siteId: t.siteId,
                jobTitle: t.jobTitle,
              }}
              sites={(sites ?? [])
                .filter((s) => s.status === "active")
                .map((s) => ({ id: s.id, name: s.name }))}
            />
          </Card>

          <TemplateCommand
            templateId={t.id}
            intent="archive"
            label="Archive template"
            variant="danger"
            confirm={{
              title: `Archive ${t.name}?`,
              description:
                "It can't be used for new onboarding. Onboarding already started isn't affected.",
            }}
          />
        </>
      )}
    </div>
  );
}
