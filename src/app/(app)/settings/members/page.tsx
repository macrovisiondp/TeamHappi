import type { Metadata } from "next";

import { PermissionDenied } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  InvitationActions,
  InviteForm,
  InviteHeading,
  MemberActions,
} from "@/features/members/members";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate, formatTime } from "@/lib/format";
import { memberActivity, membersPage } from "@/lib/workspace";

export const metadata: Metadata = { title: "Members" };
export const instant = false;

const ACTIVITY: Record<string, string> = {
  "invitation.created": "Created an invitation",
  "invitation.renewed": "Created a new invite link",
  "invitation.revoked": "Cancelled an invitation",
  "invitation.accepted": "Joined from an invitation",
  "member.role_changed": "Changed a member's role",
  "member.suspended": "Suspended a member",
  "member.reactivated": "Restored a member's access",
  "member.removed": "Removed a member",
};

const when = (d: Date) => `${formatDate(d)}, ${formatTime(d)}`;

export default async function MembersPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const [page, activity] = await Promise.all([
    membersPage(ws),
    memberActivity(ws),
  ]);
  if (!page)
    return (
      <PermissionDenied message="Your role doesn't include managing members." />
    );
  const grantable = page.roles
    .filter((r) => r.grantable)
    .map((r) => ({ id: r.id, name: r.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description="Who can use this organisation in TeamHappi, and what they can do."
      />

      {page.canInvite ? (
        <Card aria-labelledby="invite-heading">
          <CardHeader>
            <div>
              <CardTitle id="invite-heading">
                <InviteHeading />
              </CardTitle>
              <CardDescription>
                You&rsquo;ll get a one-time link to send them. They set their
                own password when they open it.
              </CardDescription>
            </div>
          </CardHeader>
          <InviteForm roles={grantable} sites={page.sites} />
        </Card>
      ) : null}

      <section
        aria-labelledby="members-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="members-heading" className="text-lg font-semibold">
          Members ({page.members.length})
        </h2>
        <Table caption="Members of this organisation">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {page.members.map((m) => {
              const editable = !m.isSelf && (!m.isOwner || page.actorIsOwner);
              return (
                <tr key={m.membershipId}>
                  <Td>
                    <span className="font-semibold">{m.name}</span>
                    {m.isSelf ? (
                      <span className="text-ink-muted"> (you)</span>
                    ) : null}
                    <p className="text-xs break-all text-ink-muted">
                      {m.email}
                    </p>
                  </Td>
                  <Td>
                    {m.roles.length
                      ? m.roles
                          .map((r) =>
                            r.siteName ? `${r.name} (${r.siteName})` : r.name,
                          )
                          .join(", ")
                      : "No role"}
                  </Td>
                  <Td>
                    <Badge tone={m.status === "active" ? "success" : "warning"}>
                      {m.status === "active" ? "Active" : "Suspended"}
                    </Badge>
                  </Td>
                  <Td>{formatDate(m.joinedAt)}</Td>
                  <Td>
                    {editable ? (
                      <MemberActions
                        membershipId={m.membershipId}
                        name={m.name}
                        status={m.status}
                        currentRoleId={m.roles[0]?.roleId ?? null}
                        currentSiteId={m.roles[0]?.siteId ?? null}
                        roles={grantable}
                        sites={page.sites}
                        canAssign={page.canAssign}
                        canManage={page.canInvite}
                      />
                    ) : (
                      <span className="text-sm text-ink-muted">
                        {m.isSelf
                          ? "You can't change your own access"
                          : "Only an owner can change an owner"}
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </section>

      <section
        aria-labelledby="invitations-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="invitations-heading" className="text-lg font-semibold">
          Open invitations ({page.invitations.length})
        </h2>
        {page.invitations.length === 0 ? (
          <p className="text-sm text-ink-muted">No open invitations.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {page.invitations.map((i) => (
              <li key={i.id}>
                <Card aria-label={`Invitation for ${i.email}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold break-all">{i.email}</span>
                      <span className="text-sm text-ink-muted">
                        {i.siteName
                          ? `${i.roleName} (${i.siteName})`
                          : i.roleName}
                        {" · "}
                        {i.expired
                          ? "Link expired"
                          : `Link expires ${when(i.expiresAt)}`}
                      </span>
                    </div>
                    {i.expired ? <Badge tone="warning">Expired</Badge> : null}
                  </div>
                  {page.canInvite ? (
                    <InvitationActions id={i.id} email={i.email} />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {activity && activity.length ? (
        <section
          aria-labelledby="activity-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="activity-heading" className="text-lg font-semibold">
            Recent activity
          </h2>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2">
                <span>{ACTIVITY[e.action] ?? e.action}</span>
                <span className="text-xs text-ink-muted">
                  {when(e.occurredAt)} · {e.actor ?? "System"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
