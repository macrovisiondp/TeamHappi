import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { EMPLOYMENT_TYPE } from "@/features/recruitment/labels";
import { PublicApplyForm } from "@/features/recruitment/public-apply-form";
import { formatDate } from "@/lib/format";
import { getPublicVacancy, onlineCvUploadsOn } from "@/lib/workspace";

export const metadata: Metadata = {
  title: "Job vacancy",
  // Shared links are unlisted: keep them out of search engines.
  robots: { index: false, follow: false },
};

/**
 * A shared vacancy (M9.2a). Shows only what the employer published, while the
 * vacancy is open, and (M9.3) an application form. No cookies or tracking
 * beyond a count of opens (link or QR).
 */
export default function PublicVacancyPage({
  params,
  searchParams,
}: PageProps<"/jobs/[code]">) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Vacancy params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Vacancy({
  params,
  searchParams,
}: {
  params: PageProps<"/jobs/[code]">["params"];
  searchParams: PageProps<"/jobs/[code]">["searchParams"];
}) {
  const { code } = await params;
  const q = await searchParams;
  const source = q.s === "qr" ? "qr" : "link";
  const v = await getPublicVacancy(code, source);
  if (v.state === "missing") notFound();
  if (v.state === "closed")
    return (
      <Card className="gap-3">
        <p className="text-sm text-ink-muted">{v.organisation}</p>
        <h1 className="text-2xl font-bold">{v.title}</h1>
        <Alert
          tone="info"
          title="This role is no longer accepting applications"
        >
          Thank you for your interest. Ask {v.organisation} about other roles.
        </Alert>
      </Card>
    );
  const per = v.pay?.period === "year" ? "a year" : "an hour";
  const pay = v.pay
    ? v.pay.max && v.pay.max !== v.pay.min
      ? `£${v.pay.min}–£${v.pay.max} ${per}`
      : `£${v.pay.min} ${per}`
    : null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-forest">
          {v.organisation} is hiring
        </p>
        <h1 className="text-3xl font-bold">{v.title}</h1>
        <p className="text-base text-ink-muted">
          {[v.siteName, EMPLOYMENT_TYPE[v.employmentType] ?? null, pay]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {v.closesOn ? (
          <p className="text-sm">Closing date: {formatDate(v.closesOn)}</p>
        ) : null}
      </div>
      {v.description ? (
        <Card aria-labelledby="about-heading" className="gap-2">
          <CardTitle id="about-heading">About the role</CardTitle>
          <p className="text-base whitespace-pre-line">{v.description}</p>
        </Card>
      ) : null}
      <Card aria-labelledby="apply-heading" className="gap-4">
        <CardTitle id="apply-heading">Apply for this role</CardTitle>
        <PublicApplyForm
          code={code}
          organisation={v.organisation}
          retentionMonths={v.retentionMonths}
          cvUploads={await onlineCvUploadsOn()}
        />
      </Card>
      {v.howToApply ? (
        <Card aria-labelledby="other-heading" className="gap-2">
          <CardTitle id="other-heading">Other ways to apply</CardTitle>
          <p className="text-base whitespace-pre-line">{v.howToApply}</p>
        </Card>
      ) : null}
      <p className="text-xs text-ink-muted">
        This page is shared by {v.organisation} through TeamHappi. It uses no
        cookies or tracking; your details are only sent if you apply.
      </p>
    </>
  );
}
