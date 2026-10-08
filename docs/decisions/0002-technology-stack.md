# ADR-0002: Technology stack and versions

- **Status:** Direction provisionally approved (2026-10-08); details pending final review
- **Date:** 2026-10-08
- **Requirements:** AR-REQ-01..07

## Decision

A **TypeScript modular monolith on Next.js (App Router)**, with PostgreSQL through Prisma. Versions were checked against the npm registry on 2026-10-08 and will be pinned exactly in `package.json`, with `package-lock.json` committed.

| Concern | Choice | Version to pin | Note |
|---|---|---|---|
| Runtime | Node.js LTS | 22.x (local 22.17.0) | Next 16 requires ≥ 20.9 |
| Framework | Next.js App Router | 16.4.0 | |
| UI | React | 19.3.0 | |
| Language | TypeScript | **5.9.3** | *Corrected in M1 (was 6.0.3):* `create-next-app@16.4.0` scaffolds `typescript@^5`, so we stay on the major Next 16.4 is tested with. TS 6/7 is a planned upgrade task. |
| Styling | Tailwind CSS | 4.3.3 | |
| Components | shadcn/ui (copied source, Radix primitives) | CLI at setup | Accessible primitives. We own the code. |
| Forms / validation | React Hook Form 7.89.0, Zod 4.6.5 | | The same Zod schemas validate the API boundary |
| ORM | Prisma + `@prisma/adapter-pg` | **7.10.0** | Not 8.0.0-rc: the npm `latest` tag currently points at a release candidate. We pin stable 7.10.0. |
| Auth | Better Auth | 1.7.7 | See ADR-0004 |
| Unit/integration tests | Vitest | 5.0.3 | |
| E2E | Playwright | 1.64.0 | |
| Lint / format | ESLint **9.39.5** + eslint-config-next 16.4.0 (bundles typescript-eslint 8), Prettier 3.9.9 | | *Corrected in M1 (was ESLint 10):* the Next 16.4 scaffold and its plugins target ESLint 9 |
| Tailwind build | `@tailwindcss/turbopack` 4.3.3 | | Next 16.4's default Tailwind integration (Turbopack loader, no PostCSS config) |
| Logging | pino | 10.4.0 | Structured JSON with redaction paths |

## Architecture shape

- **Modular monolith** (AR-REQ-07). One deployable unit, one database, and modules under `src/modules/*`.
  - Boundaries are enforced by ESLint import rules: a module may import another module only through that module's `index.ts` public API.
  - Modules change each other's state only through public service calls or domain events (see [module boundaries](../architecture/module-boundaries.md)).
- **Versioned API (AR-REQ-04).** Every server capability is exposed under `/api/v1/...` route handlers. Web UI server actions are thin adapters that call the **same service functions**, so authorisation and validation are never duplicated or skipped.
- **Layers per module:** `api` (route handlers and actions: parse and authorise) → `service` (business rules, transactions, audit, events) → `repository` (`TenantDb` queries). Pages contain no business logic.

## Alternatives considered

- **NestJS back end + separate front end.** Two deployables and duplicate types, with no requirement that justifies them.
- **Microservices.** Rejected per AR-REQ-07. Operational cost and distributed transactions without benefit at this scale.
- **Drizzle instead of Prisma.** It is closer to SQL and handles RLS well. Prisma is the product owner's stated preference and is well understood. The RLS-in-transaction pattern works with Prisma client extensions. We will revisit Drizzle only if Prisma blocks the tenancy design during Milestone 2.

## Consequences

- Upgrading major versions is a deliberate task, never a side effect of `npm install`.
- TS 7 (the native compiler) is deferred until lint tooling supports it.
