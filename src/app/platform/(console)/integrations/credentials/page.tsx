import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ENVIRONMENT_LABEL,
  NotConfiguredNotice,
  PreviewNotice,
} from "@/features/platform/components";
import { CATEGORY_LABEL } from "@/features/platform/labels";
import { getProvider } from "@/integrations/registry";
import { integrationAdmin } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Credentials · Platform" };
export const instant = false;

export default async function CredentialsPage() {
  const read = await integrationAdmin.overview();
  if (read.kind === "forbidden") return <PermissionDenied />;
  const approved = new Set(integrationAdmin.approvedLive());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Credentials"
        description="Which provider keys are set in this deployment. Values are never stored in the database, shown or sent to the browser: only whether each one exists."
      />
      <PreviewNotice />
      <Alert tone="info" title="How to add or rotate a key">
        <ol className="list-decimal pl-5">
          <li>
            In Vercel, open the project&rsquo;s Settings, then Environment
            Variables, and add or replace the variable named below.
          </li>
          <li>Redeploy, so the new value is picked up.</li>
          <li>
            Come back here and test the connection before making it active.
          </li>
          <li>Revoke the old key in the provider&rsquo;s own dashboard.</li>
        </ol>
      </Alert>
      {read.kind === "not_configured" ? (
        <NotConfiguredNotice />
      ) : (
        <Table
          caption={`Provider credentials: ${ENVIRONMENT_LABEL[read.data[0]!.environment]}`}
        >
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Service</Th>
              <Th>Variable</Th>
              <Th>In this deployment</Th>
              <Th>Live use</Th>
            </tr>
          </thead>
          <tbody>
            {read.data.flatMap((category) =>
              category.providers.flatMap((p) =>
                p.credentials.map((c) => (
                  <tr key={c.name}>
                    <Td className="font-semibold">
                      {getProvider(p.providerId)?.name ?? p.providerId}
                    </Td>
                    <Td>{CATEGORY_LABEL[category.category]}</Td>
                    <Td>
                      <code>{c.name}</code>
                    </Td>
                    <Td>
                      <Badge tone={c.present ? "success" : "neutral"}>
                        {c.present ? "Set" : "Not set"}
                      </Badge>
                    </Td>
                    <Td>
                      {approved.has(p.providerId) ? "Approved" : "Not approved"}
                    </Td>
                  </tr>
                )),
              ),
            )}
          </tbody>
        </Table>
      )}
    </div>
  );
}
