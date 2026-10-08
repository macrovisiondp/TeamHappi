# Threat Model — Shared Platform (Sprint 0)

- **Method:** STRIDE over the container diagram in [solution-architecture.md](../architecture/solution-architecture.md).
- **Scope:** shared platform plus the Release 1 module surface.
- **Review:** at every milestone, and whenever a new external service or data class is added.

## Assets (by sensitivity, provisional until TH-DEV-06)

| Tier | Examples |
|---|---|
| Restricted | Identity and right-to-work documents, (future) payroll, bank details and NI numbers |
| Confidential | Employee records, CVs and applications, contact details, audit history, timesheets |
| Internal | Rotas, sites, roles, tenant settings |
| Secrets | DB credentials, AWS keys, auth secret, Inngest signing key, OAuth client secrets |

## Trust boundaries

1. Browser/PWA ↔ Vercel
2. Vercel ↔ Neon
3. Vercel/browser ↔ S3 (presigned URLs)
4. Inngest ↔ job endpoint
5. GuardDuty/EventBridge ↔ scan webhook
6. Platform staff ↔ tenant data
7. CI ↔ environments

## Threats and controls

| # | STRIDE | Threat | Controls | Verified by |
|---|---|---|---|---|
| T1 | Information disclosure | **Cross-tenant data access** through IDOR, a missed filter, or a forged tenant ID | Server-derived TenantContext; `TenantDb` only; RLS with FORCE; composite FKs; no tenant ID taken from the client | Isolation suite (every entity × read/list/update/delete/export); RLS policy coverage check in CI |
| T2 | Elevation of privilege | User grants themselves a role, or edits a role above their own | `role.assign` permission; can't grant permissions you don't hold; privileged roles need tenant-admin plus MFA; audited | Authz tests |
| T3 | Elevation of privilege | Candidate account reaches staff APIs | Staff APIs require an active membership; candidate portal is a separate route group | Security test per staff route |
| T4 | Spoofing | Account takeover: credential stuffing, OTP brute force, SIM swap | Library hashing; rate limits; lockout/backoff; MFA (TOTP/passkey) for privileged roles; no SMS second factor for privileged roles; session revocation | Auth tests, rate-limit tests |
| T5 | Spoofing / CSRF | Cross-site request forgery on state changes | SameSite=Lax cookies; Next.js server action origin check; API mutations need JSON plus same-origin check | Tests |
| T6 | Tampering | Injection: SQL, header, template | Prisma parameterisation; raw SQL only through tagged templates and reviewed; Zod on every input | Lint rule against `$queryRawUnsafe`; tests |
| T7 | Tampering / XSS | Stored XSS in names, notes, job adverts | React escaping; no `dangerouslySetInnerHTML` without a sanitiser; strict CSP with nonces | Lint plus CSP header test |
| T8 | Tampering | Malicious upload: malware, polyglot, oversized file | Presigned PUT with a size condition; type allow-list; magic-byte check; GuardDuty scan before release; `Content-Disposition: attachment`; separate download origin (S3) | Document security tests |
| T9 | Information disclosure | Leaked or long-lived file URLs | GET URL lifetime ~60 s; permission check on every issue; audit for restricted documents | Tests |
| T10 | Repudiation / tampering | Audit records edited or deleted | INSERT/SELECT-only grant; trigger blocks UPDATE/DELETE; support actions linked to a grant | DB permission test |
| T11 | Elevation of privilege | Abuse of Macrovision support access | No standing access; time-boxed `SupportAccessGrant` with a reason; visible to the tenant; MFA required | Tests plus review |
| T12 | Information disclosure | Secrets in the repo, logs, Sentry or job payloads | `.env*` gitignored; secret scanning in CI (gitleaks) and GitHub push protection; pino redaction; Sentry scrubbing; job payloads carry IDs only | CI gate |
| T13 | Information disclosure | Preview or staging environment holds production data or credentials | Separate Neon projects; prod env vars only in Vercel Production scope; synthetic seed data | Deployment checklist |
| T14 | Information disclosure | Sensitive data in notifications (NT-03) | Templates reference records and link into the app; no pay, document or identity details in email or SMS | Template review and tests |
| T15 | Denial of service | Noisy tenant or abusive client (MT-08) | Per-IP and per-tenant rate limits; per-tenant job concurrency; heavy reports run async; upload quotas | Load test before launch |
| T16 | Denial of wallet | SMS pumping on OTP | Rate limits per number, IP and tenant; UK numbers only; CAPTCHA after thresholds; spend alerts | Tests plus provider alerts |
| T17 | Tampering | Forged webhook or job invocation | Inngest signature verification; signed scan-result webhook; idempotent handlers | Tests |
| T18 | Tampering / repudiation | Offline clock-in falsified (device time) | Server receipt time stored; offline entries flagged; manager approval; audit | Attendance tests |
| T19 | Supply chain | Compromised npm dependency | Exact pins plus lockfile; `npm ci`; Dependabot; `npm audit` in CI; minimal dependencies; review of install scripts | CI |
| T20 | Information disclosure | Verbose errors leak internals | problem+json with generic messages; stack traces only in server logs | Tests |
| T21 | Elevation of privilege | Stale permissions after a role change (IA-06) | No cross-request cache in Release 1; future cache keyed by `permissions_version` | Test: revoke, then the next request is denied |

## Residual risks and open items

- MFA policy details depend on TH-DEV-07.
- Data classification and retention depend on TH-DEV-06.
- Penetration testing by an independent party is recommended before commercial launch. It is not yet scheduled.
