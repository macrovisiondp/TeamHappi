import { ShieldX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown when the server refuses an action or page (403). Never a client-side check. */
export function PermissionDenied({
  message = "Your role doesn't include this page. If you need it, ask an owner or administrator in your organisation.",
}: {
  message?: string;
}) {
  return (
    <EmptyState
      icon={ShieldX}
      title="You don't have access to this"
      action={
        <Button asChild variant="secondary">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    >
      {message}
    </EmptyState>
  );
}

export function SectionHeading({
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}) {
  return (
    <h2 id={id} className="text-lg font-semibold">
      {children}
    </h2>
  );
}
