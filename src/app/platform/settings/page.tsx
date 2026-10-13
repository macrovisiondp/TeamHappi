import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { PreviewNotice } from "@/features/platform/components";
import { deploymentEnvironment } from "@/integrations/core/environment";
import { getPlatformAccess } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Settings · Platform" };
export const instant = false;

const ENVIRONMENT_LABEL = {
  local: "Local development",
  preview: "Preview deployment",
  production: "Production",
} as const;

export default async function PlatformSettingsPage() {
  const access = await getPlatformAccess();
  const environment = deploymentEnvironment();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform settings"
        description="Your access to the platform console and the environment this deployment runs in."
      />
      <PreviewNotice />
      <div className="grid gap-4 md:grid-cols-2">
        <Card aria-labelledby="access-heading">
          <CardTitle id="access-heading">Your access</CardTitle>
          <dl className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-ink-muted">Access level</dt>
              <dd>
                <Badge tone="info">
                  {access.kind === "preview" ? "Preview (read-only)" : "None"}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-ink-muted">Multi-factor authentication</dt>
              <dd>
                <Badge tone="warning">Not available yet</Badge>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-ink-muted">Privileged actions</dt>
              <dd>
                <Badge tone="neutral">Switched off</Badge>
              </dd>
            </div>
          </dl>
          <CardDescription>
            Full platform staff access needs the staff register and MFA
            (Milestone 3.4–3.5). Preview access is never granted in production.
          </CardDescription>
        </Card>
        <Card aria-labelledby="env-heading">
          <CardTitle id="env-heading">Environment</CardTitle>
          <p className="text-sm">
            This deployment is running as{" "}
            <strong>{ENVIRONMENT_LABEL[environment]}</strong>.
          </p>
          <CardDescription>
            Credentials are kept separate for local, preview and production. The
            Neon branch called &ldquo;production&rdquo; is a development
            database; the environment is decided by the deployment, never by a
            database name.
          </CardDescription>
        </Card>
      </div>
    </div>
  );
}
