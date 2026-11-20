import { FileText } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import {
  ArchivePackButton,
  ArchivePolicyButton,
  StarterPackForm,
  UploadPolicyForm,
} from "@/features/signing/controls";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { OnboardingTabs } from "@/features/onboarding/labels";
import { formatDate } from "@/lib/format";
import { jobTitlesApi, signingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Documents to sign" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/** M13: the organisation's library of policies that new starters sign. */
export default async function DocumentsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const jobTitleOptions = await jobTitlesApi.options(ws);
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
  const [storage, packs, titles] = await Promise.all([
    signingApi.storageReady(),
    signingApi.starterPacks(ws),
    signingApi.jobTitles(ws),
  ]);
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
      <section aria-labelledby="packs-heading" className="flex flex-col gap-3">
        <h2 id="packs-heading" className="text-lg font-semibold">
          Starter packs
        </h2>
        <p className="text-sm text-ink-muted">
          Policies sent automatically when you hire someone into a job title (or
          everyone). You can also send them from a person&rsquo;s record.
        </p>
        {packs?.length ? (
          <ul className="flex flex-col gap-2" aria-label="Starter packs">
            {packs.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line-strong p-3 text-sm"
              >
                <div>
                  <p className="font-semibold">
                    {p.name}{" "}
                    <span className="font-normal text-ink-muted">
                      · {p.jobTitle ? `for ${p.jobTitle}` : "for everyone"}
                    </span>
                  </p>
                  <p className="text-ink-muted">
                    {p.documents.map((d) => d.title).join(", ") ||
                      "No documents left in this pack"}
                  </p>
                </div>
                <ArchivePackButton id={p.id} name={p.name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No starter packs yet.</p>
        )}
        {lib.length ? (
          <Card aria-labelledby="add-pack" className="gap-3">
            <CardTitle id="add-pack">Make a starter pack</CardTitle>
            <StarterPackForm
              library={lib}
              jobTitles={jobTitleOptions.length ? jobTitleOptions : titles}
              fixedTitles={jobTitleOptions.length > 0}
            />
          </Card>
        ) : null}
      </section>

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
