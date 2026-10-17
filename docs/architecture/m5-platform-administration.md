# M5: Secure platform administration (architecture review and plan)

Status: M5.1 implemented for review; M5.2 and M5.3 planned. Date: 17 Oct 2026.

## 1. What exists (reviewed)

| Component | State | Reused or replaced in M5 |
|---|---|---|
| Better Auth 1.7.7, `teamhappi_auth` role, database sessions, rate limits | Live | **Reused.** MFA and the staff register sit in the same identity boundary (ADR-0013). |
| `getCurrentUser()` | Validates the session on the server | **Reused.** The MFA status is read for the same session id. |
| Platform Admin UI (`/platform/*`), Warm Hospitality shell | Live; read-only preview, never in production | **Reused.** The preview gate is **replaced** by the real staff and MFA gate. |
| `PlatformStaffActor` (`src/platform/authz`) | Only a test-only issuer exists | **Completed.** The real issuer requires active staff, the grant, and MFA verified within 15 minutes. |
| Integrations architecture (`src/integrations`) | Interfaces, synthetic adapters | Unchanged in M5.1; connected in M5.3 |
| Audit | None (M3.2 never built) | **New:** `platform_audit_event`, append-only, for platform events |
| Tenant registry access across organisations | Not possible for the app role, by design | M5.2: the `teamhappi_platform` role (ADR-0009) |

## 2. M5.1: MFA and the platform staff foundation

### Data (migration `20261021120000_platform_mfa`; auth role only; RLS ENABLE and FORCE)

| Table | Purpose | `teamhappi_auth` | `teamhappi_app` |
|---|---|---|---|
| `platform_staff` | Who is Macrovision staff: `status` (active, suspended or revoked) and `grants[]` | SELECT, INSERT, UPDATE | none |
| `user_mfa` | TOTP secret (**encrypted** with Better Auth's `symmetricEncrypt`), enabled time, last used time step (replay protection), failed attempts and lock-out | SELECT, INSERT, UPDATE | none |
| `mfa_recovery_code` | Ten one-time codes, **stored as HMAC-SHA-256 hashes**; `used_at`, `revoked_at` | SELECT, INSERT, UPDATE | none |
| `platform_audit_event` | Append-only. A trigger blocks UPDATE and DELETE for every role. | SELECT, INSERT | none |
| `session.mfa_verified_at` | When this session last passed MFA | UPDATE (existing) | none |

**Separation:** platform staff status lives in `platform_staff`, never in `tenant_membership`. Being platform staff gives no membership of any client organisation, and vice versa. Being a tenant owner never grants platform access.

### Access rules (server-side, every request)

| State | `/platform/*` |
|---|---|
| Not signed in | Sent to sign-in |
| Signed in, not active staff (including suspended or revoked) | **404** |
| Active staff, MFA not set up | Sent to MFA set-up |
| Active staff, MFA set up, not verified in this session within 12 hours | Sent to MFA verification |
| Active staff, verified | Platform Admin |
| A **privileged action** (staff changes, MFA reset, and later suspending organisations or activating integrations) | Needs the specific grant **and** MFA verified within the last **15 minutes**; otherwise the user is asked to verify again |

### MFA design

- **TOTP:** RFC 6238 (SHA-1, 6 digits, 30-second step, ±1 step tolerance), using the `otpauth` library. Setup shows a QR code and the manual key once. MFA is only enabled after a correct code is entered.
- **Replay protection:** the last accepted time step is stored, and any code for that step or an earlier one is refused.
- **Brute-force protection:** 5 failed codes (TOTP or recovery) lock MFA for 15 minutes. Each failure and each lock-out is audited.
- **Recovery codes:** 10 random codes, shown once, stored only as keyed hashes, each usable once. Regenerating them revokes the old set.
- **Elevation is bound to the session:** `mfa_verified_at` lives on the session row. Signing out or session expiry ends it; there is no long-lived "remember this device".
- **Not your own:** staff can't turn off their own MFA. Another staff member with `staff.manage` can **reset** it (audited), which forces re-enrolment.

### Platform grants

`staff.manage`, `tenant.view`, `tenant.suspend`, `tenant.create`, `integrations.manage` and `audit.view`. Grants are assigned only through staff management (audited) or the approved bootstrap procedure. **An email address never grants anything.**

**Staff management** (`/platform/staff`):
- add an *existing, verified* account as staff, with chosen grants;
- edit grants; suspend, reactivate or revoke;
- reset someone's MFA.

Guards: no changes to your own access, and the last active `staff.manage` holder can't be removed.

### Audit events

`mfa.enrolment_started`, `mfa.enabled`, `mfa.verified`, `mfa.failed`, `mfa.locked`, `mfa.recovery_used`, `mfa.recovery_regenerated`, `mfa.reset`, `staff.granted`, `staff.updated`, `staff.suspended`, `staff.reactivated` and `staff.revoked`.

Events record the actor, the target user, a time and non-secret detail. They never contain codes, secrets or session tokens.

## 3. M5.2: Client organisation management (planned)

- **ADR-0009 role** `teamhappi_platform`: reads the tenant registry and counts across organisations, and can update `tenant.status` only. No employee data.
- **Screens:** organisation directory and detail (status, sites and membership **counts**, trial and subscription status), suspend and reactivate (privileged; MFA within 15 minutes; audited), audit history.
- **New columns** for trial and plan information on `tenant`, or a `subscription` table. Reviewed SQL, separate approval.

## 4. M5.3: Platform integrations (planned)

Connect the existing integration screens to stored, versioned configuration (ADR-0011 stage 1 or 2, ADR-0012) with `integrations.manage` and MFA step-up. Live credentials, paid API use and production data processing each stay behind separate approvals.

## 5. Approvals

1. M5.1 migration on Neon. Additive; reviewed SQL in the PR.
2. **Separately:** the first platform administrator. An exact, reviewed procedure (`docs/operations/m5.1-first-platform-admin.md`) for `joseph@macrovisionproperty.co.uk`. It's not automatic, and it needs your approval of that procedure.
3. M5.2: the `teamhappi_platform` role (you create it, as before) and its migration.
