"use server";

import { cookies } from "next/headers";

import {
  getWorkspace,
  invitationLinkFor,
  invitations,
  manageMembers,
  ORGANISATION_COOKIE,
  organisationCookieOptions,
  type AcceptOutcome,
  type InvitationPreview,
  type MutationResult,
} from "@/lib/workspace";
import { getCurrentUser, invitedAccounts } from "@/lib/auth";

// Server actions for members and invitations (M6). The organisation always
// comes from the server session; ids in forms are untrusted and re-checked by
// the workspace layer (permissions, owner rules, RLS). Invite tokens arrive in
// the POST body only.

export type MemberActionState =
  | { status: "idle" }
  | { status: "ok"; message: string; link?: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: MemberActionState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

function toState(
  r: MutationResult<unknown>,
  message: string,
  link?: string,
): MemberActionState {
  return r.ok
    ? { status: "ok", message, link }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
}

export async function inviteMember(
  _prev: MemberActionState,
  form: FormData,
): Promise<MemberActionState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const r = await manageMembers.invite(ws, {
    email: String(form.get("email") ?? ""),
    roleId: String(form.get("roleId") ?? ""),
    siteId: String(form.get("siteId") ?? "") || undefined,
  });
  return toState(
    r,
    "Invitation created. Copy the link and send it to them yourself. It works once and expires in 7 days.",
    r.ok ? invitationLinkFor(r.data.token) : undefined,
  );
}

export async function invitationCommand(
  _prev: MemberActionState,
  form: FormData,
): Promise<MemberActionState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = String(form.get("invitationId") ?? "");
  if (form.get("intent") === "revoke")
    return toState(
      await manageMembers.revokeInvitation(ws, id),
      "Invitation cancelled. Its link no longer works.",
    );
  const r = await manageMembers.renewInvitation(ws, id);
  return toState(
    r,
    "New link created. The previous link no longer works.",
    r.ok ? invitationLinkFor(r.data.token) : undefined,
  );
}

export async function memberCommand(
  _prev: MemberActionState,
  form: FormData,
): Promise<MemberActionState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = String(form.get("membershipId") ?? "");
  const intent = String(form.get("intent") ?? "");
  if (intent === "role")
    return toState(
      await manageMembers.changeRole(ws, id, {
        roleId: form.get("roleId"),
        siteId: String(form.get("siteId") ?? "") || null,
      }),
      "Role changed.",
    );
  const next =
    intent === "suspend"
      ? "suspended"
      : intent === "reactivate"
        ? "active"
        : intent === "remove"
          ? "left"
          : null;
  if (!next) return { status: "error", message: "Unknown action." };
  return toState(
    await manageMembers.setStatus(ws, id, next),
    next === "suspended"
      ? "Access suspended. They lose access on their next page load."
      : next === "active"
        ? "Access restored."
        : "Removed from the organisation. Their history is kept.",
  );
}

// --- Public invite page -------------------------------------------------------

export interface InviteView {
  preview: InvitationPreview;
  /** The signed-in account, if any (its own address only). */
  signedInAs: string | null;
  /** Whether the invited address already has an account (link holders only). */
  accountExists: boolean;
}

export async function openInvitation(form: FormData): Promise<InviteView> {
  // The token travels in a form body: never as a call argument, so it never
  // appears in development server logs either.
  const token = String(form.get("token") ?? "");
  const [preview, user] = await Promise.all([
    invitations.preview(token),
    getCurrentUser(),
  ]);
  const accountExists =
    preview.state === "valid" && preview.email
      ? await invitedAccounts.exists(preview.email)
      : false;
  return { preview, signedInAs: user?.email ?? null, accountExists };
}

const ACCEPT_MESSAGE: Record<
  Exclude<AcceptOutcome, "joined" | "already_member">,
  string
> = {
  invalid:
    "This invitation link isn't valid any more. Ask whoever invited you for a new one.",
  expired:
    "This invitation has expired. Ask whoever invited you for a new link.",
  unavailable: "This organisation isn't available at the moment.",
  wrong_account:
    "This invitation is for a different email address than the account you're signed in with.",
  unverified: "Confirm your email address first, then open the link again.",
  suspended:
    "Your access to this organisation is suspended. Ask its owner to restore it.",
};

export async function acceptInvitationAction(
  form: FormData,
): Promise<{ ok: true; href: string } | { ok: false; message: string }> {
  const r = await invitations.acceptAsCurrentUser(
    String(form.get("token") ?? ""),
  );
  if (r.outcome === "joined" || r.outcome === "already_member") {
    // Open the organisation just joined (a preference; re-validated per request).
    if (r.tenantId)
      (await cookies()).set(
        ORGANISATION_COOKIE,
        r.tenantId,
        organisationCookieOptions(),
      );
    return { ok: true, href: "/dashboard" };
  }
  return { ok: false, message: ACCEPT_MESSAGE[r.outcome] };
}

export async function createAccountFromInvitation(
  _prev: MemberActionState,
  form: FormData,
): Promise<MemberActionState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirmPassword") ?? ""))
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { confirmPassword: "The passwords don't match" },
    };
  const r = await invitations.createAccountAndJoin(
    String(form.get("token") ?? ""),
    {
      name: form.get("name"),
      password,
    },
  );
  return r.ok
    ? { status: "ok", message: "Account created.", link: "/sign-in?joined=1" }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
}
