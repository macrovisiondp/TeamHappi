# Milestone 1 Report — Repository and Application Setup

## Milestone

**Foundation Milestone 1.** Set up the Next.js application, tooling, tests, CI and a minimal application shell. No business features. No paid services.

## Implemented

- **Next.js 16.4 + React 19.3 + TypeScript 5.9 (strict, `noUncheckedIndexedAccess`).** Exact version pins and a committed lockfile. Cache Components, Partial Prefetching and typed routes are on (the Next 16.4 defaults).
- **Tailwind CSS 4.3** (Turbopack loader). Design tokens follow the shadcn/ui convention, with a teal brand accent and automatic dark mode. System fonts, so nothing is downloaded on older phones.
- **UI foundation:** `Button` and `Card` components (shadcn/ui source, Radix Slot), a responsive `AppShell` (sidebar on desktop, top bar on phones), accessible main navigation with `aria-current`, a skip link, and loading, error and not-found pages.
- **Pages:** `/` (public landing, clearly marked "in development") and `/dashboard` (an empty-state shell; no data and no sign-in yet).
- **API foundation:**
  - `GET /api/v1/health` (dynamic, `no-store`, reveals nothing about configuration).
  - `problem()` / `notFound()` helpers that implement the RFC 9457 error format from the API conventions.
- **Environment:** Zod-validated server environment (`src/lib/env`). It fails fast and reports variable **names only**, never values. `.env.example` lists M1 variables and placeholders for M2/M3. All M1 variables have safe defaults.
- **Security headers** on every response:
  - HSTS, `nosniff`, Referrer-Policy and Permissions-Policy
  - A CSP with `frame-ancestors 'none'`, `base-uri`, `object-src` and `form-action`
  - No `X-Powered-By`
  - API responses are `no-store`

  The script-restricting nonce CSP comes with authentication in M3.
- **Lint rules beyond Next's defaults**, each confirmed to fire on a probe file:
  - Module-boundary import restriction (`@/modules/<m>/<internal>` blocked)
  - A ban on `$queryRawUnsafe` / `$executeRawUnsafe`
  - `react/no-danger`
- **Tests:**
  - Vitest unit tests: env validation and problem responses.
  - Playwright smoke tests on **desktop and mobile (Pixel 5)** profiles: page rendering, navigation state, 404, skip-link focus, **axe WCAG 2.2 AA checks**, health endpoint and security headers.
- **CI (GitHub Actions)**, pinned to commit SHAs with read-only permissions:
  - lint → typecheck → format check → unit tests → build → Playwright
  - Dependency audit (production dependencies blocking at high; all dependencies report-only)
  - gitleaks secret scan of the full history (binary checksum verified)
  - Dependabot for npm and Actions
- **Repository hygiene:** `.gitattributes` (LF line endings, fixing the Windows CRLF warnings), `.editorconfig`, `.npmrc` (`save-exact`, `engine-strict`), `.nvmrc` (22), Next's `AGENTS.md` (referenced from CLAUDE.md), and an updated README and CLAUDE.md.

**Not built (as instructed):** recruitment, onboarding, training, rota, attendance, payroll, authentication, database.

## Files Changed

New:

```
.editorconfig  .env.example  .gitattributes  .npmrc  .nvmrc  .prettierignore  .prettierrc.json
AGENTS.md  components.json  eslint.config.mjs  next.config.ts  package.json  package-lock.json
playwright.config.ts  tsconfig.json  vitest.config.mts
.github/workflows/ci.yml  .github/dependabot.yml
src/app/{layout,page,not-found,error}.tsx  src/app/globals.css
src/app/(app)/{layout,loading}.tsx  src/app/(app)/dashboard/page.tsx
src/app/api/v1/health/route.ts
src/components/ui/{button,card}.tsx  src/components/layout/{app-shell,brand,main-nav}.tsx
src/lib/utils.ts  src/lib/env/{schema,index}.ts  src/lib/api/problem.ts
tests/unit/{env,problem}.test.ts  tests/e2e/smoke.spec.ts
docs/development/milestone-1-report.md
```

Modified: `README.md`, `CLAUDE.md`, `docs/development/backlog.md`, `docs/decisions/0002-technology-stack.md` (version corrections: TypeScript 5.9.3 and ESLint 9.39.5, matching what Next 16.4 scaffolds; shadcn hand-copied).

`src/modules/`, `src/shared/`, `tests/integration/` and `tests/security/` were **not** created yet, because they would be empty. They arrive with their first real code in M2.

## Database Changes

None.

## Security Review

- **No tenant data, authentication or database exists yet,** so there is no tenant-isolation surface in this milestone.
- `/dashboard` is reachable without signing in. It renders static text only. Auth gating is added in M3.
- Env errors never echo values (unit-tested). The health endpoint exposes no configuration.
- **Dependency audit:**
  - **Production dependencies: 0 vulnerabilities.**
  - Dev dependencies: 5 *high* advisories from one root cause, `braces` (GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS on deeply nested glob patterns). It is pulled in by `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob`. **No fixed version exists.** The only "fix" npm offers downgrades to `eslint-config-next@14`, which is incompatible. It runs only at lint time, on glob patterns we write, never in the shipped app. Accepted, and tracked through the report-only CI step and Dependabot.
- Secret check:
  - `.env*` is ignored except `.env.example`.
  - A local pattern scan of the new files found nothing.
  - gitleaks is not installed locally, so **it runs in CI only.** It has not run yet (see Tests).

## Tests

Commands run locally on Windows 11, Node 22.17.0, on 9 October 2026:

| Command | Result |
|---|---|
| `npm run lint` | ✅ Passed (0 errors, 0 warnings, `--max-warnings=0`) |
| `npx eslint <probe file>` (temporary, deleted) | ✅ Boundary, raw-SQL and `no-danger` rules each reported their violation |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | ✅ Passed |
| `npm run format:check` | ✅ Passed |
| `npm test` (Vitest) | ✅ 2 files, **8/8 tests passed** |
| `npm run build` | ✅ Compiled; routes `/`, `/dashboard` static, `/api/v1/health` dynamic |
| `PORT=3105 npm run test:e2e` (Playwright, Chromium) | ✅ **18/18 passed** (9 tests × desktop + mobile), including axe accessibility on 3 pages |
| `npm audit --omit=dev --audit-level=high` | ✅ 0 vulnerabilities |

Notes:

- Port 3000 was taken on this machine by another process, so E2E ran on port 3105. That process was not touched.
- **GitHub Actions has not run yet.** CI triggers when the pull request is opened. GitHub CLI isn't installed here, so I can't open the PR or read CI results myself. Please check the PR's **Checks** tab.

## Deployment

None. No Vercel project, Neon database or other cloud resource was created. Nothing was deployed.

## Outstanding Issues

- CI's first real run is pending (see above).
- The dev-dependency `braces` advisory has no upstream fix (accepted, monitored).
- Risks R-1..R-8 from the [Sprint 0 report](sprint-0-report.md#material-unresolved-risks) are unchanged. R-1 (Vercel Hobby is non-commercial) matters as soon as you connect Vercel.
- Interim specifications IS-03/IS-07 need your review before M3 sign-off.

## Next Step — Milestone 2: PostgreSQL and tenant model

### What I will build

- Prisma 7.10 with the PostgreSQL adapter
- The first schema: tenant, user, membership, roles and permissions, site, team, employee core
- A hand-reviewed SQL migration adding RLS (ENABLE + FORCE), composite tenant foreign keys and least-privilege grants
- `TenantContext` and `TenantDb`
- A tenant-creation service
- **The cross-tenant isolation test suite**, running in CI against a free Postgres container

### What I need from you to connect Neon

1. **Create a Neon account** (Free plan) and a project:
   - **Name:** `teamhappi-dev`
   - **Region:** AWS Europe (London), `aws-eu-west-2`
   - **Postgres version:** the newest offered
   - **Database name:** `teamhappi`
2. **Create the application role with SQL, not the console.**
   - Roles created in the Neon console are given broad built-in privileges. These may include bypassing Row-Level Security, which would defeat the database layer of tenant isolation. A role created with SQL doesn't get them.
   - In Neon's **SQL Editor**, run this with a strong password you generate yourself (a password manager is fine):

     ```sql
     CREATE ROLE teamhappi_app WITH LOGIN PASSWORD '<your-generated-password>'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
     ```

     I'll handle all grants in the reviewed migration. M2 also includes a test that fails if the app role can bypass RLS.
3. **Put two connection strings in a file I can read but Git ignores.** Create `C:\Users\DELL\TeamHappi\.env.local` containing:

   ```
   DATABASE_URL=<pooled connection string for teamhappi_app>        # Neon "Pooled connection" ON
   DATABASE_MIGRATION_URL=<direct connection string for the owner role>  # Neon "Pooled connection" OFF
   ```

   - **Please don't paste the strings into this chat.** That would copy them into the conversation history.
   - `.env.local` is already excluded from Git.
4. **Tell me when it's done.** Nothing in M2 touches production, and I will show you each migration's SQL before applying it to your Neon database.

**Optional:** connecting Vercel Hobby isn't needed for M2. If you do connect it, keep it to private development (risk R-1). Don't add the database variables to Vercel yet.
