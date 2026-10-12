# ADR-0008: Separate database role for authentication

- **Status:** Proposed. The role and its use were approved in principle on 12 Oct 2026; the SQL is awaiting review. Not applied to Neon.
- **Date:** 2026-10-12
- **Requirements:** IA-01..04, IA-06; the M2 security boundary (design doc §5a); M3 plan decision 2
- **Related:** ADR-0001 (tenancy), ADR-0004 (authentication)

## Context

Sign-up, sign-in, email verification and session checks happen **before any tenant context exists**. They also need data the tenant application must never see: session tokens, password hashes, verification tokens and rate-limit counters.

Running them as `teamhappi_app` would mean one of two bad options:
- giving the tenant role cross-tenant identity access, which weakens §5a;
- adding a bypass path inside the tenant role's RLS.

## Decision

A third login role, **`teamhappi_auth`**:

- **Role attributes:** LOGIN, NOSUPERUSER, **NOBYPASSRLS**, NOCREATEDB, NOCREATEROLE, NOREPLICATION. It is a member of no other role and owns nothing. Session settings: `statement_timeout` and `idle_in_transaction_session_timeout` of 15 s, `search_path = public`, `timezone = UTC`.
- **Tables:** `user`, `session`, `account`, `verification`, `rate_limit` only.

  | Table | Grants |
  |---|---|
  | `user` | SELECT, INSERT, UPDATE |
  | `session` | SELECT, INSERT, UPDATE, DELETE |
  | `account` | SELECT, INSERT, UPDATE |
  | `verification` | SELECT, INSERT, UPDATE, DELETE |
  | `rate_limit` | SELECT, INSERT, UPDATE, DELETE (Better Auth deletes expired rows) |

  It cannot delete users. It has **no** grants on any tenant-owned table, the tenant registry, the permission catalogue, the `app` schema or migration history.
- **RLS:** ENABLE + FORCE on all four new tables, each with a single policy `TO teamhappi_auth`. `user` keeps the app's tenant-scoped read-only policy and gains an `auth_identity` policy for this role.
- **Application role:** `teamhappi_app` gets **nothing** on the new tables. Even if a grant were added by mistake, RLS would show it no rows.
- **Code boundary:** only `src/lib/auth` builds the auth Prisma client and the Better Auth instance. ESLint blocks importing its internals elsewhere, and static tests also check this. The rest of the app gets only `getCurrentUser()`, which returns user ID, session ID, name and email, and never tokens or hashes.

## Alternatives considered

| Option | Why not |
|---|---|
| Better Auth on `teamhappi_app` | Cross-tenant identity access inside the tenant role, plus session and credential tables readable by business code |
| A `SECURITY DEFINER` function per auth operation | Better Auth issues many varied queries through its adapter; wrapping each is brittle and harder to review than a narrow role |
| A separate identity database | Strongest separation, but a second Neon database or project and cross-database user references; not justified at this scale. MT-09 keeps this open. |

## Consequences

- Neon needs one more role, created through reviewed setup SQL (`prisma/bootstrap/neon-dev-auth-role.sql`) with a password generated at execution time. The app gets a second pooled connection pool.
- **Known limitation:** Better Auth stores session tokens in `session.token` in plain text, not hashed. Anyone who can read that table could hijack sessions. Only `teamhappi_auth` and the owner can read it, and the tests prove `teamhappi_app` cannot. Hashing tokens would need a Better Auth customisation; it's a follow-up for review.
- **Finding during the spike:** Prisma's PostgreSQL adapter assumes the database session time zone is UTC. The setup SQL now pins `timezone = 'UTC'` on both login roles (§3 of the M3.1 design).
