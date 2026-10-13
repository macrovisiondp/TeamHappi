import { MailWarning } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { CategoryPage } from "@/features/platform/components";

export const metadata: Metadata = { title: "Email · Platform" };
export const instant = false;

export default function EmailIntegrationsPage() {
  return (
    <CategoryPage category="email">
      <Alert tone="info" title="How email delivery is protected">
        <ul className="list-disc pl-5">
          <li>
            Test emails can only go to reserved test domains such as
            example.test.
          </li>
          <li>
            Fallback to a second provider happens only when the first one
            definitely did not accept the message, so nobody gets it twice.
          </li>
          <li>Message bodies and links are never written to logs.</li>
        </ul>
      </Alert>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <MailWarning aria-hidden="true" className="size-4" />
        Delivery failures in the last 24 hours: 0
      </p>
    </CategoryPage>
  );
}
