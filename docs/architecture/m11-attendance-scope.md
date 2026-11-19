# M11: Basic time and attendance (scope)

**Status:** **approved** by the product owner on 19 November 2026: scope and decisions D1–D11 as recommended. Each increment still needs its own Neon approval.

**Requirement:** TH-DEV-02 rev 0.2, Capability 5, Release 1 boundary (approved):
- clock-in and clock-out;
- timesheet records;
- planned versus actual hours, against the **published** rota;
- manager review and approval of timesheets.

Holidays, leave balances and absence records are **Release 2**. Pay is **later** (after specialist validation).

**Builds on:**
- **Rota (M10):** published shifts, assignments and the change history. M11 only reads the rota, through `src/modules/rota/index.ts`.
- **People (M4):** sites, teams and employees. Employees don't need a login (A-2).
- **Logins (M7.3):** worker logins and the phone-first "My …" pages.

## 1. Principles

- **Record what happened; don't calculate pay.** We store the real clock times, never rounded. "Hours" means time worked minus breaks. No rates, no money, no overtime rules.
- **The manager's approval is the control.** Anything unusual is flagged for review, not silently fixed. The app never invents a clock time.
- **History is never lost.** A correction keeps the original time, who changed it, when and why. Approved timesheets are locked; reopening one needs a reason and is audited.
- **Phones first for workers.** Staff without a login still get their hours recorded, by their manager.
- **Same foundations as before:** tenant isolation (RLS, composite keys), site-scoped permissions on the server, ids-only audit, no deletes.

## 2. Recommended increments

| Increment | What it delivers | Gate |
|---|---|---|
| **M11.1 Clocking** | **Workers:** a "Clock in" / "Clock out" button on My shifts, matched to today's published shift if there is one; optional break start and end. **Managers:** a live "Who's in" view per site (on shift, late, not clocked in, still clocked in after the shift); record or correct times for anyone, with a reason. Flags for: no matching shift, early or late beyond the tolerance, missed clock-out. | Approval of this scope, then Neon approval |
| **M11.2 Timesheets and approval** | One timesheet per site per rota week. Planned versus actual per person and per shift, with the flags from M11.1. Managers fix, then **approve**, which locks the week; reopening needs a reason. Workers see their own approved hours. | Neon approval |
| **M11.3 Export** | A CSV of **approved hours only** (person, date, site, hours; no money) for whoever runs payroll outside TeamHappi today. Every export is audited. | Neon approval (no migration expected) |
| **Later** | Offline clock-in queue (A-6, ADR-0005), with the installable app. Kiosk or shared-tablet clocking. Location checks (see D2). Holidays and absence (Release 2). Pay (later). | |

## 3. M11.1 and M11.2 data model (proposed, tenant-owned, RLS)

| Table | Holds |
|---|---|
| `time_entry` | employee, site, shift? (null when there was no matching shift), clock in at, clock out at? (null while clocked in), source (`self`/`manager`), flags, created by. **At most one open entry per person** (a partial unique index), so nobody can be clocked in twice. |
| `time_break` | time entry, break start, break end? (null while on break) |
| `time_entry_change` | append-only history: field, old value, new value, reason, by whom, when |
| `timesheet` | site, rota week, status (`open`/`approved`), approved by and at, reopened by, at and reason |

No pay columns. Times are `timestamptz`, so clocks going forward or back are handled, as in the rota.

## 4. Permissions (new, mirrored in the catalogue and migration)

| Code | Owner, admin, HR | Site manager | Recruiter | Worker |
|---|---|---|---|---|
| `attendance.view` ("Who's in", timesheets) | all sites | their sites | – | own times only (no permission needed) |
| `attendance.manage` (record and correct times) | all sites | their sites | – | – |
| `attendance.approve` (approve and reopen timesheets) | all sites | their sites | – | – |
| `attendance.export` (M11.3) | all sites | – | – | – |

## Decisions needed (with recommendations)

| # | Question | Options | **Recommendation** |
|---|---|---|---|
| **D1** | How do workers clock in? | (a) their own phone, signed in; (b) a shared tablet at the site with a PIN; (c) both | **(a) Their own phone** for Release 1. A shared tablet needs PIN management and device security; we can add it later. Staff without a login have times recorded by their manager. |
| **D2** | Do we check *where* someone clocked in? | (a) no location check; manager review is the control; (b) phone GPS must be near the site; (c) scan a code displayed at the site | **(a) No location check in Release 1.** GPS location is personal data that needs a data-protection assessment and an employee notice, and it fails indoors. A printed code can be photographed and shared, so it adds little. Flags plus manager approval cover the main risk. Revisit with the adviser. |
| **D3** | Clocking in with **no published shift** today | (a) block; (b) allow, flagged for review | **(b) Allow, flagged.** Cover shifts and late changes are normal in hospitality; blocking would push people to paper. |
| **D4** | Rounding clock times (for example to the nearest 15 minutes) | (a) never round, store the real time; (b) round by a site rule | **(a) Never round.** Rounding changes paid time, which is a payroll rule that needs specialist validation. Payroll can apply rules later to the real times. |
| **D5** | Early and late tolerance for flags | (a) fixed 10 minutes; (b) set per organisation | **(b) Per organisation, default 10 minutes.** It only decides what gets flagged; it never changes a time. |
| **D6** | Breaks | (a) workers clock break start and end; (b) assume the shift's planned break | **(a) Workers clock breaks**, optional. If none is recorded on a shift that planned one, the timesheet flags it and shows the planned break; the manager decides. We never deduct a break automatically. |
| **D7** | Someone forgets to clock out | (a) clock them out automatically at shift end; (b) leave it open and flag it | **(b) Leave it open and flag it** a set time after the shift ends (default 2 hours); the manager enters the real time with a reason. An automatic time would be made up. |
| **D8** | Who approves timesheets | (a) site managers for their sites; (b) owners, admins and HR only | **(a) Site managers for their own sites**, with a separate `attendance.approve` permission so it can be restricted per role later (as with `rota.publish`). |
| **D9** | Changing an approved week | (a) never; (b) reopen with a reason, audited | **(b) Reopen with a reason.** Mistakes happen; the history keeps every version. |
| **D10** | Offline clocking (A-6) | (a) online only in M11, offline with the installable app later; (b) build offline now | **(a) Online only for now.** Offline queuing needs the installable app (service worker), which is part of worker self-service. Until then, the manager records the time if a phone has no signal. |
| **D11** | Export for payroll (M11.3) | (a) CSV of approved hours, no money; (b) no export in Release 1 | **(a) CSV of approved hours.** Most customers will keep their current payroll for now, and re-typing hours is where errors creep in. Owners, admins and HR only. |

## 5. Not in M11

- Holiday requests, leave balances and absence records: Release 2.
- Pay rates, overtime, cost and pay calculations: later, after specialist validation.
- Location tracking, photos or biometrics at clock-in.
- Under-18 working-time rules (same position as M10 D9).

## 6. What's left for Release 1 after M11

1. **Worker self-service:** the installable app (PWA), push notifications and the offline clock queue.
2. **Email (M9.4):** needs your choice of provider and sending domain (cost and data location).
3. **Release 1 validation:** end-to-end, isolation, authorisation, document security, load, mobile and accessibility testing, backup restore, operational readiness and an independent penetration test.

## 7. Approval gates

1. **This scope:** answer D1 to D11, or reply "approved" to accept every recommendation.
2. **M11.1:** a design doc, local build and tests, then a Neon approval request with the SHA-256, as before.
3. **Merging and deploying:** a separate approval each time.
