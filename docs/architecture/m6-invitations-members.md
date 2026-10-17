# M6: Invitations and member management

Client owners and administrators invite their staff, choose their role, and suspend, restore or remove them. This implements M3.6 from `m3-implementation-plan.md`, with the product owner's decisions of 17 October 2026:

| Decision | Choice |
|---|---|
| How invitations reach people | **Copy link now, email later.** The owner copies a one-time link and sends it themselves. Email delivery switches on once Resend and a TeamHappi domain are approved (both separate approvals). |
| Does opening the link confirm the email address? | **Yes, until email is live.** Accounts created from a link are marked `email_verified_via = 'invitation'`, so they can be asked to confirm by email once email delivery exists. |

## What clients can do

- **Settings → Members** (owners and admins, who hold `member.invite` / `role.assign` organisation-wide):
  - invite by email address with a role, optionally limited to one site;
  - copy the one-time link (shown once; a new link replaces the old one);
  - cancel an open invitation;
  - change a member's role (one role per member), suspend, restore access, or remove (status `left`; history kept);
  - see recent membership activity.
- **`/invite`** (public): the person opening the link sees the organisation, role and invited address, then:
  - **new to TeamHappi:** chooses a name and password; the account is created for the invited address and joins;
  - **already has an account:** signs in (and comes back to the page) or, if signed in with that address, presses Join;
  - **signed in with a different address:** is told so and offered sign-out.

## Rules (enforced on the server; the screens only mirror them)

| Rule | Where |
|---|---|
| Only members with `member.invite` organisation-wide invite, cancel, suspend, restore and remove; only `role.assign` changes roles. Site-scoped grants never count. | `member-policy.ts` |
| You can't hand out a permission you don't hold organisation-wide. Only an owner can make someone an owner or change an owner. Owner and admin roles can't be limited to one site. | `mayGrantRole`, `mayChangeMember` |
| Nobody changes their own access. The organisation always keeps an active owner. | `mayChangeMember`, `keepsAnOwner` |
| No invitation for someone who is already a member (active or suspended). One open invitation per address. | `createInvitation`, partial unique index |
| An invitation never lifts a suspension. A former member rejoins with the invited role only. | `app.accept_invitation` |

## Link security

- The token is 32 random bytes. Only its **SHA-256 hash** is stored. Links expire after **7 days** and work **once**.
- The token travels in the URL **fragment** (`/invite#…`), which browsers never send to servers, so it never appears in server or hosting logs or `Referer` headers. The page removes it from the address bar and sends it to the server only inside POST bodies.
- Joining checks, in one locked database transaction: the link exists, is pending and unexpired; the organisation is active; the signed-in user's **confirmed** email is the invited one.
- A link can't take over an existing account: if the invited address already has an account, the person must sign in with its password.
- Invite pages aren't indexed by search engines.

## Database change: `20261024120000_invitations_members`

Additive. No existing rows change.

| Change | Detail |
|---|---|
| `invitation` (tenant-owned) | RLS ENABLE + FORCE, tenant policy, composite FKs to role and site. The app may SELECT and INSERT, and UPDATE only `token_hash`, `expires_at`, `status`, `revoked_at` and `updated_at`. No DELETE. |
| `audit_event` (tenant-owned) | RLS ENABLE + FORCE. App: SELECT and INSERT only, plus a trigger that rejects any UPDATE or DELETE. Ids and role keys only; never names or email addresses. |
| `user.email_verified_via` | `'email'`, `'invitation'` or null. Written by the sign-in role. |
| `app.invitation_preview(hash)` | SECURITY DEFINER, pinned `search_path`. Shows organisation, role, site and address only while the link is usable; otherwise just its state. |
| `app.accept_invitation(hash)` | SECURITY DEFINER, pinned `search_path`. Uses `app.current_user_id()` from the validated session; does nothing without it. |
| `user_visible` policy | Now also shows **suspended** members of the current organisation (as it already showed active ones), so admins can see who to restore. Former members stay hidden. |

Only the application role can run the two functions.

## Tests

- `tests/unit/member-policy.test.ts`: every rule above, token format and hashing, link shape, return path.
- `tests/security/invitations-members.test.ts` (real app role): hash-only storage and expiry, permission refusals, duplicates, admins can't create owners, other organisations' roles and sites rejected, preview contents, wrong and unconfirmed accounts, single use, expiry, cancellation, renewal, calls without a session, suspension can't be lifted, cross-organisation invisibility, role changes with audit, suspend/restore/remove taking effect on the next request, rejoining, append-only audit, column-level grants.
- `tests/security/db-roles.test.ts` and `user-visibility.test.ts`: updated posture.
- `tests/e2e/invitations.spec.ts` (desktop and mobile, with accessibility checks): new person creates an account from a link and joins; single use; suspend, restore and change role; an existing account accepts while signed in; renewing and cancelling links; workers can't manage members.

## Follow-ups (not in this milestone)

- **Email delivery** (Resend + TeamHappi domain, separate approvals). Then: email invitations automatically, and ask `email_verified_via = 'invitation'` accounts to confirm their address at next sign-in.
- Link an invitation to an existing person record (so a worker sees their own profile).
- Custom roles (`role.manage`).
