# Platform Admin and integrations architecture

Status: proposed for review (13 Oct 2026). Branch `feat/platform-admin-foundation`, stacked on PR #6.

## 1. Route map

| Route | Purpose | Status |
|---|---|---|
| `/platform` | Redirects to the overview | Built |
| `/platform/dashboard` | Platform overview: organisations, active providers, health, recent activity | Demo (synthetic) |
| `/platform/integrations` | One card per service category | Demo |
| `/platform/integrations/email` | Development mailer, Resend, Amazon SES | Demo |
| `/platform/integrations/storage` | Synthetic store, Amazon S3, Cloudinary (media only) | Demo |
| `/platform/integrations/payments` | Synthetic gateway, Stripe, Paystack, Flutterwave | Demo |
| `/platform/integrations/ai` | Kill switch, features, budgets, providers | Demo |
| `/platform/integrations/credentials` | Credential metadata and rotation history | Demo |
| `/platform/integrations/audit` | Integration audit log | Demo |
| `/platform/settings` | Your access level, MFA status and deployment environment | Live: it reads the real session and environment |

Every privileged control ("Configure", "Test connection", "Make active", "Rotate a credential", "Turn AI on") is **disabled, with a visible reason**. The server-side guard `assertPrivilegedPlatformAction` refuses all privileged actions regardless of what the page shows.

## 2. Access control

- The platform area has its **own layout and navigation**: no tenant selector, no tenant data.
- **Who can see it:** `src/app/platform/layout.tsx` validates the session on the server for every request:
  - signed-out visitors are redirected to `/sign-in`;
  - anyone without platform access gets **404**, so the console's existence isn't confirmed to them.
- **Until M3.5:** the only access is a **read-only preview**, granted when *all* of these hold:
  - the deployment is not production (`deploymentEnvironment()`, from `VERCEL_ENV`; unknown values count as production);
  - the signed-in, verified email is listed in `PLATFORM_PREVIEW_STAFF_EMAILS`;
  - that address is a reserved test domain (`example.test` and similar). Real addresses are ignored.
- **From M3.5:** a real `PlatformStaffActor` replaces the preview. It requires:
  - a validated session;
  - an active `platform_staff` grant;
  - MFA (M3.4).

  Privileged actions will also need step-up confirmation.
- **Static guards:** `tests/unit/platform-access.test.ts` fails if:
  - a client component imports integration or platform-access code;
  - any `NEXT_PUBLIC_` variable looks like a secret;
  - anything except the access module reads the preview list;
  - a platform page is not rendered per request.

## 3. Code layout

```
src/integrations/
  core/        types, deployment environment, redaction, audit events, config versions, circuit breaker
  registry.ts  providers, readiness, non-secret config schemas, secret field names
  email/       EmailProvider, dev mailer, unactivated live adapters, idempotent fallback sender, test-send guard
  storage/     StorageProvider, tenant object keys, classification limits, upload policy, per-object provider
  payments/    currency routing, webhook signature verification, exactly-once payment ledger
  ai/          capability routing, kill switch, features, data guard, redaction, budgets, synthetic adapter
  credentials/ SecretStore interface, CredentialSet (register/validate/activate/rollback/revoke)
src/lib/platform-access/   server-side access decision and privileged-action guard
src/features/platform/     synthetic fixtures and Platform Admin components
src/app/platform/          routes
```

## 4. Adapter specifications

### Email

| | Development mailer | Resend | Amazon SES |
|---|---|---|---|
| Readiness | Synthetic | Adapter ready (no network) | Adapter ready (no network) |
| Non-secret configuration | none | sender name, sender address, sending domain | sender name, sender address, sending domain, region, configuration set |
| Secrets | none | `apiKey` | `accessKeyId`, `secretAccessKey` (prefer IAM role federation later) |
| Rules | Refuses production; logs recipient and subject only | Domain must be verified (SPF, DKIM, DMARC) before activation | London region (`eu-west-2`); account must leave the SES sandbox |

**Rules for all email providers:**
- **Duplicates and fallback:** every message has an idempotency key. Fallback happens only after a retryable failure; an ambiguous failure (for example a timeout after sending) is never resent elsewhere.
- **Test sends:** only to reserved test domains.
- **Delivery failures:** recorded without the message body.

### Storage

| | Synthetic | Amazon S3 | Cloudinary |
|---|---|---|---|
| Highest classification | restricted (tests only) | restricted | **media only** |
| Configuration | none | bucket, region, KMS key alias | cloud name, folder |
| Secrets | none | access key id and secret (prefer role federation) | API key and secret |

**Rules for all storage providers:**
- **Object keys** are `tenants/<tenant uuid>/objects/<random id>`, built on the server. The tenant check returns "not found" for another tenant's object.
- **Links** for upload and download live for at most 5 minutes.
- **Uploads** must pass an allow-list of file types and a size limit.
- **Before real uploads are enabled:** malware scanning (quarantine first), retention and deletion jobs, and audit of every restricted view (ADR-0007).
- **Provider per object:** each object records the provider that holds it. Switching providers affects new uploads only.

### Payments

Billing for TeamHappi's own subscriptions only. It is separate from payroll.

| | Synthetic | Stripe | Paystack | Flutterwave |
|---|---|---|---|---|
| Readiness | Synthetic | Adapter ready | Planned | Planned |
| Configuration | none | mode (sandbox or live), currencies | mode, currencies | mode, currencies |
| Secrets | webhook signing secret | secret key, webhook signing secret | secret key | secret key, webhook signing secret |

**Rules for all payment providers:**
- **Checkout** is hosted by the provider. TeamHappi never sees card numbers or CVVs (lowest PCI scope).
- **Webhooks:**
  - the HMAC-SHA256 signature is checked over the raw body;
  - timestamps more than ±5 minutes off are rejected;
  - each (provider, event id) is processed once, with a unique constraint in the future table;
  - payment status changes only through allowed transitions.
- **Browser redirects** never mark a payment as paid.
- **Routing:** a provider is chosen per currency. Live routes are ignored unless live payments are approved.
- **Reconciliation:** a scheduled job compares local events with the provider's records (to be designed with the billing tables).

### AI

| | Synthetic | Anthropic, OpenAI, Gemini, Bedrock, Azure OpenAI |
|---|---|---|
| Readiness | Synthetic | Planned |
| Configuration | none | default model, data region |
| Secrets | none | API key (Bedrock: AWS keys or role) |

Each request goes through these checks, in this order:
1. Global kill switch.
2. Feature enabled.
3. Tenant present.
4. Data guard: only `public` or `operational` data may leave TeamHappi. Personal, special-category, identity, right-to-work, payroll and health data are refused.
5. Redaction of emails, phone numbers, NI numbers and bank-like numbers.
6. Budget: requests, tokens and spend in pence, all reserved before the call.
7. Capability-based model choice, with fallback models.

All output is labelled `reviewRequired`. AI never makes employment decisions.

**Still to design before any live AI:**
- prompt-injection defences, with no tool execution from model output;
- per-provider data-processing terms and retention settings (zero-retention where offered);
- logging of metadata only.

## 5. Configuration, health and audit

| Capability | Where |
|---|---|
| Provider registry | `registry.ts` |
| Active provider per category and environment | `ConfigHistory`, later persisted |
| Configuration schemas | zod per provider |
| Environment separation | `deploymentEnvironment()`; credentials scoped per environment |
| Versioning and rollback | `ConfigHistory.activate` / `rollback` |
| Health checks and circuit breaker | `CircuitBreaker`; health badges |
| Usage and cost | AI `BudgetState`; provider usage later |
| Failure alerts and expiry reminders | Planned (needs the outbox and a scheduler, ADR-0006) |
| Audit | `buildAuditEvent`; durable append-only `platform_audit_event` in M3.2/M3.5 |

## 6. Persistence (not in this PR)

These tables will be proposed with reviewed SQL. None are created here.
- **`integration_config`:** id, category, provider id, environment, version, non-secret JSON, validated at, active, created by.
- **`integration_credential`:** id, provider id, environment, version, status, timestamps, secret reference (stage 1: the name of the Vercel variable; stage 2: a ciphertext row).
- **`integration_secret`** (stage 2 only): ciphertext, data-key ciphertext, KEK version.
- **`platform_audit_event`:** append-only, already planned in M3.2.
- **`billing_event`:** unique (provider, event id).
- **`document.storage_provider`:** a new column.

All of these are global platform tables, readable only by `teamhappi_platform` (ADR-0009), except `document.storage_provider`, which is tenant-owned and covered by RLS.
