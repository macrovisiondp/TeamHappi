import { UserX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function EmployeeNotFound() {
  return (
    <EmptyState
      icon={UserX}
      title="We couldn't find that person"
      action={
        <Button asChild variant="secondary">
          <Link href="/demo/people">Back to people</Link>
        </Button>
      }
    >
      They may have been removed, or the link may be wrong.
    </EmptyState>
  );
}
