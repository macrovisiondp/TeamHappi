# Architecture Decision Records

| ADR | Title | Status |
|---|---|---|
| [0001](0001-multi-tenancy-model.md) | Multi-tenancy model | Direction provisionally approved |
| [0002](0002-technology-stack.md) | Technology stack and versions | Direction provisionally approved (versions corrected in M1) |
| [0003](0003-hosting-and-data-residency.md) | Hosting, environments and data residency | Vercel + Neon provisionally approved; paid parts not approved (free tier) |
| [0004](0004-authentication.md) | Authentication and authorisation | Better Auth provisionally approved, subject to validation |
| [0005](0005-client-application-approach.md) | Client application approach | Direction provisionally approved |
| [0006](0006-background-jobs-and-outbox.md) | Background jobs and transactional outbox | Outbox proposed; Inngest not approved (free fallback) |
| [0007](0007-document-storage.md) | Secure document storage | Proposed; AWS not approved (blocks real documents) |
| 0008 | Rate-limiting store (Postgres-backed on free tier) | To be written (M3) |
| 0009 | Observability / log retention provider | To be written (M4) |

Format: Status, Date, Requirements, Context, Decision, Alternatives, Consequences. An ADR becomes **Accepted** when the product owner approves it. A changed decision gets a new ADR that supersedes the old one. Never edit an accepted ADR's decision in place.

Provisional approval (8 Oct 2026) covers the **direction** only. Each ADR's details stay open for final review.
