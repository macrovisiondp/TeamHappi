"use client";

import { CloudOff, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// A friendly page when something fails to load. No technical details are shown;
// the support code (Next's digest) is small and only for TeamHappi support,
// who can find the matching server log entry.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <EmptyState
      icon={CloudOff}
      title="This page didn't load"
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => retry()}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
        </div>
      }
    >
      <p>
        It&rsquo;s usually a brief connection problem. Your work so far is
        saved.
      </p>
      {error.digest ? (
        <p className="mt-3 text-xs text-ink-muted">
          {`If it keeps happening, contact support and mention code ${error.digest}.`}
        </p>
      ) : null}
    </EmptyState>
  );
}
