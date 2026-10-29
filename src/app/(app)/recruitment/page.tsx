import { BriefcaseBusiness, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  EMPLOYMENT_TYPE,
  RecruitmentTabs,
  VACANCY_STATUS,
} from "@/features/recruitment/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { recruitmentApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Recruitment" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const STATUS_OPTIONS = [
  { value: "", label: "Open, paused and draft" },
  { value: "open", label: "Open" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "filled", label: "Filled" },
  { value: "closed", label: "Closed" },
];

export default async function RecruitmentPage({
  searchParams,
}: PageProps<"/recruitment">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const p = await searchParams;
  const status = typeof p.status === "string" ? p.status : "";
  const siteId = typeof p.site === "string" ? p.site : "";
  const data = await recruitmentApi.vacancies(ws, { status, siteId });
  // People without recruitment access may still be interviewers.
  if (!data) redirect("/recruitment/interviews");
  if ("ok" in data) throw new Error("Unexpected recruitment result");
  const settingsAccess = ws.grants.get("recruitment.settings") === "all";
  const create = data.canCreate ? (
    <Button asChild>
      <Link href="/recruitment/vacancies/new">
        <Plus aria-hidden="true" />
        New vacancy
      </Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recruitment"
        description="Vacancies, applicants and interviews, from first contact to hire."
        actions={create}
      />
      <RecruitmentTabs
        current="vacancies"
        show={{
          vacancies: true,
          review: settingsAccess,
          settings: settingsAccess,
        }}
      />
      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter vacancies"
      >
        <Field id="filter-status" label="Show">
          <Select id="filter-status" name="status" defaultValue={status}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {data.sites.length > 1 ? (
          <Field id="filter-site" label="Site">
            <Select id="filter-site" name="site" defaultValue={siteId}>
              <option value="">All your sites</option>
              {data.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {data.vacancies.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No vacancies here"
          action={create ?? undefined}
        >
          Create a vacancy, then add applicants as they get in touch.
        </EmptyState>
      ) : (
        <Table caption="Vacancies">
          <thead>
            <tr>
              <Th>Vacancy</Th>
              <Th>Status</Th>
              <Th>In progress</Th>
              <Th>{data.labels.interview}</Th>
              <Th>{data.labels.offer}</Th>
              <Th>Hired</Th>
              <Th>Closes</Th>
            </tr>
          </thead>
          <tbody>
            {data.vacancies.map((v) => (
              <tr key={v.id}>
                <Td>
                  <Link
                    href={`/recruitment/vacancies/${v.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {v.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {v.siteName} · {EMPLOYMENT_TYPE[v.employmentType]}
                  </p>
                </Td>
                <Td>
                  <Badge tone={VACANCY_STATUS[v.status]!.tone}>
                    {VACANCY_STATUS[v.status]!.label}
                  </Badge>
                </Td>
                <Td>{v.active}</Td>
                <Td>{v.counts.interview}</Td>
                <Td>{v.counts.offer}</Td>
                <Td>
                  {v.hired} of {v.openings}
                </Td>
                <Td>{v.closesOn ? formatDate(v.closesOn) : "–"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
