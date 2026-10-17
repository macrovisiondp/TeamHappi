# M7: Employee onboarding — scope proposal

**Status:** proposal for product-owner review. No code, migration or Neon change has been made.
**Builds on:** M4.2 (sites, teams, employee records), M6 (invitations, memberships, tenant audit trail).
**Requirement:** TH-DEV-02 Capability 2, "Onboarding and compliance": onboarding task lists and document collection; recording employer-led right-to-work checks, evidence, expiry dates and follow-up actions; compliance status visible to managers.

TeamHappi **records** the employer's right-to-work check. It never makes the legal decision, and it never tells a business someone may work when the employer hasn't done the check.

---

## 1. Principles

| Principle | What it means here |
|---|---|
| **People before logins** | Onboarding belongs to the **employee record**, not a login. A new kitchen porter can be fully onboarded by a manager without ever having a TeamHappi account. A login (membership) can be linked later, through an M6 invitation. |
| **Record, don't store (yet)** | No file uploads until secure document storage (ADR-0007) is approved. M7 records *that* a document was seen, by whom, when, and when it expires. The paperwork stays in the business's own file. |
| **Restricted data stays narrow** | Right-to-work details are "Restricted" (IS-03): narrowest permissions, every view audited, never in notifications, logs or job payloads. We don't store passport numbers, share codes or document images. |
| **Same tenant model** | Every new table is tenant-owned: `tenant_id`, RLS ENABLE + FORCE, `UNIQUE(tenant_id, id)`, composite foreign keys, created in the same migration. Site scope is checked on the server. |
| **Free tier only** | No paid identity checks (IDSP), e-signature or storage services. |

---

## 2. Lifecycle and dashboard

### Employee lifecycle (existing `employment_status`, unchanged)

`pending` (hired, not started) → `active` → `left`

### Onboarding case status (new, one active case per employee)

| Status | Meaning |
|---|---|
| `not_started` | Case created from a template; nothing done yet |
| `in_progress` | At least one task done |
| `blocked` | A required item was rejected or a right-to-work check couldn't be confirmed |
| `ready` | **Cleared to start**: every required task is done or waived, *and* a confirmed right-to-work check is recorded before the start date |
| `completed` | Onboarding signed off (normally after the first weeks) |
| `cancelled` | The person didn't start; the record is kept |

"Cleared to start" is computed on the server from the facts, never ticked by hand. Rota will later ask `onboarding.isClearedToWork(employeeId)` (module-boundaries.md).

### Onboarding dashboard (`/onboarding`, replacing the "Planned" placeholder)

- Counts: starting this week, not cleared, overdue tasks, right-to-work follow-ups due in the next 60 days.
- A list of people being onboarded, filterable by site and status, with a progress bar (`progress.tsx`), start date, owner and next due task.
- Site managers see only their site(s); HR, admins and owners see everyone.

---

## 3. Templates (organisation, site or job role)

- **Template:** a named checklist, for example "Kitchen team", "Front of house", "Bar (licensed)" or "Site manager".
  - **Applies to:** the whole organisation, one site, or a job title (matched to the employee's job title, with a manual choice always possible).
- **Template task:**
  - **Detail:** title, guidance text and category (*task*, *document*, *right to work*, *induction*, *policy acknowledgement*).
  - **Who does it:** the manager, HR or the employee.
  - **When it's due:** relative to the start date, for example "3 days before start" or "day 1".
  - **Required or optional.**
- **Versioning:** templates are versioned. Starting a case **copies** the tasks into it, so editing a template never changes onboarding already under way.
- **Starter templates:** an owner can add a set of suggested UK hospitality templates with one click and then edit them. Suggested items:
  - written statement of employment particulars (a day-one legal right);
  - contract signed; handbook received;
  - emergency contact recorded; uniform issued;
  - fire safety and health-and-safety induction; allergen awareness;
  - Level 2 Food Hygiene (kitchen); personal licence where relevant (bar).
- **Wording:** all template wording is editable and clearly labelled "suggested". It is not legal advice.

## 4. Tasks, owners, due dates and completion

- **Each task has:** an assignee (a named member, or "the employee"), a due date, and a status: `to_do`, `done`, `waived` (with a reason; required items can only be waived by HR or an admin) or `not_applicable`.
- **Completion records:** who, when, and whether it was done **on the employee's behalf** (for people without a login).
- **Overdue** is computed from the due date; there's no background job.
- **Audit:** every completion, waiver and reassignment writes an audit event (reusing M6's append-only `audit_event`).

## 5. Required-document checklist (metadata only)

- **What's recorded for each document:** what kind it is (for example a contract, food hygiene certificate or personal licence), and its status:
  - `requested`, `seen`, `verified`, `rejected` (with a reason), `expired` or `waived`;
  - plus the expiry date (when there is one), who verified it and when.
- **No file is attached in M7.**
  - A nullable link to the existing `document` table is reserved for when storage is approved.
  - Until then, the record says "kept in your own file".
- **Expiring documents** appear on the dashboard.

## 6. Right-to-work workflow

The UK rules below are a summary for design. **They need review by a qualified adviser before the wording ships** (gate G4).

- **When:** the employer must check before employment starts. The record captures the date of the check, and the start date can't pass "cleared" without one.
- **How the check was done** (method):
  1. **Manual document check:** original documents from the Home Office lists, checked in the person's presence, with copies kept by the employer.
     - **List A** gives a continuous excuse: no follow-up check needed.
     - **List B** is time-limited: a follow-up check is needed before permission ends.
  2. **Home Office online check:** using a share code, for eVisa holders. The employer keeps the online profile result in their own records.
  3. **Identity Service Provider (IDSP) check:** for British and Irish passports. This is recorded only; TeamHappi doesn't integrate a paid provider.
- **What's recorded:**
  - the method and the list (A, B group 1 or B group 2);
  - the date checked and who checked it;
  - confirmation that the person was present, or that the check was online;
  - the outcome (`confirmed`, `time_limited` or `not_confirmed`);
  - when permission ends, and the follow-up check date;
  - where the evidence is kept (in M7 always "employer's own file"; later, a stored document).
- **Not stored:** passport or document numbers, share codes, nationality and images.
  - This keeps the most sensitive data out of TeamHappi until storage and a privacy review are approved.
- **Corrections:** records are append-only. A correction is a new check that supersedes the old one, so the history can't be rewritten.
- **Follow-ups:** time-limited checks generate a follow-up task, and appear on the dashboard 60 and 28 days before they're due.
- **Audit:** recording, superseding and **viewing** a right-to-work record are all audited.
- **Retention:** nothing is deleted automatically. The proposed review period is employment plus 2 years (IS-07), pending adviser confirmation.

## 7. Training and induction

- **In M7:** induction items are onboarding tasks ("Fire safety walk-round", "Allergen briefing") with completion dates.
- **Later (separate Training milestone):** proper training assignments, certificates and renewals. When a case becomes `ready`, onboarding will hand over to Training as `onboarding.cleared` (module-boundaries.md).

## 8. Manager and employee experiences

- **Managers and HR** (desktop and tablet):
  - start onboarding from the employee page;
  - work through the checklist and record the right-to-work check in a guided form;
  - see the dashboard.
- **Employees** (phone first, M7.3):
  - after accepting an invitation linked to their employee record, see "My onboarding": tasks assigned to them, policies to acknowledge and what's still needed;
  - never see right-to-work details or anyone else's records.
- **People without a login:** everything is done by the manager "on their behalf". Nothing requires the employee to have an account.
- **Design:** the Warm Hospitality design system throughout (existing cards, badges, tables, progress, dialogs), WCAG 2.2 AA, axe-tested on desktop and mobile.

## 9. Notifications and reminders

- **Now (no email):** in-app lists, including "Due this week", "Overdue", "Right-to-work follow-ups" and "Starting soon", plus a count badge in navigation.
- **After email is approved (gate G6):** daily reminder emails to task owners, and expiry warnings to HR, using the existing `Mailer` interface.
  - **Scheduling:** Vercel Hobby allows one scheduled job a day, which is enough for a daily digest.
  - **Content:** reminders name tasks only, never right-to-work or document details (IS-03).

## 10. Permissions, site scope and tenant isolation

**New permission codes** (added to `src/lib/permissions/catalogue.ts` and the `permission` table):

| Code | Meaning | Owner / admin | HR manager | Site manager | Recruiter | Worker |
|---|---|---|---|---|---|---|
| `onboarding.view` | See onboarding cases and dashboard | ✔ | ✔ | ✔ (their sites) | – | own only (by ownership) |
| `onboarding.manage` | Start cases, complete and reassign tasks | ✔ | ✔ | ✔ (their sites) | – | own tasks only |
| `onboarding.template.manage` | Create and edit templates | ✔ | ✔ | – | – | – |
| `rtw.view` | See right-to-work records (audited) | ✔ | ✔ | – (sees "cleared: yes/no" only) | – | – |
| `rtw.record` | Record a right-to-work check | ✔ | ✔ | see decision D1 | – | – |

- **Site scope:** a case's site is the employee's primary site. A site manager is checked against it with the existing `can(grants, code, siteId)`.
- **Ownership:** a worker's own tasks are reached through their linked employee record, never through a role.
- **Isolation:** cross-tenant ids return 404, the database's tenant policies enforce isolation, and composite foreign keys stop one organisation's records linking to another's.
- **Existing organisations** (including Joemis Kitchen) get the new permissions on their built-in roles through the migration. That migration adds role permission rows for existing tenants, and it needs approval (G2).

## 11. Database changes (proposed)

All tenant-owned, RLS ENABLE + FORCE, `UNIQUE(tenant_id, id)`, composite FKs, no app-role DELETE (records are archived, cancelled or superseded).

| Table | Key columns |
|---|---|
| `onboarding_template` | name, description, scope (`organisation`/`site`/`job_title`), site_id?, job_title?, version, archived_at |
| `onboarding_template_task` | template_id, title, guidance, category, owner_kind (`manager`/`hr`/`employee`), due_offset_days, required, sort_order |
| `onboarding_case` | employee_id (one open case each: partial unique index), template_id + version, site_id, status, start_date, owner_membership_id, cleared_at, completed_at, cancelled_at |
| `onboarding_task` | case_id, copied title/guidance/category/required, assignee_membership_id?, assignee_is_employee, due_on, status, completed_by, completed_at, on_behalf, waived_reason |
| `onboarding_document_check` | case_id, kind, status, expires_on, verified_by, verified_at, rejected_reason, document_id? (reserved) |
| `rtw_check` | employee_id, method, list_type, checked_on, checked_by, in_person, outcome, permission_ends_on, follow_up_due_on, evidence_location, superseded_by?, note (restricted, length-limited) |

Plus:
- **Permission catalogue:** new rows, and role permission rows for each tenant's built-in roles.
- **Column grants:**
  - `rtw_check` is append-only for the app role (INSERT and SELECT, plus UPDATE of `superseded_by` only);
  - `onboarding_task` can update only its status and completion columns.
- **Helper:** an `employee.membership_id` link from an invitation (optional `employee_id` on `invitation`, set on acceptance).

**Migrations:** one per increment, additive, reviewed by hand, rehearsed locally on embedded Postgres, with a SHA-256 in the approval request. The product owner runs `prisma migrate deploy`, and I verify read-only before any merge (as in M5 and M6).

## 12. Security tests (per increment)

- **Tenant isolation:** another organisation's cases, tasks, templates and right-to-work records are invisible and unchangeable (404), including by guessed ids and cross-tenant foreign keys.
- **Site scope:** a site manager can't see or change cases at other sites, can't view right-to-work details, and sees only "cleared yes/no".
- **Permissions:** workers can see and complete only their own employee tasks; recruiters see nothing.
- **Right to work:**
  - append-only (no UPDATE or DELETE except supersede);
  - each view writes an audit event;
  - restricted fields never appear in audit detail, logs or notification text;
  - "cleared" is impossible without a confirmed check dated on or before the start date.
- **Templates:** editing a template doesn't change cases already started.
- **Waivers:** only HR or admins can waive required items; a reason is required.
- **Grants:** the app role's column grants match the review exactly (posture test).
- **Browser tests (e2e):**
  - a manager onboards a person with no login, end to end;
  - a worker completes their own tasks on mobile;
  - accessibility (axe) checks on every new screen.

---

## Recommended increments

| Increment | Delivers | Needs |
|---|---|---|
| **M7.1 Onboarding foundation** | Permissions; templates (with suggested hospitality starter set); start a case from an employee; tasks with owners, due dates, completion "on behalf"; dashboard; audit | G1 scope, G2 migration |
| **M7.2 Compliance** | Right-to-work recording and follow-ups; document checklist (metadata only); "cleared to start"; restricted-view audit | G3 migration, **G4 adviser review of the wording** |
| **M7.3 Employee experience** | Link an employee record to a login via invitation; "My onboarding" on mobile; policy acknowledgements | G5 migration (small) |
| **M7.4 Email reminders** (optional, later) | Daily reminder digest and expiry warnings by email | **G6 Resend and a TeamHappi domain** |
| **Deferred** | File uploads (needs ADR-0007 storage approval, G7); IDSP integration (paid); e-signature; payroll starter data (NI number, bank details, HMRC starter checklist), which waits for the Payroll release; the Training module proper | Separate approvals |

Each increment: its own branch, tests, Neon approval request, read-only verification, and merge only when you say so.

## Dependencies

- **Done:** M4.2 employees and sites; M6 memberships, invitations and tenant audit.
- **Needed for M7.3:** invitation-to-employee linking (small addition to M6's invitation table).
- **Needed for email reminders:** Resend and a domain (G6).
- **Needed for uploads:** ADR-0007 storage approval (G7) and a privacy review.
- **Recruitment** (later) will start onboarding automatically on hire. Until then, onboarding starts from an employee record.

## Approval gates

| Gate | What you approve | When |
|---|---|---|
| **G1** | This scope and decisions D1–D5 below | Now |
| **G2** | M7.1 migration on Neon (new tables, new permissions added to every organisation's built-in roles) | Before merging M7.1 |
| **G3** | M7.2 migration on Neon (right-to-work and document-check tables) | Before merging M7.2 |
| **G4** | Right-to-work wording and retention reviewed by a qualified adviser (or your explicit acceptance of the risk of shipping without it) | Before M7.2 goes live |
| **G5** | M7.3 migration on Neon | Before merging M7.3 |
| **G6** | Resend (free tier) and a TeamHappi domain (~£5–10/year) | Before any email reminders |
| **G7** | Secure document storage (ADR-0007) and privacy review | Before any file upload |

## Decisions needed (with recommendations)

| # | Question | Recommendation |
|---|---|---|
| D1 | May **site managers record** right-to-work checks? (In many hospitality businesses the site manager does the check.) | **Not by default.** Owners, admins and HR record checks; site managers see "cleared yes/no". Revisit when custom roles exist. |
| D2 | When Rota arrives, should uncleared people be **blocked** from shifts or just **warned**? | **Blocked**, with an owner-only override that's audited. (Decided later; noted now so the data supports it.) |
| D3 | Offer **suggested UK hospitality templates**? | **Yes**, added on request, fully editable, labelled "suggested". |
| D4 | Store share codes or document numbers? | **No.** Record method, list, dates and outcome only. |
| D5 | Should "completed" onboarding need a manager's **sign-off**, or happen automatically when every task is done? | **Manual sign-off** by the owner or HR (it marks the end of probation-style induction, not just the checklist). |
