# ADR-0006: Background jobs, domain events and the transactional outbox

- **Status:** Outbox pattern proposed. **Inngest NOT approved.** The free-tier fallback (outbox + `after()` dispatch + daily Vercel Cron sweep) is the current plan; see [free-tier-limits](../architecture/free-tier-limits.md).
- **Date:** 2026-10-08
- **Requirements:** JOB-01, MT-04, MT-08, NT-01, Master prompt §5.6

## Decision

1. **Transactional outbox in PostgreSQL.**
   - A service that changes state writes an `outbox_event` row in **the same transaction**, for example `recruitment.candidate.hired`.
   - If the transaction commits, the event exists. If it rolls back, the event does not. No business event is lost and none is phantom.
2. **A relay publishes outbox rows to Inngest.**
   - It runs right after the commit, with a cron sweep as a fallback.
   - Rows are marked as published. Redelivery is safe because every consumer is idempotent.
3. **Inngest executes the functions:**
   - Retries with backoff
   - Cron schedules, which fan out per tenant
   - **Per-tenant concurrency keys and throttling** (fairness under MT-08)
   - A run history for monitoring
4. **Payload rules:**
   - `{ tenantId, eventId, entity IDs }` only. **No personal data** leaves our database.
   - The handler rebuilds `TenantContext` from `tenantId` and checks that the tenant is active.
   - It records `eventId` in a `processed_event` table. Deduplication is enforced by a unique constraint.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Vercel Cron + Postgres polling queue | Works for cron, but we would have to build retries, backoff, concurrency fairness and observability ourselves. Function time limits make long queues fragile. This remains the **fallback** if Inngest is not approved. |
| Trigger.dev | A comparable option. Inngest's event fan-out and concurrency keys match this need more directly. |
| Upstash QStash | Simple HTTP delivery, but weaker workflow and concurrency semantics |
| pg-boss / BullMQ | Need a long-running worker process, which does not fit Vercel serverless |

## Consequences

- One extra managed service, and its signing key is a secret.
- Local development uses the Inngest dev server, which needs no account.
- The relay and idempotency are tested in Milestone 4: this includes retry, a crash after the commit, and duplicate delivery.
