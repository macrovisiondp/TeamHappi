# TeamHappi

Multi-tenant workforce management for UK hospitality: recruitment, onboarding and compliance, training, rota, attendance, and later payroll.

**Status:** Milestone 1 (application setup). The application shell only; no business features yet.

## Local development

Requirements: Node.js 22 (see `.nvmrc`) and npm.

```bash
npm ci
cp .env.example .env.local   # optional in Milestone 1; all variables have safe defaults
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run check` | Lint, type check, format check, unit tests, production build |
| `npm run test:e2e` | Browser tests (desktop + mobile) with accessibility checks. Run `npm run build` first. `npx playwright install chromium` once. |

CI (GitHub Actions) runs all of the above plus a dependency audit and a gitleaks secret scan on every pull request.

| Start here | |
|---|---|
| Architecture proposal (TH-DEV-05) | [docs/architecture/solution-architecture.md](docs/architecture/solution-architecture.md) |
| Decisions | [docs/decisions/](docs/decisions/README.md) |
| Requirements and review | [docs/requirements/](docs/requirements/requirements-review.md) |
| Backlog | [docs/development/backlog.md](docs/development/backlog.md) |
| Sprint 0 report | [docs/development/sprint-0-report.md](docs/development/sprint-0-report.md) |

Engineering rules for contributors and AI assistants: [CLAUDE.md](CLAUDE.md).

© Macrovision Digital Solution. Proprietary.
