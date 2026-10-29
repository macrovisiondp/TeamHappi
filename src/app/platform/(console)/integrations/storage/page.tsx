import { HardDrive } from "lucide-react";
import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { PreviewNotice } from "@/features/platform/components";
import {
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
} from "@/features/platform/labels";
import { s3Status } from "@/integrations/storage/blob";
import { integrationAdmin } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Storage · Platform" };
export const instant = false;

// Storage is Amazon S3, switched on by Vercel settings (ADR-0014), so this
// page shows its status only: no provider choice and no activation steps.
// Key values are never read here, only whether they are set.

export default async function StorageIntegrationsPage() {
  const read = await integrationAdmin.category("storage");
  if (read.kind === "forbidden") return <PermissionDenied />;
  const s3 = s3Status();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={CATEGORY_LABEL.storage}
        description={CATEGORY_DESCRIPTION.storage}
      />
      <PreviewNotice />
      <Card aria-labelledby="s3-heading">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-forest">
              <HardDrive aria-hidden="true" className="size-5" />
            </span>
            <CardTitle id="s3-heading">Amazon S3</CardTitle>
          </div>
          <Badge tone={s3.on ? "success" : "neutral"}>
            {s3.on ? "On" : "Off"}
          </Badge>
        </CardHeader>
        <p className="text-sm">
          Candidate CVs are stored in a private bucket. Files pass through
          TeamHappi, so the bucket is never public and every download is checked
          and audited.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Bucket</dt>
            <dd className="font-medium break-all">{s3.bucket ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Region</dt>
            <dd className="font-medium">{s3.region ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Access keys</dt>
            <dd className="font-medium">{s3.keysSet ? "Set" : "Not set"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Approved for live use</dt>
            <dd className="font-medium">{s3.approved ? "Yes" : "No"}</dd>
          </div>
        </dl>
        {s3.on ? null : (
          <Alert tone="warning" title="CV uploads are off in this deployment">
            <p>Missing in Vercel:</p>
            <ul className="list-disc pl-5">
              {s3.missing.map((m) => (
                <li key={m}>
                  <code>{m}</code>
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </Card>
      <Alert tone="info" title="Changing storage settings">
        <ol className="list-decimal pl-5">
          <li>
            In Vercel, open the project&rsquo;s Settings, then Environment
            Variables (Production).
          </li>
          <li>
            Bucket and region: <code>STORAGE_S3_BUCKET</code>,{" "}
            <code>STORAGE_S3_REGION</code>. Keys (Sensitive):{" "}
            <code>STORAGE_S3_ACCESS_KEY_ID</code>,{" "}
            <code>STORAGE_S3_SECRET_ACCESS_KEY</code>.
          </li>
          <li>
            To switch uploads off, remove <code>aws-s3</code> from{" "}
            <code>APPROVED_LIVE_PROVIDERS</code>.
          </li>
          <li>Redeploy, so the change is picked up.</li>
        </ol>
      </Alert>
    </div>
  );
}
