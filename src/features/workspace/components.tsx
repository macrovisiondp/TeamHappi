import {
  ArrowRightLeft,
  Building2,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getPlatformAccess } from "@/lib/platform-access";
import {
  getWorkspace,
  type MembershipSummary,
  type Workspace,
} from "@/lib/workspace";

/**
 * The workspace for a page: redirects signed-out users to sign-in and users
 * with several organisations (and no valid choice) to the chooser.
 */
export async function requireWorkspace(): Promise<
  Exclude<Workspace, { kind: "choose" }>
> {
  const ws = await getWorkspace();
  if (!ws) redirect("/sign-in");
  if (ws.kind === "choose") redirect("/organisations");
  return ws;
}

/** Header control: the current organisation, with a switcher when there are several. */
export async function OrganisationSwitcher() {
  const ws = await getWorkspace();
  if (!ws || ws.kind !== "ready") return null;
  if (ws.memberships.length <= 1)
    return (
      <p className="hidden max-w-[16rem] truncate rounded-[10px] border border-line px-3 py-2 text-sm font-semibold sm:block">
        <span className="sr-only">Organisation: </span>
        {ws.tenant.name}
      </p>
    );
  return (
    <form
      action="/api/v1/workspace/select"
      method="post"
      className="flex items-center gap-1"
    >
      <label htmlFor="organisation-switcher" className="sr-only">
        Organisation
      </label>
      <select
        id="organisation-switcher"
        name="tenantId"
        defaultValue={ws.tenant.id}
        className="h-11 max-w-[11rem] min-w-0 truncate rounded-[10px] border border-line bg-surface px-3 text-sm font-semibold sm:max-w-[16rem]"
      >
        {ws.memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.name}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        aria-label="Switch organisation"
      >
        <ArrowRightLeft aria-hidden="true" />
      </Button>
    </form>
  );
}

const BLOCKED_REASON = (m: MembershipSummary) =>
  m.tenantStatus !== "active"
    ? `${m.name} is currently ${m.tenantStatus === "suspended" ? "suspended" : "unavailable"}.`
    : `Your access to ${m.name} has been suspended.`;

/** Signed in, but no organisation this person can use right now. */
export async function NoOrganisation({
  blocked,
}: {
  blocked: readonly MembershipSummary[];
}) {
  const platform = await getPlatformAccess();
  if (platform.kind !== "none")
    return (
      <EmptyState
        icon={ShieldCheck}
        title="You're signed in as Macrovision platform staff"
        action={
          <Button asChild>
            <a href="/platform">Open Platform Admin</a>
          </Button>
        }
      >
        <p>
          Your account isn&apos;t part of a client organisation, so there&apos;s
          no workspace here. Platform Admin is where you manage TeamHappi.
        </p>
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-6">
      <EmptyState
        icon={Building2}
        title="You're not part of an organisation yet"
        action={
          <Button asChild variant="secondary">
            <Link href="/demo/dashboard">
              <FlaskConical aria-hidden="true" />
              Explore the demo workspace
            </Link>
          </Button>
        }
      >
        <p>
          When an organisation adds you, its workspace will appear here. If you
          were expecting access, ask the person who manages TeamHappi at your
          workplace.
        </p>
      </EmptyState>
      {blocked.length ? (
        <Alert tone="warning" title="Access paused">
          <ul className="list-disc pl-5">
            {blocked.map((m) => (
              <li key={m.tenantId}>{BLOCKED_REASON(m)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
