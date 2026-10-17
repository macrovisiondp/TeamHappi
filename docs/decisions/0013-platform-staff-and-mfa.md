# ADR-0013: Platform staff register and MFA in the identity boundary

- **Status:** Proposed (17 Oct 2026)
- **Date:** 2026-10-17
- **Requirements:** IS-07 (MFA for privileged roles), M3 plan items 7 and 10, master directive M5.1
- **Related:** ADR-0004, ADR-0008 (auth role), ADR-0009 (platform console role, M5.2), ADR-0011

## Context

Platform administrators need MFA, and a register of who is platform staff, before any privileged platform action is enabled. The M3 plan placed `platform_staff` with a future `teamhappi_platform` role.

Better Auth's `twoFactor` plugin offers TOTP, but it can only store backup codes in plain text or reversibly encrypted. We require one-way hashed recovery codes. The plugin also changes the sign-in flow for every user who enrols.

## Decision

1. **TOTP and recovery codes are implemented in `src/lib/auth`**:
   - the `otpauth` library (RFC 6238) generates and checks codes;
   - Better Auth's `symmetricEncrypt` (keyed by `BETTER_AUTH_SECRET`) encrypts the TOTP secret;
   - recovery codes are stored as HMAC-SHA-256 hashes.

   No custom cryptographic algorithms are used.
2. **MFA is a step-up for platform staff**, recorded on the session (`session.mfa_verified_at`), not a change to everyone's sign-in.
3. **`platform_staff`, `user_mfa`, `mfa_recovery_code` and `platform_audit_event` are managed by `teamhappi_auth`** (RLS, auth role only). The app role gets no access.
   - The auth role can already create sessions for any user, so it is the identity trust anchor; adding the staff register there does not widen what a compromise of that role could do.
   - `teamhappi_platform` (ADR-0009) is still introduced in M5.2, solely for cross-organisation tenant-registry access.
4. **Audit events are append-only:** a trigger rejects UPDATE and DELETE for every role.

## Consequences

- MFA can be enforced now, with no new database credential.
- Changing `BETTER_AUTH_SECRET` makes stored TOTP secrets unreadable, so staff would need to re-enrol. Key rotation must be planned (ADR-0011 stage 2 covers this).
- If tenant users later need MFA (tenant owners, as IS-07 requires), they reuse the same tables and flows.
