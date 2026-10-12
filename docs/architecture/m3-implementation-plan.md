# Milestone 3 — Implementation Plan: Authentication, Authorisation and Organisation Setup

| Field | Value |
|---|---|
| Status | **Plan for product-owner review. No Milestone 3 code has been written.** |
| Date | 9 October 2026 |
| Builds on | Milestone 2 (commit `2b575c8`, draft PR #1). It starts only after M2 verification passes and is reviewed. |
| Constraints | Free tier only: Vercel Hobby, Neon Free, GitHub Free. No paid services or new infrastructure without approval. Synthetic data only. |
| Gating specs | Interim specs IS-03 (roles) and IS-07 (security) must be approved before M3 sign-off |

## 1. Outcome

When M3 is done, a Macrovision platform admin can create a client organisation and invite its owner. The owner signs in and sets up MFA, configures the organisation, adds sites and teams, and invites colleagues with roles scoped to the whole organisation or to individual sites.

Every request runs in the right tenant with the right permissions. Every sensitive action is audited, and automated tests prove that tenants and roles stay apart.

**Not in M3:**
- SMS or phone sign-in (CR-002);
- single sign-on;
- custom roles (system roles only);
- support-access grants;
- any business module (recruitment, rota and so on).

## 2. Key design decisions

The decisions marked **ADR** will be written up and put to you for review before they're built.

| # | Decision | Proposal | Why |
|---|---|---|---|
| 1 | Authentication library | **Better Auth 1.7.7** (provisionally approved, ADR-0004). Compatibility with Next 16 and Prisma 7 is confirmed from its declared peer ranges; a spike validates it in practice first (M3.1). | Self-hosted in our Neon database, with no per-user cost. TOTP, email OTP and rate limiting are built in. |
| 2 | Database access for authentication (**ADR-0008**) | A third role, **`teamhappi_auth`** (LOGIN, NOBYPASSRLS). Its grants and policies cover **only** the auth tables: `user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`. It has **no** access to tenant tables. The app role keeps read-only, RLS-scoped access to `user`. | Sign-up and sign-in happen before any tenant exists, so they can't run under tenant RLS. A separate role keeps that cross-tenant identity access out of the application role. |
| 3 | Platform console access (**ADR-0009**) | A fourth role, **`teamhappi_platform`** (LOGIN, NOBYPASSRLS). It can SELECT and UPDATE status on the `tenant` registry (all tenants), use `platform_staff` and `platform_audit_event`, and nothing else. It's used only by platform-console routes, after the platform-staff check. | Listing all tenants needs cross-tenant reads. Giving that to the app role would weaken the §5a boundary. |
| 4 | Sessions | Database sessions (Better Auth). Cookie with the `__Host-` prefix, HttpOnly, Secure, SameSite=Lax. Rotated at sign-in, at MFA step-up and on privilege change. Timeouts per IS-07: privileged roles 30 min idle / 12 h absolute; others 7 days / 30 days. "Sign out other devices". | IS-07; threat-model items T4 and T21 |
| 5 | Active tenant | Stored on the **server-side session row** (`active_tenant_id`). Switching tenant re-runs `resolveTenantContext` (active membership plus active tenant) before saving. Every request re-validates it. | MT-02: tenant context comes from the server, never the client |
| 6 | Authorisation | `authorize(ctx, permission, { siteId? })` resolves the member's role assignments (tenant-wide or site-scoped) from the database **per request**. Nothing is cached across requests (IA-06). It's called from the service layer, never only in the UI. | IS-03; TH-DEV-04 IA-02, IA-06 |
| 7 | MFA | **TOTP + one-time recovery codes** (Better Auth `twoFactor`). Required for Tenant owner, Tenant administrator, HR manager and all platform staff. Enforced on the server: privileged permissions need a session that completed MFA. Users without MFA must enrol before their first privileged action. No SMS second factor. Passkeys come later. | IS-07; T4 |
| 8 | Onboarding model | **Platform-led** for Release 1: Macrovision staff create the tenant and invite the owner. No public self-serve sign-up. | Controlled commercial rollout; less abuse surface |
| 9 | Invitations | A tenant-owned `invitation` table. The token is 32 random bytes; **only its SHA-256 hash is stored**. Invitations are single-use, expire after 7 days, and are bound to the invited email address. Accepting requires a signed-in user whose **verified** email matches. Acceptance runs in a narrow internal context inside `src/platform/tenancy`, the same pattern as `createTenant`. | Token theft, replay and cross-tenant acceptance risks |
| 10 | Audit | A tenant-owned `audit_event` table (RLS; app role INSERT and SELECT only; a trigger blocks UPDATE and DELETE) and a global `platform_audit_event` table. Events are written **in the same transaction** as the change. Before/after values for sensitive fields go through a redaction allow-list. | AUD-01..04; T10 |
| 11 | Email | A `mailer` interface. In development, emails are written to the server log (no real email). **A free-tier provider needs your approval before anyone other than a developer can sign in** (risk R-4). | Sign-in codes, verification and invitations need email |
| 12 | Rate limiting | Better Auth's built-in limiter with **database** storage (free), on sign-in, OTP, password reset and invitation acceptance. App-level limits per IP and per tenant on the API. | MT-08; T4, T15, T16; no Redis |
| 13 | Content Security Policy | A nonce-based CSP set in Next 16's **`proxy.ts`** (the replacement for middleware), applied to authenticated pages. | IS-07; T7 |

## 3. Data model additions (migration SQL reviewed per increment)

| Table | Scope | Notes |
|---|---|---|
| `user` (existing) | Global | Better Auth columns already match; `email` stays required in practice (personal email). |
| `session` | Global (auth role) | Better Auth columns plus `active_tenant_id`, `mfa_verified_at` and `privileged_until` |
| `account` | Global (auth role) | Password hashes are managed by Better Auth (no custom crypto) |
| `verification` | Global (auth role) | Email verification and OTP tokens |
| `two_factor` | Global (auth role) | TOTP secret and recovery codes, as stored by Better Auth |
| `rate_limit` | Global (auth role) | Better Auth database rate-limit storage |
| `platform_staff` | Global (platform role) | `user_id`, status, grants such as `tenant.create`, `tenant.suspend`, created by |
| `invitation` | **Tenant-owned** | RLS, composite FKs to role and site, `token_hash`, `email_normalised`, `expires_at`, status |
| `audit_event` | **Tenant-owned** | Append-only; indexed by (tenant, time) and (tenant, resource) |
| `platform_audit_event` | Global (platform role) | Platform-staff actions, including tenant creation and suspension |

The RLS-coverage and grant tests are extended to all new tables and roles. New roles are created with **bootstrap SQL that you approve and that runs separately**, exactly like the M2 process.

## 4. Delivery increments

Each increment is a separate branch and PR, with its own tests and report. Database changes follow the M2 approval process: review the SQL, then separate approvals for bootstrap, migration and verification.

| # | Increment | Includes | Done when |
|---|---|---|---|
| **M3.1** | Auth foundation | ADR-0008. Spike checking Better Auth with Prisma 7 and Next 16; stop and report if incompatible. Auth tables and the `teamhappi_auth` role. Email + password with email verification. Sessions, cookie settings, timeouts. DB-backed rate limits. Dev log mailer. Nonce CSP in `proxy.ts`. Sign-in, sign-out and verify-email screens. | Sign-up, verify, sign-in and sign-out work locally. The auth role is proven unable to read tenant tables. Session, cookie and rate-limit tests pass. |
| **M3.2** | Audit foundation | `audit_event` and `platform_audit_event`. An `audit.record()` service with redaction. Immutability trigger. | Audit rows can't be updated or deleted by any app role (tested). Redaction tests pass. |
| **M3.3** | Tenant context from the session, and RBAC | Session → `resolveTenantContext`. Tenant switcher with re-validation. `authorize()` with site scope. API and server-action wrappers. 401/403/404 behaviour per the API conventions. | An **authorisation matrix test** (every permission × every system role × tenant-wide or site scope) passes. Switching to a non-member tenant is refused. |
| **M3.4** | MFA | TOTP enrolment, verification, recovery codes, disabling with re-authentication. Privileged-session enforcement and step-up. Enforcement on all privileged permissions. | A privileged action without MFA is refused on the server (tested for every privileged role). Recovery codes are single-use. |
| **M3.5** | Platform staff and tenant onboarding | ADR-0009. The `teamhappi_platform` role and `platform_staff` table. The real `PlatformStaffActor` issuer (session + active staff grant + MFA), replacing the test issuer. Platform console: list, create and suspend tenants; invite the owner. Platform audit. | The static guard is updated: only the issuer and the console use platform code. Non-staff, staff without MFA and staff without the grant are all refused (tested). |
| **M3.6** | Invitations and membership management | Create, resend, revoke and accept invitations. Member list. Change roles. Suspend, reactivate and remove (status `left`). Rules: you can't grant a permission you don't hold, can't change your own roles, and the last owner is protected. All audited. | Invitation security tests pass: reuse, expiry, wrong email, unverified email, cross-tenant token, revoked. The rule tests pass. |
| **M3.7** | Organisation setup | Tenant settings (name, timezone). Sites (create, edit, archive). Teams (create, edit, members). Module activation is read-only for now. | CRUD is permission-checked, site-scoped where relevant, audited and isolation-tested |
| **M3.8** | Validation and report | Full security suite, Playwright E2E journeys (desktop + mobile, with axe accessibility checks), threat-model update, M3 report | All gates are green and the report is delivered for review |

## 5. Testing plan (automated)

- **Isolation (extends M2):** every new tenant-owned table is added to the cross-tenant read, write, join and manipulated-identifier matrix. The coverage test automatically includes new `tenant_id` tables.
- **Role separation:**
  - `teamhappi_auth` can't read tenant tables;
  - `teamhappi_platform` can't read tenant business tables;
  - the app role can't read sessions, accounts or TOTP secrets;
  - no role except the owner has BYPASSRLS.
- **Authentication:**
  - wrong password and unknown email return identical errors;
  - an unverified email is blocked;
  - lockout and backoff apply;
  - sessions rotate and expire on the idle and absolute timeouts;
  - signing out revokes the session on the server;
  - cookie flags are correct.
- **Authorisation:** a generated matrix of permissions × roles × scopes. Site-scoped roles can't act on other sites. Hiding UI is never the only control: every API route is tested directly.
- **MFA:** privileged actions are refused without MFA. Step-up expiry is enforced. TOTP replay within the time window is rejected. Recovery codes are single-use.
- **Invitations:** see M3.6, plus rate limiting on acceptance.
- **Audit:** every sensitive action in M3 produces exactly one event with the right actor, tenant and resource. Rows are immutable. No secrets appear (redaction tests).
- **E2E (Playwright):**
  - platform admin creates a tenant and invites the owner;
  - the owner accepts, enrols MFA and creates a site;
  - the owner invites a site manager, who sees only their site;
  - a user switches tenants;
  - accessibility checks run on every screen.
- **Neon verification:** after each approved migration, `verify:neon` is extended with the new roles and tables.

## 6. Decisions requested from you

| # | Decision | Recommendation |
|---|---|---|
| D-M3-1 | Email delivery for sign-in codes and invitations (R-4) | Build M3 with the dev log mailer. Approve a free-tier provider before the first non-developer sign-in. I'll bring a short comparison covering data location and terms; candidates include Brevo (EU-based) and Resend. |
| D-M3-2 | Approve interim specs IS-03 (roles) and IS-07 (security), or amend them | Approve before M3.3 and M3.4 start, since they define the role matrix and MFA rules |
| D-M3-3 | Two new database roles (`teamhappi_auth`, `teamhappi_platform`) through ADR-0008 and ADR-0009 | Approve in principle now. Each still gets its own reviewed bootstrap SQL and approval. |
| D-M3-4 | Onboarding model | Platform-led for Release 1 (no public self-serve sign-up) |
| D-M3-5 | First platform admin | Your own account, added through a one-row owner SQL insert that you approve after you sign up |
| D-M3-6 | MFA methods | TOTP + recovery codes in M3; passkeys later |
| D-M3-7 | Vercel Hobby for M3 previews | Private development only, no external users (R-1). Upgrade before any pilot. |

## 7. Risks

| Risk | Mitigation |
|---|---|
| Better Auth + Prisma 7 + Next 16 integration problems | The M3.1 spike comes first. If it fails, I stop and report alternatives (ADR-0004 lists them). |
| Cache Components (Next 16) and per-request auth | Authenticated routes read the session dynamically. The spike includes a protected page and a protected route handler. |
| More database roles mean more connections on Neon Free | Every runtime role uses the pooled endpoint with small pools; the actual count is reviewed in M3.1 |
| Email not approved, so no real users | M3 can be built and tested end to end with the log mailer. Only external use is blocked. |
| Scope growth | Custom roles, support access, SSO, SMS and passkeys are explicitly out of M3 |

## 8. Ways of working (unchanged)

Small PRs, kept in draft until reviewed. CI must be green. Every SQL change gets a review pack. Every Neon step needs separate explicit approval. Synthetic data only. Results are reported as actually observed.
