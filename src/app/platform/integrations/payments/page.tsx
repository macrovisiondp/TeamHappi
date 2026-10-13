import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { CategoryPage } from "@/features/platform/components";

export const metadata: Metadata = { title: "Payments · Platform" };
export const instant = false;

export default function PaymentsIntegrationsPage() {
  return (
    <CategoryPage category="payments">
      <Alert tone="info" title="Sandbox only">
        Live payments, real subscriptions and refunds need separate approval.
        Card details are only ever entered on the provider&apos;s own hosted
        checkout. A payment counts as paid only after a signed webhook from the
        provider, never because the browser says so.
      </Alert>
    </CategoryPage>
  );
}
