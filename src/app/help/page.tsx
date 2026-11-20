import type { Metadata } from "next";

import { HELP_ARTICLES } from "@/features/help/articles";
import { HelpSearch } from "@/features/help/help-search";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">How can we help?</h1>
        <p className="text-base text-ink-muted">
          Short guides to getting things done in TeamHappi.
        </p>
      </div>
      <HelpSearch articles={HELP_ARTICLES} />
    </div>
  );
}
