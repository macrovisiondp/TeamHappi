import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HELP_ARTICLES, articleBySlug } from "@/features/help/articles";

// Guides are small; render on request (no prefetch validation needed).
export const instant = false;

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/help/[slug]">): Promise<Metadata> {
  const a = articleBySlug((await params).slug);
  return { title: a ? `${a.title} · Help` : "Help" };
}

export default async function HelpArticlePage({
  params,
}: PageProps<"/help/[slug]">) {
  const a = articleBySlug((await params).slug);
  if (!a) notFound();
  const related = HELP_ARTICLES.filter(
    (x) => x.audience === a.audience && x.slug !== a.slug,
  ).slice(0, 4);
  return (
    <article className="flex max-w-3xl flex-col gap-8">
      <Link
        href="/help"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All guides
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink-muted">
          {a.audience === "staff" ? "For staff" : "For owners and managers"}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{a.title}</h1>
        <p className="text-lg text-ink-muted">{a.summary}</p>
      </header>
      {a.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{s.heading}</h2>
          {s.text?.map((t) => (
            <p key={t} className="text-base leading-relaxed">
              {t}
            </p>
          ))}
          {s.steps ? (
            <ol className="flex flex-col gap-3">
              {s.steps.map((step, i) => (
                <li key={step} className="flex gap-3 text-base leading-relaxed">
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-sage text-sm font-semibold text-forest"
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {s.tips ? (
            <ul className="flex flex-col gap-2 rounded-xl bg-sage/60 p-4">
              {s.tips.map((t) => (
                <li key={t} className="text-base leading-relaxed">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {related.length ? (
        <nav aria-label="More guides" className="border-t border-line pt-6">
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">
            More guides
          </h2>
          <ul className="flex flex-col gap-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/help/${r.slug}`}
                  className="font-semibold text-forest underline-offset-4 hover:underline"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </article>
  );
}
