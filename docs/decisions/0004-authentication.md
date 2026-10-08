# ADR-0004: Authentication and authorisation

- **Status:** Better Auth provisionally approved, subject to implementation and security validation (2026-10-08). MFA rules follow interim spec IS-07 until approved.
- **Date:** 2026-10-08
- **Requirements:** IA-01..06, MT-02, MT-05, AUD-04

## Decision

### Authentication: Better Auth (self-hosted library, data in our Neon database)

- **Sign-in methods** (product-owner decision CR-002, 8 Oct 2026):
  - **Release 1 initial:** email + password and email one-time code. Workers use a **personal email**, which meets IA-04 because no work email is needed. Hashing is library-managed; **no custom crypto**.
  - **Designed for, added later without redesign:**
    - Phone-number OTP. Deferred pending SMS cost and operations review.
    - Passkeys.
    - Google and Microsoft OAuth for client admins (IA-05).
  - The user identity keeps `email` and `phone_number` both optional (at least one required). Sign-in methods are library plugins enabled by configuration, so a new method needs no schema rewrite.
  - Sending email needs a real email provider before non-developers sign in. Until one is approved, development uses a log-only mailer (see [free-tier limits](../architecture/free-tier-limits.md)).
- **MFA:** TOTP or passkey, **enforced** for privileged memberships: platform staff, tenant admin, HR, and later payroll.
  - SMS is not accepted as a second factor for privileged roles, because of SIM-swap risk.
  - Enforcement happens on the server when a privileged role is used, not just at sign-in.
- **Sessions:** database-backed, HttpOnly + Secure + SameSite=Lax cookies, rotation on privilege change, idle and absolute timeouts, and "sign out other devices".
- **Built-in auth rate limiting** is turned on. Account enumeration is minimised in sign-in and reset flows.

### Authorisation: owned by TeamHappi, not by the auth library

The auth library answers "**who** is this?". TeamHappi answers "**what** may they do, and **in which tenant**?"

- `TenantMembership(userId, tenantId, status)` — one per user per tenant (MT-05).
- `RoleAssignment(membershipId, roleId, siteId?)` — a role can apply tenant-wide (`siteId` null) or to one site.
- `Permission` codes are defined in code, for example `rota.shift.publish` or `onboarding.rtw.view`.
- **Active tenant:** the user picks a tenant. The server verifies membership and stores the active tenant ID **in the server session record**. Every request re-validates that the membership is still active.
- **Candidates (IA-03):** a candidate is a User with **no** TenantMembership. Their access is limited to their own `Candidate` and `Application` records through a dedicated candidate portal. Every staff API requires a membership, so candidates cannot reach employee functions.
- **Permission caching (IA-06):** Release 1 resolves permissions per request from indexed tables (no cross-request cache). If caching is added later, it must be keyed by a `permissionsVersion` counter that is bumped in the same transaction as any role change.
- **Platform staff:** a separate `PlatformStaff` grant on the global User. It confers **no** tenant data access. Support access needs a time-boxed `SupportAccessGrant`, which is audited and visible to the tenant (AUD-04).

## Alternatives considered

| Option | Pros | Why not chosen |
|---|---|---|
| Clerk | Fastest to integrate; hosted UI | Per-MAU pricing grows with hourly workers. Identity data is held outside the UK. Its organisation model would duplicate our tenancy model. |
| WorkOS AuthKit | Strong enterprise SSO; generous free tier | US data location. Phone OTP is weaker. Best revisited if enterprise SSO becomes a priority. |
| Auth.js | Familiar | Now in maintenance mode; MFA and phone OTP need custom work. |
| Custom auth | — | Prohibited (no custom cryptography). |

## Consequences

- We own patching for the library. It is pinned, Dependabot is on, and auth flows are covered by security tests.
- **Phone OTP needs an SMS provider (a paid service, approval needed).** It is deferred, and workers use personal email (CR-002).
- **Risks:** SMS cost abuse ("SMS pumping") must be mitigated with rate limits and UK-only numbers. The exact MFA rules await TH-DEV-07.
