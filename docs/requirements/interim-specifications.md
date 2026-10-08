# Missing Requirement Documents and Proposed Interim Specifications

> **Status: PROPOSED BY THE DEVELOPMENT TEAM, for product-owner review.**
> TH-DEV-03, TH-DEV-06, TH-DEV-07 and TH-DEV-08 are **referenced names only. The documents do not exist** (product owner, 8 Oct 2026). Nothing below is a statement of their contents. It is the minimum specification the developers propose so that work can be reviewed. Each section must be approved, or replaced by a real document, **before the milestone it gates is approved**.

| Missing doc | Subject (inferred only from how TH-DEV-04 references it) | Gates |
|---|---|---|
| TH-DEV-03 | Role, scope and tenant permission model (IA-02) | M3 approval |
| TH-DEV-07 | Security requirements, incl. MFA (IA-01 → "section 3") | M3 approval |
| TH-DEV-06 | Data classification, sensitivity tiers (PAY-06), candidate → employee handoff ("section 4") | M4 approval and the Recruitment module |
| TH-DEV-08 | Non-functional targets: backup and restore, accessibility, performance (DR-01, §12) | M4 approval and the Release 1 validation plan |

---

## IS-03 — Interim roles and permissions (in place of TH-DEV-03)

**Scope model.** A permission is granted by a role, and a role assignment is either **tenant-wide** or **site-scoped**. A user's effective permissions in a tenant are the union of their assignments in **that tenant only**.

| Role (system default, copied into each tenant) | Scope | Summary |
|---|---|---|
| Tenant owner | Tenant | Everything in the tenant, including billing and contacts later. **At least one per tenant.** |
| Tenant administrator | Tenant | Sites, teams, users, roles, settings, module activation, audit search |
| HR manager | Tenant or site | Employee records, onboarding, right-to-work records, training records |
| Recruiter | Tenant or site | Vacancies, candidates, applications, interviews, offers |
| Site manager | Site | Rota, attendance approval, team view, training status for their site(s) |
| Worker | Own record | Own shifts, availability, clocking, training, documents |
| *Candidate* | Own applications | **No tenant membership.** Candidate portal only. |
| *Platform admin* (Macrovision) | Platform | Tenant create/suspend/configure. **No tenant data access by default.** |
| *Platform support* (Macrovision) | Per grant | Tenant data only under a time-boxed, audited grant that the tenant can see |

**Rules:**

1. You can't grant a permission you don't hold.
2. You can't change your own roles.
3. The last tenant owner can't be removed or demoted.
4. Tenants may later create custom roles from the permission catalogue. Release 1 ships the defaults above, with tenant-editable names.
5. Every role change is audited and takes effect on the next request (IA-06).

## IS-07 — Interim minimum security specification (in place of TH-DEV-07)

| Area | Proposed minimum |
|---|---|
| Passwords | Library-managed hashing only. Minimum 12 characters, no composition rules. Reject known-breached passwords (k-anonymity check: only a hash prefix leaves the system; this third-party call needs approval, otherwise use a bundled common-password list). |
| MFA | **Required** for Tenant owner, Tenant administrator, HR manager, and all Macrovision platform roles. Methods: TOTP app or passkey. **SMS not accepted for these roles.** Recovery codes are issued once. MFA is enforced on the server when a privileged permission is used. |
| Sessions | HttpOnly, Secure, SameSite=Lax cookies. Privileged roles: 30 min idle, 12 h absolute. Others: 7 days idle, 30 days absolute. Rotated on sign-in and privilege change. Users can see and revoke their sessions. |
| Brute force | Per-account and per-IP backoff on sign-in, OTP and reset. Responses don't reveal whether an account exists. |
| Transport and headers | HTTPS only (HSTS). Security headers per [API conventions](../development/api-conventions.md). A nonce-based CSP is added with authentication (M3). |
| Data access | Server-side authorisation on every request. Tenant isolation per ADR-0001. Least-privilege DB roles. |
| Secrets | Environment variables only, scoped per environment. gitleaks in CI. Rotate on suspected exposure. |
| Dependencies | Exact pins plus lockfile. `npm audit` (high) in CI. Dependabot. |
| Logging | Tenant ID and request ID on every line. Redact passwords, tokens, bank, ID and pay data. |
| Incident handling | Named contact. Steps for a suspected breach, including the 72-hour ICO notification assessment (**obligations to be confirmed by a qualified adviser**). |
| Testing | The security suite is a merge requirement ([strategy](../security/security-testing-strategy.md)). Independent penetration test before commercial launch. |

## IS-06 — Interim data classification and handoff (in place of TH-DEV-06)

| Tier | Examples | Handling |
|---|---|---|
| **Restricted** | Identity documents, right-to-work evidence, (future) NI number, bank, pay, payslips | Narrowest permissions. Every view audited. Never in notifications, logs or job payloads. Encrypted storage. Malware-scanned. |
| **Confidential** | Employee and candidate records, CVs, contact details, timesheets, training records, audit history | Role-scoped. Changes audited. Not in logs. |
| **Internal** | Rotas, sites, teams, roles, settings | Tenant members per permission |
| **Public** | Published job adverts, careers page | Public by design |

**Candidate → employee handoff (proposed):**

1. When an offer is accepted, `recruitment.hire()` creates the Employee with the copied identity and contact fields.
2. Hiring documents (CV, references) are **linked**, not duplicated.
3. The Candidate record stays with status `hired`.
4. Onboarding starts from `employee.created`.

**Retention:** no automatic deletion until periods are confirmed by a qualified adviser. Proposed starting points for that review: unsuccessful candidates 6–12 months after the decision; right-to-work evidence for employment plus 2 years.

## IS-08 — Interim non-functional targets (in place of TH-DEV-08)

| Area | Proposed target |
|---|---|
| Accessibility | WCAG 2.2 AA for all user-facing screens. Automated axe checks plus manual keyboard and screen-reader checks on key flows. |
| Devices | Android 10+ (Chrome), iOS 16.4+ (Safari), last two versions of desktop Chrome, Edge, Firefox and Safari |
| Worker-page performance | LCP < 2.5 s on a mid-range phone over 4G. ≤ 200 KB gzipped JS on worker routes. |
| Server performance | p95 < 500 ms for common reads at expected Release 1 load |
| Availability (production) | 99.5% monthly target. Not offered on free tiers. |
| Backup and restore (production) | **RPO ≤ 1 h, RTO ≤ 4 h.** Restore test before launch, then quarterly. Free tier can't meet this, so it is only for development. |
| Offline | Clock-in/out queued offline and synced later; flagged for manager review (ADR-0005) |
| Data residency | Personal data, backups and logs in the UK where offered, otherwise the EU/UK with an approved transfer mechanism |
