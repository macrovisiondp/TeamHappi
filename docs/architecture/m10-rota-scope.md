# M10: Rota and scheduling (scope)

**Status:** proposed on 2 November 2026, for the product owner's decision. No code, migration or deployment until it's approved.

**Requirement:** TH-DEV-02 Capability 4 (Release 1, approved):
- creating, publishing and changing rotas and shifts across sites and teams;
- a worker schedule view;
- availability, change requests and shift swaps where enabled;
- notifications of published and changed shifts.

**Builds on:**
- **People (M4):** sites, teams and job titles. Employees don't need a login (A-2).
- **Onboarding (M7.2):** `onboarding.isClearedToWork(employeeId, date)`, which answers only "does a recorded right-to-work check cover this date?". It never reveals the record, so site managers can use it without right-to-work access.
- **Training (M8):** requirements and expiry per person.
- **Logins (M7.3):** worker logins and the phone-first "My …" pages.

**Leads to:** M11 basic Attendance, which compares clocked time with the **published** rota (TH-DEV-02 rev 0.2).

## 1. Principles

- **No pay or labour cost in the rota.** Hours only. Costs need pay rates, and pay calculations wait for specialist validation (project rule).
- **The rota records the manager's plan; it doesn't make legal decisions.** Working-time checks are warnings to help a manager, not legal advice. The wording will be adviser-reviewed, as for right-to-work.
- **Phones first for workers, phones and computers for managers.** People without a login still appear on the rota and on a printable copy.
- **Same foundations as before:**
  - tenant isolation (RLS, composite keys);
  - site-scoped permissions checked on the server;
  - an audit trail with ids only;
  - no deleting history.

## 2. Recommended increments

| Increment | What it delivers | Gate |
|---|---|---|
| **M10.1 Rota foundation** (managers) | **The week grid:** one rota week per site; shifts with date, start and end (crossing midnight allowed), unpaid break, team, role label and note; assigned to a person or left **open**. **Planning tools:** copy the previous week; draft, then **publish**; changes after publishing are kept as history; hours per person per week. **Checks when assigning** (see D3 to D5). **Access and records:** permissions, audit, a printable week. | Approval of this scope, then Neon approval |
| **M10.2 My shifts** (workers) | Published shifts only, on the phone: this week and next; a "changed since you last looked" highlight; open shifts at their site they can **ask** to take (the manager approves). An in-app badge for new or changed shifts. | Neon approval |
| **M10.3 Availability, requests and swaps** | Workers set when they can't work (recurring or dates). Managers see it when assigning, as a warning. Workers request a swap or drop; the manager approves. All audited. | Neon approval |
| **Later** | Email or push notifications, once email (M9.4) or the installable app (Capability 6 self-service) exists. Labour cost, after payroll rules are validated. Auto-scheduling: not planned. | |

## 3. M10.1 data model (proposed, tenant-owned, RLS)

| Table | Holds |
|---|---|
| `rota_week` | site, week start (Monday, in the site's time zone), status (`draft`/`published`), published at and by |
| `shift` | rota week, site, team?, role label (free text, e.g. "Bar"), starts at, ends at (timestamptz, so clocks going forward or back are handled), unpaid break minutes, note, status (`active`/`cancelled`), created and updated by |
| `shift_assignment` | shift to employee (one person per shift; open = no row), assigned by and at, override reason (if a warning was overridden) |
| `shift_change` | append-only history of changes after publishing (what changed, by whom, when), for M10.2 highlights and M11 |

There are no pay columns. "Hours" means shift length minus the unpaid break.

## 4. Permissions (new, mirrored in the catalogue and migration)

| Code | Owner, admin, HR | Site manager | Recruiter | Worker |
|---|---|---|---|---|
| `rota.view` | all sites | their sites | – | own shifts only (M10.2, no permission needed) |
| `rota.manage` (create, edit, assign, copy) | all sites | their sites | – | – |
| `rota.publish` | all sites | their sites | – | – |

## Decisions needed (with recommendations)

| # | Question | Options | **Recommendation** |
|---|---|---|---|
| **D1** | How is a rota organised? | (a) one week per site; (b) any date range | **(a) One week per site, Monday to Sunday.** It's simple to copy, publish and print, and it's what hospitality managers expect. |
| **D2** | What do workers see before publishing? | (a) nothing until published; (b) drafts too | **(a) Nothing until published.** Changes after publishing are highlighted to them (M10.2). |
| **D3** | Assigning someone with **no right-to-work check covering the shift date** | (a) block; (b) warn with a recorded reason; (c) ignore | **(a) Block.** Employing someone without a valid check is the employer's legal risk. The check is yes/no only (no RTW details shown). |
| **D4** | Assigning someone whose **onboarding tasks are incomplete** or whose **mandatory training is expired or overdue** | (a) block; (b) warn, and allow with a recorded reason; (c) ignore | **(b) Warn, and allow with a recorded reason** (audited). Real kitchens need flexibility. Expired training also flags future shifts (TH-DEV-04). |
| **D5** | Working-time checks | (a) none; (b) warnings | **(b) Warnings only:** overlapping shifts (**blocked**, since one person can't be in two places); under 11 hours' rest between shifts; a shift over 6 hours with under 20 minutes' break; over 48 hours in the rota week. **Not covered:** under-18 rules (we don't record dates of birth; see D9) and the 17-week average. Adviser to review the wording. |
| **D6** | Labour cost on the rota | (a) hours only; (b) estimated cost from pay rates | **(a) Hours only** until payroll rules are validated. |
| **D7** | Open shifts | (a) managers fill them; (b) workers can ask to take them (manager approves) | **(b) in M10.2.** Workers ask; the manager approves. |
| **D8** | Notifications | (a) in-app only for now; (b) wait for email | **(a) In-app** ("My shifts" badge and change highlights). Email or push follow M9.4 or the installable app. People without a login get the printed rota. |
| **D9** | Young workers (under 18) have stricter rules | (a) out of scope for M10; (b) add date of birth to People and check | **(a) Out of scope for now, but stated clearly in the app.** Adding dates of birth means storing more personal data; let's decide with the adviser. |
| **D10** | Who publishes | (a) anyone who can manage the rota at the site; (b) owners, admins and HR only | **(a) Site managers publish their own sites** (separate `rota.publish` permission, so it can be restricted per role later). |

## 5. Not in M10

- Clocking in and out, timesheets, and planned versus actual hours: these are **M11 Attendance**.
- Holidays and absence: Release 2.
- Pay or cost: payroll, later.
- Auto-scheduling and demand forecasting.

## 6. Approval gates

1. **This scope:** answer D1 to D10, or reply "approved" to accept every recommendation.
2. **M10.1:** a design doc, local build and tests, then a Neon approval request with the SHA-256, as before.
3. **Merging and deploying:** a separate approval each time.
