# M3-UI — Frontend Foundation: Design Proposal and Route Map

| Field | Value |
|---|---|
| Status | Increment 1 (shell, design system, dashboard, People) on `feat/m3-ui-foundation`. For review; not merged. |
| Direction | **Warm Hospitality**: "People first. Every shift." |
| Stack | Existing Next.js 16 / React 19 / TypeScript / Tailwind 4. No paid UI libraries. Icons from `lucide-react` (already a dependency). Fonts self-hosted by `next/font` at build time, so browsers make no requests to Google. |
| Data | Real session (M3.1) for the signed-in user. **Synthetic, clearly labelled fixtures** for every business module, which aren't built yet. No database changes, no Neon operations. |

## 1. Design tokens

Brand colours are for identity. Status colours are a separate semantic set, and **every status also has an icon and a text label**, so meaning never depends on colour alone.

| Token | Value | Use |
|---|---|---|
| `--brand-forest` | `#205B4E` | Primary actions, active navigation, focus ring. White text on it has a contrast ratio of 8.0 : 1. |
| `--brand-coral` | `#E87861` | Accent only: avatars, highlights. Never text on light backgrounds, and never a status. |
| `--brand-honey` | `#F0B94B` | Accent only: the "demo data" marker background, with charcoal text on top |
| `--bg` | `#FAF8F3` warm ivory | Page background |
| `--surface` | `#FFFFFF` | Cards, tables, dialogs |
| `--surface-sage` | `#E7F0E8` | Selected navigation, subtle panels |
| `--text` | `#292723` charcoal | Body text (14 : 1 on ivory) |
| `--text-muted` | `#5D584F` | Secondary text (6.6 : 1 on ivory) |
| `--border` | `#E2DCCF` | Hairlines; `--border-strong` `#B9B1A2` for inputs (3 : 1 against white) |
| `--success` / `--warning` / `--danger` / `--info` | fg `#1E6B3A` / `#7A4A00` / `#A3271B` / `#1F4E79`, each with a matching tinted background and border | Status badges, alerts and validation, always with an icon and text |
| Typography | **Plus Jakarta Sans** (headings, 600–700) and **Inter** (body and interface), with system-font fallbacks | Scale 12 / 14 / 16 / 18 / 20 / 24 / 30 px; tabular numbers in tables and statistics |
| Spacing | Tailwind's 4 px scale | |
| Shape | Cards 16 px radius, controls 10 px, subtle two-layer shadow | |
| Motion | 150 ms colour and opacity transitions only; all motion is off under `prefers-reduced-motion` | |
| Targets | Interactive controls at least 44 px high (40 px for compact table buttons, with 44 px spacing) | |

Copy and formats are UK English: dates as `12 Oct 2026` and times in the 24-hour clock, using the `en-GB` locale and the `Europe/London` time zone.

## 2. Component architecture

```
src/components/ui/       Design-system primitives (no data fetching)
  button  input  select  field  card  badge  status-badge  alert  empty-state
  table   dialog  avatar  skeleton  page-header  stat-card  demo-notice
src/components/layout/   App shell: sidebar, mobile drawer, header (organisation
                         selector, notifications, account menu), nav config
src/components/states/   Loading, error, empty, permission-denied, coming-soon
src/features/demo/       Synthetic fixtures + types (the only source of demo data)
src/features/people/     Directory filtering (pure, unit-tested), table, profile
src/lib/format.ts        en-GB / Europe/London date and time formatting
```

- **Primitives** are server-renderable where possible. Interactive pieces (dialog, menus, mobile drawer, directory filters) are small client components.
- **Dialog** uses the native `<dialog>` element with `showModal()`, which gives built-in focus trapping, Escape to close and an inert background.
- **Security:**
  - the shell shows the **real signed-in user** from `getCurrentUser()`;
  - the organisation selector is display-only (disabled) until M3.3 adds server-validated tenant switching, and it never sends a tenant ID;
  - every action without a backend is **disabled and labelled**;
  - no client-side check replaces a server check.

## 3. Route map

| Route | Increment 1 | Data |
|---|---|---|
| `/sign-in`, `/verify-email` | Restyled with the new design system | **Live** (M3.1) |
| `/dashboard` | Workforce dashboard: today's staffing, open shifts, compliance alerts, onboarding and training status | **Demo** |
| `/people` | Staff directory: search, site and status filters, responsive table and card list | **Demo** |
| `/people/[employeeId]` | Employee profile: employment, sites and teams, onboarding, training, documents (metadata only) | **Demo** |
| `/recruitment`, `/onboarding`, `/training`, `/rota`, `/attendance` | Module overview pages ("planned") with what's coming. Full screens come in later increments. | Planned |
| `/settings` | Organisation, sites and teams, users and invitations overview ("planned") | Planned |
| `/access-denied` | Permission-denied state, ready for server-side checks in M3.3 | Static |
| Every `(app)` route | Requires a signed-in, verified user (M3.1 gate, unchanged) | **Live** gate |

The header, sidebar and account menu are live: real user name and email, and real sign-out. The notifications panel shows demo items.
