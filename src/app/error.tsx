"use client";

import { Button } from "@/components/ui/button";

// Shows no error details to the user; the digest lets support find the server log entry.
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-4 outline-none"
    >
      <h1 className="text-2xl font-bold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        Please try again. If the problem continues, contact your administrator.
      </p>
      {error.digest ? (
        <p className="text-sm text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div>
        <Button onClick={() => retry()}>Try again</Button>
      </div>
    </main>
  );
}
