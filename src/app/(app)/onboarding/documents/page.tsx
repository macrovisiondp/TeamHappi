import { FileText } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import {
  ArchivePolicyButton,
  UploadPolicyForm,
} from "@/features/signing/controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { OnboardingTabs } from "@/features/onboarding/labels";
import { formatDate } from "@/lib/format";
import { signingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Documents to sign" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/** M13: the organisation's library of policies that new starters sign. */
export default async function DocumentsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const lib = await signingApi.library(ws);
  if (!lib)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Documents to sign" />
        <EmptyState icon={FileText} title="Not available for your role">
          Documents to sign are managed by owners, administrators and HR
          managers.
        </EmptyState>
      </div>
    );
  const storage = await signingApi.storageReady();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents to sign"
        description="Policies everyone signs. Send them, with a person's own contract, from their record under People."
      />
      <OnboardingTabs
        current="documents"
        showTemplates={ws.grants.get("onboarding.template.manage") === "all"}
        showDocuments
      />
      {!storage ? (
        <Alert tone="warning" title="Document storage isn't switched on yet">
          Uploads need private storage. Ask your TeamHappi administrator to
          switch it on.
        </Alert>
      ) : null}
      {lib.length ? (
        <ul className="flex flex-col gap-2" aria-label="Policy library">
          {lib.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line-strong p-3 text-sm"
            >
              <div>
                <p className="font-semibold">{d.title}</p>
                <p className="text-ink-muted">
                  {d.fileName} · added {formatDate(d.uploadedAt)}
                </p>
              </div>
              <ArchivePolicyButton id={d.id} title={d.title} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={FileText} title="No policies yet">
          Add your first policy below.
        </EmptyState>
      )}
      {storage ? (
        <Card aria-labelledby="add-policy" className="gap-3">
          <CardTitle id="add-policy">Add a policy</CardTitle>
          <p className="text-sm text-ink-muted">
            Upload the final version as a PDF. Each person signs the exact file
            you upload. To change it later, add the new version and remove the
            old one.
          </p>
          <UploadPolicyForm />
        </Card>
      ) : null}
    </div>
  );
}
