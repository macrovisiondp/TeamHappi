import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { RegenerateRecoveryCodes } from "@/features/platform-admin/mfa";
import { GRANT_LABELS } from "@/lib/permissions/platform";
import { formatDate, formatTime } from "@/lib/format";
import { getPlatformAccess, stepUpFresh } from "@/lib/platform-access";

export const metadata: Metadata = { title: "Security · Platform" };
export const instant = false;

export default async function SecurityPage() {
  const access = await getPlatformAccess();
  if (access.kind !== "staff") return null; // the console layout redirects first
  const fresh = stepUpFresh(access, new Date());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your security"
        description="Multi-factor authentication and the permissions you hold as platform staff."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card aria-labelledby="mfa-heading">
          <CardTitle id="mfa-heading">Multi-factor authentication</CardTitle>
          <dl className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <Badge tone="success">On</Badge>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-ink-muted">Last verified in this session</dt>
              <dd className="font-medium">
                {formatDate(access.mfaVerifiedAt)},{" "}
                {formatTime(access.mfaVerifiedAt)}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-ink-muted">Sensitive changes</dt>
              <dd>
                <Badge tone={fresh ? "success" : "warning"}>
                  {fresh ? "Allowed for now" : "Verify again first"}
                </Badge>
              </dd>
            </div>
          </dl>
          <CardDescription>
            Sensitive changes need a check within the last 15 minutes.{" "}
            <Link
              href="/platform/mfa/verify?next=/platform/security"
              className="font-semibold text-forest underline"
            >
              Verify now
            </Link>
          </CardDescription>
        </Card>
        <Card aria-labelledby="recovery-heading">
          <CardTitle id="recovery-heading">Recovery codes</CardTitle>
          <CardDescription>
            Creating new codes cancels any you haven&apos;t used yet.
          </CardDescription>
          <RegenerateRecoveryCodes />
        </Card>
      </div>
      <Card aria-labelledby="grants-heading">
        <CardTitle id="grants-heading">Your platform permissions</CardTitle>
        <ul className="flex flex-wrap gap-2">
          {access.grants.map((g) => (
            <li key={g}>
              <Badge tone="info">{GRANT_LABELS[g]}</Badge>
            </li>
          ))}
        </ul>
        <CardDescription>
          Platform permissions are separate from any client organisation. They
          don&apos;t give access to client employee records.
        </CardDescription>
      </Card>
    </div>
  );
}
