# ADR-0011: Secrets management and credential rotation for external providers

- **Status:** Proposed (13 Oct 2026). Needs product-owner approval before any live credential is stored.
- **Date:** 2026-10-13
- **Requirements:** Master directive Phase 5; IS-07 (security); threat model T10 (audit) and T12 (secrets)
- **Related:** ADR-0003 (hosting), ADR-0007 (document storage), ADR-0012 (provider-independent integrations), M3 plan (M3.2 audit, M3.4 MFA, M3.5 platform staff)

## Context

Platform Admin must let Macrovision staff configure, validate, activate, rotate and revoke credentials for email, storage, payment and AI providers.

Today, secrets exist only as environment variables: the database URLs and `BETTER_AUTH_SECRET`. No provider credentials exist yet.

The constraints are:
- **Plaintext:** secrets must never sit in plaintext application tables, and must never be returned to the browser after submission.
- **Logging:** secrets must never appear in logs or audit events.
- **Rotation:** a rotation must be possible to roll back.
- **Separate keys:** encryption keys must be managed separately from the encrypted data.
- **Cost:** free tier unless the owner approves a paid service.

## Options considered

| Option | Cost | In-app rotation | Key separation | Notes |
|---|---|---|---|---|
| A. Vercel environment variables, one set per environment | Free | No. The owner changes them in Vercel, then redeploys. | Vercel-managed | The simplest option. It's what we use today. Every change needs a redeploy, and there's no version history inside TeamHappi. |
| B. AWS Secrets Manager | About $0.40 per secret per month, plus API calls | Yes, through the API | AWS KMS | Strong, but paid. It depends on the AWS account that ADR-0007 is waiting for. |
| C. Envelope encryption in Postgres: an `integration_secret` table, AES-256-GCM with a fresh data key per secret, and a key-encryption key (KEK) held outside the database | Free (KEK in Vercel), or about $1 per month (KEK in AWS KMS) | Yes | The KEK is never in the database | Uses only Node's standard `crypto` AEAD primitives, not custom cryptography. The table is readable only by the future `teamhappi_platform` role (ADR-0009). Needs a migration and that role. |
| D. A third-party vault (Doppler, Infisical) | Free tiers available | Yes | The vendor's | Adds a new processor of our secrets and needs a DPA review. |

## Decision (proposed)

**Two stages.**

**Stage 1, now until in-app rotation is needed: option A.**
- Provider secrets live only in Vercel environment variables, scoped per environment (Development, Preview, Production) and never with a `NEXT_PUBLIC_` prefix.
- Platform Admin shows **metadata only**: version, status, last validated, last rotated, expiry and health.
- Rotation follows a runbook (register, then validate, activate, monitor and revoke), and a platform admin records it as an audited event.

**Stage 2, when the platform role, MFA and the audit table exist: option C.**
- The KEK is held in Vercel environment variables, with a key version so the KEK itself can be rotated.
- It moves to AWS KMS once AWS is approved under ADR-0007.

**Option B** is the upgrade path if Macrovision later standardises on AWS.

**Rules for every stage:**
1. **Write-only:** secret fields can be submitted but never read back. The API returns metadata only (`CredentialSet.list()` in `src/integrations/credentials`).
2. **Lifecycle:** each credential version moves through **registered → validated → active → superseded → revoked**. Only a validated version can become active.
3. **Rollback:** the previous version stays *superseded*, not revoked, until monitoring confirms the new one works. `rollback()` restores it.
4. **Destruction:** revoking a version destroys its stored secret.
5. **Audit:** every step writes an audit event containing the version and a reason code, never the value. `buildAuditEvent` refuses secret-looking values.
6. **Authority:** every step needs a platform-staff session with MFA and a second confirmation for live credentials. This is enforced on the server by the `PlatformStaffActor` issuer (M3.5); until then, `assertPrivilegedPlatformAction` refuses every privileged action.
7. **Environments:** sandbox or test credentials and live credentials are separate records, and are never shared between environments.
8. **Logging:** logs pass through `redact()`, and secret values are never logged.

## Consequences

- No live credential can be stored until this ADR is approved. Stage 2 also needs a migration and the `teamhappi_platform` role, each with its own reviewed SQL and approval.
- The rotation logic and its tests (`tests/unit/integrations.test.ts`) are already written against a `SecretStore` interface, so changing from stage 1 to stage 2 doesn't change the callers.
- The in-memory secret store refuses to run in production.
