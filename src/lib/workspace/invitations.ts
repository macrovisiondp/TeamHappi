// Opening and accepting invite links (M6). The link's token reaches the server
// only in a POST body (it travels in the URL fragment, which browsers never
// send). The database functions app.invitation_preview / app.accept_invitation
// do the cross-organisation lookup; they check the link, its expiry, the
// organisation's status and that the joining user's confirmed email is the
// invited one.

import type { DbClient } from "@/lib/db/create-client";
import { hashInvitationToken } from "@/lib/invitations/token";
import { withUserContext } from "@/lib/tenancy";

export type InvitationState =
  "valid" | "used" | "revoked" | "expired" | "unavailable" | "invalid";

export interface InvitationPreview {
  state: InvitationState;
  email: string | null;
  organisation: string | null;
  role: string | null;
  site: string | null;
}

export type AcceptOutcome =
  | "joined"
  | "already_member"
  | "invalid"
  | "expired"
  | "unavailable"
  | "wrong_account"
  | "unverified"
  | "suspended";

const INVALID: InvitationPreview = {
  state: "invalid",
  email: null,
  organisation: null,
  role: null,
  site: null,
};

export async function previewInvitation(
  client: DbClient,
  token: string,
): Promise<InvitationPreview> {
  const hash = hashInvitationToken(token);
  if (!hash) return INVALID;
  const [row] = await client.$queryRaw<
    {
      state: InvitationState;
      email: string | null;
      tenant_name: string | null;
      role_name: string | null;
      site_name: string | null;
    }[]
  >`SELECT state, email, tenant_name, role_name, site_name FROM app.invitation_preview(${hash})`;
  if (!row) return INVALID;
  return {
    state: row.state,
    email: row.email,
    organisation: row.tenant_name,
    role: row.role_name,
    site: row.site_name,
  };
}

/** Joins `userId` (from a validated session, or the account just created from this link). */
export async function acceptInvitation(
  client: DbClient,
  userId: string,
  token: string,
): Promise<{ outcome: AcceptOutcome; tenantId: string | null }> {
  const hash = hashInvitationToken(token);
  if (!hash) return { outcome: "invalid", tenantId: null };
  return withUserContext(client, userId, async (tx) => {
    const [row] = await tx.$queryRaw<
      { outcome: AcceptOutcome; tenant_id: string | null }[]
    >`SELECT outcome, tenant_id::text AS tenant_id FROM app.accept_invitation(${hash})`;
    return {
      outcome: row?.outcome ?? "invalid",
      tenantId: row?.tenant_id ?? null,
    };
  });
}
