"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Shows no error details; the digest lets support find the server log entry.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong"
      action={
        <Button onClick={() => retry()}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      }
    >
      <p>
        Please try again. If it keeps happening, contact your administrator.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs">Reference: {error.digest}</p>
      ) : null}
    </EmptyState>
  );
}
