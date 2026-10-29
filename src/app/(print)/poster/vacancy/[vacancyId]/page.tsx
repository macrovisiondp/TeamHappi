import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";

import { PrintButton } from "@/features/recruitment/print-button";
import { EMPLOYMENT_TYPE, payText } from "@/features/recruitment/labels";
import { requireWorkspace } from "@/features/workspace/components";
import { recruitmentApi, vacancyShareUrl } from "@/lib/workspace";

export const metadata: Metadata = {
  title: "Vacancy poster",
  robots: { index: false, follow: false },
};

// Session-gated: renders per request, not prefetch-validated.
export const instant = false;

/** A printable A4 "We're hiring" poster with the vacancy's QR code (M9.2a). */
export default function PosterPage({
  params,
}: PageProps<"/poster/vacancy/[vacancyId]">) {
  return (
    <Suspense fallback={<p className="p-8">Preparing the poster…</p>}>
      <Poster params={params} />
    </Suspense>
  );
}

async function Poster({
  params,
}: {
  params: PageProps<"/poster/vacancy/[vacancyId]">["params"];
}) {
  const ws = await requireWorkspace();
  if (ws.kind !== "ready") notFound();
  const { vacancyId } = await params;
  const data = await recruitmentApi.vacancy(ws, vacancyId);
  if (!data || "ok" in data || !data.can.manage || !data.vacancy.publicCode)
    notFound();
  const v = data.vacancy;
  const url = vacancyShareUrl(v.publicCode!, true);
  const qr = await QRCode.toDataURL(url, {
    margin: 1,
    width: 900,
    errorCorrectionLevel: "M",
  });
  const pay = v.showPay ? payText(v) : null;

  return (
    <div className="mx-auto flex max-w-[210mm] flex-col gap-6 p-8 print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton />
        <Link
          href={`/recruitment/vacancies/${v.id}`}
          className="text-sm font-semibold text-forest underline-offset-4 hover:underline"
        >
          Back to the vacancy
        </Link>
        <p className="w-full text-sm text-ink-muted">
          Choose A4 and &ldquo;fit to page&rdquo; when printing.
        </p>
      </div>
      <article
        aria-label="Poster"
        className="flex min-h-[260mm] flex-col items-center justify-between gap-8 rounded-2xl border-4 border-forest p-12 text-center print:min-h-[277mm] print:rounded-none"
      >
        <div className="flex flex-col gap-3">
          <p className="text-2xl font-bold tracking-wide text-forest uppercase">
            We&rsquo;re hiring
          </p>
          <h1 className="text-5xl leading-tight font-bold">{v.title}</h1>
          <p className="text-2xl">
            {[v.siteName, EMPLOYMENT_TYPE[v.employmentType], pay]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated on the server */}
        <img
          src={qr}
          alt={`QR code linking to the ${v.title} vacancy`}
          width={360}
          height={360}
          className="h-auto w-[90mm]"
        />
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-semibold">
            Scan to see the role and how to apply
          </p>
          <p className="text-lg break-all text-ink-muted">
            {vacancyShareUrl(v.publicCode!)}
          </p>
        </div>
      </article>
    </div>
  );
}
