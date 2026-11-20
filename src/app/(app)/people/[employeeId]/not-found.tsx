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
          <Link href="/people">Back to people</Link>
        </Button>
      }
    >
      Their record may have been removed, or they may work at a site you
      don&rsquo;t manage.
    </EmptyState>
  );
}
