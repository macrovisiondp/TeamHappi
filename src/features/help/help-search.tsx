"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/field";

import type { HelpArticle } from "./articles";

const GROUPS = [
  { audience: "managers", title: "For owners and managers" },
  { audience: "staff", title: "For staff" },
] as const;

/** The help centre's list of guides, with a search box. */
export function HelpSearch({ articles }: { articles: HelpArticle[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return articles;
    return articles.filter((a) => {
      const text = [
        a.title,
        a.summary,
        ...a.sections.flatMap((s) => [
          s.heading,
          ...(s.text ?? []),
          ...(s.steps ?? []),
          ...(s.tips ?? []),
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [q, articles]);

  return (
    <div className="flex flex-col gap-8">
      <label className="relative block">
        <span className="sr-only">Search help</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
        />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search, for example “clock in” or “contract”"
          className="h-14 rounded-full pl-12 text-base"
        />
      </label>
      {shown.length === 0 ? (
        <p className="text-base">
          No guides match that. Try other words, or ask your manager.
        </p>
      ) : (
        GROUPS.map((g) => {
          const list = shown.filter((a) => a.audience === g.audience);
          if (!list.length) return null;
          return (
            <section key={g.audience} aria-labelledby={`h-${g.audience}`}>
              <h2
                id={`h-${g.audience}`}
                className="mb-3 text-sm font-semibold tracking-wide text-ink-muted uppercase"
              >
                {g.title}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {list.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`/help/${a.slug}`}
                      className="group flex h-full items-start gap-3 rounded-xl border border-line bg-surface p-4 hover:border-forest/40 hover:shadow-sm"
                    >
                      <span className="flex flex-1 flex-col gap-1">
                        <span className="font-semibold">{a.title}</span>
                        <span className="text-sm text-ink-muted">
                          {a.summary}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-ink-muted group-hover:text-forest"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
