import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { PreviewNotice, when } from "@/features/platform/components";
import { AUDIT_EVENTS } from "@/features/platform/fixtures";
import { getProvider } from "@/integrations/registry";

export const metadata: Metadata = { title: "Audit log · Platform" };
export const instant = false;

export default function PlatformAuditPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integration audit log"
        demo
        description="Append-only record of every privileged change to providers, credentials and AI settings. It never contains secret values, message content or personal documents."
      />
      <PreviewNotice />
      <Table caption="Integration audit events, newest first">
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Provider</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {AUDIT_EVENTS.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{when(e.at)}</Td>
              <Td>{e.actor}</Td>
              <Td>
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  {e.action}
                </code>
              </Td>
              <Td>{getProvider(e.providerId)?.name ?? e.providerId}</Td>
              <Td>{e.detail}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
