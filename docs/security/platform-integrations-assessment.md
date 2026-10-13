# Security and privacy assessment: Platform Admin and integrations

Date: 13 Oct 2026. Scope: branch `feat/platform-admin-foundation`. Everything assessed runs on synthetic data only.

## What this PR changes

| Area | Change | Risk now |
|---|---|---|
| `/platform` routes | New read-only console with synthetic data | Low. Access is server-side, there is no preview in production, and non-staff get a 404. |
| `PLATFORM_PREVIEW_STAFF_EMAILS` | New optional variable | Low. Only reserved test-domain addresses count, and it is ignored in production. |
| `src/integrations/*` | Interfaces, guards and synthetic adapters | None at runtime. Nothing calls them from routes, and there are no network calls. |
| Sign-in and resend forms | Now `method="post"` | Fixes a leak: submitting before JavaScript loaded used to put the email and password in the URL. |
| Dependencies | Exact overrides `mysql2@3.24.5` and `deepmerge-ts@8.0.2` | Removes 2 high advisories (4 entries in npm audit) |

## Threats and controls

| Threat | Control | Test |
|---|---|---|
| Non-staff open Platform Admin | Server-side gate and 404; no client-side check involved | e2e "not platform staff get a 404"; unit `decidePlatformAccess` |
| A tenant administrator performs platform-only actions | Tenant roles never grant platform access; `assertPrivilegedPlatformAction` always refuses until M3.5 | Unit tests |
| Preview access reaches production | `deploymentEnvironment()` fails towards production; the preview is refused there | Unit tests |
| A hidden button is treated as the control | Every privileged control is disabled *and* the server refuses | e2e "privileged actions are disabled"; static guard |
| A secret is returned to the browser or logged | Write-only secret fields; metadata-only listing; `redact()`; audit events refuse secret-looking values; secrets rejected as plain configuration | Unit tests "credential redaction", "rejects secrets submitted as plain configuration"; e2e scan of the page for key prefixes |
| A secret is exposed through client environment variables | Static guard on `NEXT_PUBLIC_*SECRET/KEY/TOKEN/PASSWORD/DATABASE` | Unit test |
| A failed rotation breaks a provider | validate → activate → monitor → revoke; rollback to the superseded version | Unit tests "failed rotation", "rolls back" |
| Forged or replayed payment webhooks | HMAC over the raw body, timestamp tolerance, constant-time compare, exactly-once ledger | Unit tests |
| The browser claims a payment succeeded | Status changes only from verified events | Design rule and unit test of the ledger |
| Duplicate emails during an outage | Idempotency key; fallback only after a retryable failure | Unit tests |
| Cross-tenant file access | Server-built tenant keys; the tenant check returns "not found" | Unit tests |
| HR documents placed in a media CDN | Classification limits; Cloudinary is media only | Unit test |
| Personal data sent to an AI provider | Data-class guard, redaction, feature flags, kill switch | Unit tests |
| Unrestricted AI spending | Request, token and spend budgets reserved before the call; spend in integer pence | Unit tests |
| A vendor SDK sneaks in before approval | Static guard: no `fetch` or vendor SDK imports in `src/integrations` | Unit test |

## UK GDPR and data residency notes

- **Storage:** S3 should stay in `eu-west-2` (London) with SSE-KMS.
- **Email:** SES is in `eu-west-2`. Resend's processing region must be confirmed and a DPA signed before activation.
- **Payments:** payment providers become independent controllers or processors for billing data. Record them in the RoPA (record of processing activities).
- **AI:** no personal data goes to AI providers. Any future change needs a DPIA, provider DPAs, zero-retention settings where available, and an approved privacy design.

## Still open, and blocking live use

1. Platform staff register, MFA and step-up: M3.4 and M3.5.
2. Durable append-only audit: M3.2.
3. ADR-0011 approval (secrets), then its migration and role.
4. Storage security design: malware scanning, retention, audited downloads. Required by ADR-0007 before real documents.
5. Payment reconciliation job and billing tables.
6. AI prompt-injection and data-processing design.
7. A nonce-based Content-Security-Policy, planned with M3.
