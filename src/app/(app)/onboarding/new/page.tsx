import { ArrowLeft, ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { StartOnboardingForm } from "@/features/onboarding/controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Start onboarding" };
export const instant = false;

export default async function StartOnboardingPage({
  searchParams,
}: PageProps<"/onboarding/new">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const options = await onboardingApi.startOptions(ws);
  if (!options)
    return (
      <PermissionDenied message="Your role doesn't include starting onboarding." />
    );
  const { employee } = await searchParams;
  const canTemplates = ws.grants.get("onboarding.template.manage") === "all";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/onboarding"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Onboarding
      </Link>
      <PageHeader
        title="Start onboarding"
        description="Choose the person and a template. The template's tasks are copied, so later template changes won't affect this onboarding."
      />
      {options.templates.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No templates yet"
          action={
            canTemplates ? (
              <Button asChild>
                <Link href="/onboarding/templates">Set up templates</Link>
              </Button>
            ) : undefined
          }
        >
          {canTemplates
            ? "Create a template first, or add the suggested hospitality templates."
            : "Ask an owner or HR manager to set up an onboarding template."}
        </EmptyState>
      ) : options.employees.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nobody to onboard"
          action={
            <Button asChild>
              <Link href="/people/new">Add a person</Link>
            </Button>
          }
        >
          Everyone you can see already has onboarding in progress, or has left.
          Add the new starter to People first.
        </EmptyState>
      ) : (
        <Card>
          <StartOnboardingForm
            employees={options.employees}
            templates={options.templates}
            members={options.members}
            selfMembershipId={ws.membershipId}
            preselect={typeof employee === "string" ? employee : undefined}
          />
        </Card>
      )}
    </div>
  );
}
