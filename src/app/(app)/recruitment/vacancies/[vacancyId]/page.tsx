import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import {
  AddApplicantForm,
  EmailNotice,
  VacancyForm,
  VacancyStatusControl,
} from "@/features/recruitment/controls";
import {
  EMPLOYMENT_TYPE,
  OUTCOME,
  VACANCY_STATUS,
  payText,
} from "@/features/recruitment/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { SharePanel } from "@/features/recruitment/share-panel";
import { recruitmentApi, vacancyShareUrl } from "@/lib/workspace";

export const metadata: Metadata = { title: "Vacancy" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const WORKING = [
  "applied",
  "screening",
  "shortlisted",
  "interview",
  "offer",
] as const;

export default async function VacancyPage({
  params,
  searchParams,
}: PageProps<"/recruitment/vacancies/[vacancyId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { vacancyId } = await params;
  const q = await searchParams;
  // Other organisations' vacancies and other sites' look like nothing: 404.
  const data = await recruitmentApi.vacancy(ws, vacancyId);
  if (!data || "ok" in data) notFound();
  const v = data.vacancy;
  const email = typeof q.email === "string" ? q.email : "";
  const matchesRes =
    data.can.manage && email
      ? await recruitmentApi.possibleMatches(ws, email)
      : [];
  const matches = Array.isArray(matchesRes) ? matchesRes : [];
  const pay = payText(v);
  const closed = data.applications.filter((a) => a.outcome !== "active");
  const accepting = v.status !== "closed" && v.status !== "filled";
  // M9.2a: share link and QR code (the QR link is counted separately).
  const shareUrl = v.publicCode ? vacancyShareUrl(v.publicCode) : null;
  const qrDataUrl = v.publicCode
    ? await QRCode.toDataURL(vacancyShareUrl(v.publicCode, true), {
        margin: 1,
        width: 320,
        errorCorrectionLevel: "M",
      })
    : null;

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
        title={v.title}
        description={[
          v.siteName,
          EMPLOYMENT_TYPE[v.employmentType],
          `${data.hired} of ${v.openings} hired`,
          pay,
          v.closesOn ? `closes ${formatDate(v.closesOn)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Badge tone={VACANCY_STATUS[v.status]!.tone}>
            {VACANCY_STATUS[v.status]!.label}
          </Badge>
        }
      />
      {data.can.manage ? (
        <VacancyStatusControl vacancyId={v.id} status={v.status} />
      ) : null}
      {data.can.manage &&
      data.hired >= v.openings &&
      v.status !== "filled" &&
      v.status !== "closed" ? (
        <p className="text-sm font-semibold">
          Every opening has been filled. You may want to mark the vacancy as
          filled.
        </p>
      ) : null}
      <EmailNotice />

      <section
        aria-labelledby="pipeline-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="pipeline-heading" className="text-lg font-semibold">
          Pipeline
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {WORKING.map((s) => {
            const apps = data.applications.filter(
              (a) => a.outcome === "active" && a.stage === s,
            );
            return (
              <Card
                key={s}
                aria-label={`${data.labels[s]}: ${apps.length}`}
                className="gap-2"
              >
                <CardTitle>
                  {data.labels[s]}{" "}
                  <span className="text-ink-muted">({apps.length})</span>
                </CardTitle>
                {apps.length ? (
                  <ul className="flex flex-col gap-1">
                    {apps.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/recruitment/applications/${a.id}`}
                          className="text-sm font-semibold underline-offset-4 hover:underline"
                        >
                          {a.name}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          Applied {formatDate(a.appliedOn)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">Nobody</p>
                )}
              </Card>
            );
          })}
        </div>
        {closed.length ? (
          <details className="rounded-[10px] border border-line p-3">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
              Closed applications ({closed.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {closed.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/recruitment/applications/${a.id}`}
                    className="text-sm font-semibold underline-offset-4 hover:underline"
                  >
                    {a.name}
                  </Link>
                  <Badge tone={OUTCOME[a.outcome]!.tone}>
                    {OUTCOME[a.outcome]!.label}
                  </Badge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {data.can.manage && accepting ? (
        <Card aria-labelledby="add-heading">
          <CardHeader>
            <div>
              <CardTitle id="add-heading">Add an applicant</CardTitle>
              <CardDescription>
                Check first whether they&rsquo;ve applied before. Candidates are
                never merged automatically.
              </CardDescription>
            </div>
          </CardHeader>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3"
            aria-label="Check for an existing candidate"
          >
            <Field id="check-email" label="Their email (to check)">
              <Input
                id="check-email"
                name="email"
                type="email"
                defaultValue={email}
              />
            </Field>
            <Button type="submit" variant="secondary">
              Check
            </Button>
          </form>
          {email ? (
            <p className="text-sm" role="status">
              {matches.length
                ? `${matches.length} existing candidate${matches.length === 1 ? "" : "s"} use${matches.length === 1 ? "s" : ""} this email.`
                : "No existing candidate uses this email."}
            </p>
          ) : null}
          <AddApplicantForm
            key={email}
            vacancyId={v.id}
            matches={matches}
            email={email}
          />
        </Card>
      ) : null}

      {data.can.manage ? (
        <Card aria-labelledby="share-heading">
          <CardHeader>
            <div>
              <CardTitle id="share-heading">Share this vacancy</CardTitle>
              <CardDescription>
                A link and QR code for posters and social media. No one can
                apply through it yet: it shows the role and how to apply.
              </CardDescription>
            </div>
          </CardHeader>
          <SharePanel
            vacancyId={v.id}
            shareUrl={shareUrl}
            qrDataUrl={qrDataUrl}
            views={{ link: v.shareViewsLink, qr: v.shareViewsQr }}
            howToApply={v.howToApply}
            showPay={v.showPay}
            hasPay={v.payMin !== null}
            isOpen={v.status === "open"}
          />
        </Card>
      ) : null}

      {data.can.manage && data.options ? (
        <Card aria-labelledby="edit-heading">
          <CardTitle id="edit-heading">Vacancy details</CardTitle>
          <VacancyForm options={data.options} vacancy={v} />
        </Card>
      ) : null}
    </div>
  );
}
