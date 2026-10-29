import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { VacancyForm } from "@/features/recruitment/controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { recruitmentApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "New vacancy" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function NewVacancyPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const options = await recruitmentApi.vacancyOptions(ws);
  if (!options || "ok" in options || options.sites.length === 0)
    return (
      <PermissionDenied message="Creating vacancies needs recruitment access at a site." />
    );
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/recruitment"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Recruitment
      </Link>
      <PageHeader
        title="New vacancy"
        description="It starts as a draft. Open it when you're ready to add applicants."
      />
      <Card aria-label="Vacancy details">
        <VacancyForm options={options} />
      </Card>
    </div>
  );
}
