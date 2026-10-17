import { RotateCw } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  HealthBadge,
  PreviewNotice,
  when,
} from "@/features/platform/components";
import { CATEGORY_LABEL, CREDENTIALS } from "@/features/platform/fixtures";
import { getProvider } from "@/integrations/registry";
import { PRIVILEGED_DISABLED_REASON } from "@/lib/platform-access/policy";

export const metadata: Metadata = { title: "Credentials · Platform" };
export const instant = false;

const STATUS: Record<string, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  validated: { tone: "info", label: "Validated" },
  registered: { tone: "neutral", label: "Registered" },
  superseded: { tone: "neutral", label: "Superseded" },
  revoked: { tone: "neutral", label: "Revoked" },
  failed: { tone: "danger", label: "Failed" },
  "not-registered": { tone: "neutral", label: "Not registered" },
};

export default function CredentialsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Credentials"
        demo
        description="Metadata about provider credentials. Secret values are write-only: they are never stored in application tables or shown again."
        actions={
          <Button disabled disabledReason={PRIVILEGED_DISABLED_REASON}>
            <RotateCw aria-hidden="true" />
            Rotate a credential
          </Button>
        }
      />
      <PreviewNotice />
      <Alert tone="info" title="How rotation works">
        <ol className="list-decimal pl-5">
          <li>Register the new credential.</li>
          <li>Validate it against the provider.</li>
          <li>Activate it. The previous one stays available for rollback.</li>
          <li>Monitor the provider.</li>
          <li>Revoke the previous credential.</li>
        </ol>
        <p className="mt-1">
          Every step is audited, and needs MFA and a second confirmation.
        </p>
      </Alert>
      <Table caption="Provider credentials by environment">
        <thead>
          <tr>
            <Th>Provider</Th>
            <Th>Service</Th>
            <Th>Environment</Th>
            <Th>Status</Th>
            <Th>Version</Th>
            <Th>Last validated</Th>
            <Th>Last rotated</Th>
            <Th>Expires</Th>
            <Th>Config</Th>
            <Th>Health</Th>
          </tr>
        </thead>
        <tbody>
          {CREDENTIALS.map((c) => (
            <tr key={`${c.providerId}-${c.environment}-${c.version}`}>
              <Td className="font-semibold">
                {getProvider(c.providerId)?.name ?? c.providerId}
              </Td>
              <Td>{CATEGORY_LABEL[c.category]}</Td>
              <Td className="capitalize">{c.environment}</Td>
              <Td>
                <Badge tone={STATUS[c.status]!.tone}>
                  {STATUS[c.status]!.label}
                </Badge>
              </Td>
              <Td>{c.version ? `v${c.version}` : "None"}</Td>
              <Td>{when(c.lastValidatedAt)}</Td>
              <Td>{when(c.lastRotatedAt)}</Td>
              <Td>{c.expiresAt ? when(c.expiresAt) : "No expiry"}</Td>
              <Td>{c.configVersion ? `v${c.configVersion}` : "None"}</Td>
              <Td>
                <HealthBadge status={c.health} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
