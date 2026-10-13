import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { CategoryPage } from "@/features/platform/components";

export const metadata: Metadata = { title: "Storage · Platform" };
export const instant = false;

export default function StorageIntegrationsPage() {
  return (
    <CategoryPage category="storage">
      <Alert tone="warning" title="Document uploads are switched off">
        Real HR and compliance documents can&apos;t be uploaded until the
        storage security design is approved. That design covers private,
        encrypted buckets in London, five-minute links, malware scanning, file
        type and size limits, retention and audit.
      </Alert>
    </CategoryPage>
  );
}
