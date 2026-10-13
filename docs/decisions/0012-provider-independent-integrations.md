# ADR-0012: Provider-independent integrations

- **Status:** Proposed (13 Oct 2026)
- **Date:** 2026-10-13
- **Requirements:** Master directive Phases 4 and 6
- **Related:** ADR-0006 (outbox), ADR-0007 (documents), ADR-0011 (secrets), `docs/architecture/platform-integrations.md`

## Context

TeamHappi needs email, file storage, SaaS billing and optional AI, from several possible providers each. Macrovision wants to be able to switch providers without rewriting business modules.

## Decision

1. **One interface per service category, in `src/integrations/<category>`:**
   - `EmailProvider`
   - `StorageProvider`
   - payment routing and webhook ledger
   - AI request planner

   Business modules depend on these interfaces only, never on a vendor SDK.
2. **A provider registry** (`src/integrations/registry.ts`) lists every provider with:
   - its readiness (`synthetic`, `adapter-ready` or `planned`);
   - a zod schema for its **non-secret** configuration;
   - the names of its secret fields.

   Submitting a secret field as configuration is rejected.
3. **Configuration is versioned:** only a validated version can be activated, and a rollback re-activates the last validated version (`ConfigHistory`).
4. **Provider choice is server-side configuration,** set in Platform Admin by platform staff. The browser never chooses a provider, tenant or credential.
5. **Switching is safe by construction:**
   - **Email:** messages carry an idempotency key. Fallback happens only after a *retryable* failure, meaning the provider definitely did not accept the message.
   - **Storage:** every object records the provider that holds it. Reads go there, so switching the upload provider never orphans or silently migrates files. Migration between providers is a separate, explicit job.
   - **Payments:** state changes only through verified webhooks, processed once per (provider, event id).
   - **AI:** a request is planned once, with its budget reserved before the call.
6. **Health:** a circuit breaker per provider turns outages into fast, explicit failures. Health, latency and error counts appear in Platform Admin.
7. **No network calls until approved:** adapters for real providers are placeholders that throw `ProviderNotActivatedError`. A static test fails if integration code imports a vendor SDK or calls `fetch`. Each live adapter is added in its own reviewed PR after approval.

## Alternatives

- **Vendor SDKs called directly from modules.** Faster to start, but switching providers would mean rewriting modules, and secrets would spread through the codebase.
- **A single generic "integration" table and interface.** This hides real differences between providers, such as webhooks, presigned URLs and model capabilities. Category interfaces are a better fit.

## Consequences

- Each provider needs an adapter, validation and tests before it can go live.
- Durable state (configuration versions, credential metadata, audit and billing events, the storage object provider column) needs migrations. They will be proposed with reviewed SQL, separately from this PR.
