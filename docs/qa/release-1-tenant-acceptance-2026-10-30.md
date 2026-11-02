# Release 1 tenant acceptance test

**Run:** 30 October to 1 November 2026, by Claude (QA), against https://team-happi.vercel.app (production, main at `f65f938`), plus the local automated suites.

**Tenant used:** **Joemis Kitchen**, by the product owner's decision. The brief proposed a separate "The Olive Table — QA Test" organisation, but TeamHappi has no screen for creating organisations (see I-2), and the product owner chose to test in Joemis Kitchen instead. Every record created is labelled "(QA test)". Nothing already in Joemis Kitchen was edited or removed.

**Signed in as:** the product owner's own session (the owner of Joemis Kitchen), through the Claude in Chrome extension. No other accounts were available.

## Executive summary

| | |
|---|---|
| **Overall result** | **PASS WITH ISSUES** |
| **Checks** | 12 areas, 66 checks: **57 passed, 0 failed, 3 blocked, 4 not run**, 1 recorded as a manual step (T7.9, issue I-1) and 1 not applicable (T12.5). Details below. |
| **Critical blockers** | None found in the code tested. |
| **Before real customers** | Adviser review of the privacy notice and right-to-work wording (I-9); a way to create organisations without a database script (I-2). |
| **Proceed with Rota?** | **Yes.** Fix I-1 first (small, no database change), and have the product owner finish T9 (new-hire login) so My onboarding and My training are proven live. |

**What was proven live:**
- **Recruitment:** a candidate applied through the public link with a CV. The CV was stored in **Amazon S3** (confirmed in the database: provider `aws-s3`, key inside Joemis Kitchen's prefix). The manager downloaded it, and it matched the uploaded file **byte for byte**. Upload and download were both audited, with no personal details in the audit.
- **Hiring:** it created exactly **one** employee, linked to the application, with the CV visible on their People record, and started the chosen onboarding template.
- **Onboarding:** task completion and exceptions are recorded with who and when. Sign-off is refused while required tasks are open. Right-to-work stays separate, and the person isn't "cleared" without it.
- **Training:**
  - rules applied automatically, with no duplicates when rules overlap;
  - a manager-recorded external certificate calculated its own expiry (36 months);
  - the matrix updated.
- **Access:** signed out, CVs, QR codes and protected pages are refused. Unknown records show "Page not found", the same as another organisation's records would.

**What still needs the product owner:**
- **T9:** creating Emily's login from the invite link. My safety rules don't allow me to create accounts or type passwords on a live site.
- **T10, employee part:** depends on T9.

## Detailed results

Result key: PASS, FAIL, BLOCKED or NOT RUN. Evidence marked "live" was observed on production in the product owner's browser session; "DB (read-only)" means a read-only query on Neon; "local" means the automated suites.

### T1 Organisation setup

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T1.1 | Check whether the account can create a tenant | BLOCKED | Code: no create screen in `src/app/platform/(console)/organisations/`; the only path is `scripts/create-organisation.mjs` (direct database write) | A tenant can be created through the UI | No UI exists. The brief forbids direct database creation; the PO chose Joemis Kitchen instead. | I-2 | Medium |
| T1.2 | Time zone | PASS | Live: Settings shows Europe/London | Set and kept | Already Europe/London; left unchanged | | |
| T1.3 | Create site | PASS | Live: "City Centre (QA test)", code QA1, Manchester; stays after reload | Saves and reloads | As expected | | |
| T1.4 | Create teams | PASS | Live: Teams list after reload shows both at City Centre (QA test) | Both persist | As expected | | |
| T1.5 | Organisation switcher | NOT RUN | Live: the account belongs to one organisation only | Switcher lists organisations | Only Joemis Kitchen exists for this account. Covered locally: `workspaces.spec.ts` passed. | | |
| T1.6 | No other organisation's data appears | PASS | Live: lists show only Joemis Kitchen records | Tenant-scoped | As expected | | |

### T2 People

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T2.1 | Add Sarah Mitchell | PASS | Live: E0002, Restaurant Manager, City Centre (QA test), Front of House (QA test) | Created with assignments | As expected | | |
| T2.2 | Add Daniel Brooks | PASS | Live: E0003, Chef, City Centre (QA test), Kitchen (QA test) | Created with assignments | As expected | | |
| T2.3 | Edit a non-sensitive field | PASS | Live: preferred name "Sarah M" saved; profile shows "Sarah M Mitchell (QA test)" | Persists | As expected | | |
| T2.4 | Search and filter | PASS | Live: search "brooks" shows 1 of 3; site filter City Centre shows 2 of 3 | Filters work | As expected | | |
| T2.5 | No duplicates | PASS | Live: People list has one row per person | | As expected | | |

### T3 Onboarding setup

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T3.1 | Add suggested templates | PASS | Live: "Added 3 suggested templates" (Bar 11 tasks, Front of house 10, Kitchen 11) | Created | As expected | | |
| T3.2 | Repeat-safe | PASS | Code: `addSuggestedTemplates` skips names that already exist (`src/modules/onboarding/service.ts:428`) | No duplicates on a second click | Not clicked twice live, to avoid clutter | | |
| T3.3 | Tasks show owner, timing and required/optional, and can be edited | PASS | Live: Bar team template shows each task with Edit and Remove | Editable by an owner | As expected | | |
| T3.4 | No onboarding for Emily before hire | PASS | Live: Emily didn't exist in People until the hire | | As expected | | |

### T4 Training setup

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T4.1 | Suggested courses | PASS | Live: 9 suggested courses already present (added earlier by the PO); not duplicated | Catalogue exists | As expected | | |
| T4.2 | Food safety required for Chef | PASS | Live: rule "Job title: Chef · Mandatory · due within 30 days" | Saved | Saved, but the rule list only appeared after a reload | I-3 | Low |
| T4.3 | Fire safety required for everyone | PASS | Live: "Rule added" | Saved | As expected | | |
| T4.4 | Daniel's requirements | PASS | Live: Daniel shows Fire safety and Food safety, both due 1 Dec 2026 | Both apply | As expected. His card also shows "Up to date" beside "2 need attention". | I-4 | Low |
| T4.5 | Matrix reflects the rules; overlapping rules don't duplicate | PASS | Live: matrix shows one cell per person and course; Sarah gets Fire safety only | One obligation per course | As expected | | |
| T4.6 | Training is separate from login roles | PASS | Live: requirements follow job title and site; Daniel and Sarah have no login | | As expected | | |

Extra setup for T10: "Age verification and Challenge 25" (read-and-confirm) was made required for Bartenders.

**Side effect for the PO:** the "everyone" Fire safety rule also applies to your real employee John Doe. Remove that rule after testing if you don't want it.

### T5 Vacancy, share link, QR code and poster

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T5.1 | Create, save, reopen | PASS | Live: "Bartender (QA test)", City Centre (QA test), Front of House (QA test), Full time, fictional description | Persists | As expected | | |
| T5.2 | Publish (Open) | PASS | Live: status Open after reload | Open | As expected | | |
| T5.3 | Share link | PASS | Live: `/jobs/<12-character code>` created | Created | As expected | | |
| T5.4 | Public page, signed out | PASS | Live (curl, no cookies): shows organisation, title, site, type and description; no hiring manager, team, IDs or cookies; `noindex` | Only published fields | As expected | | |
| T5.5 | QR code downloads | PASS | Live: PNG 200 `image/png`, `private, no-store`; SVG 200 | Downloadable by managers only | As expected. Signed out, the QR route returns 404. The decoded destination was not machine-checked; the encoding code is `vacancyShareUrl(code, true)`, and the PO's own phone scans of another vacancy were counted (12). | | |
| T5.6 | Poster | PASS | Live: poster 200 with the title and share link | Prints | As expected | | |

### T6 Public application and S3 CV

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T6.1 | Apply as Emily Carter (QA test) with a synthetic PDF ("TEAMHAPPI QA TEST - NOT A REAL CV", 608 bytes) | PASS | Live: "Thank you. Joemis Kitchen has your application."; no CV warning | Success without email | As expected | | |
| T6.2 | Appears in the right vacancy | PASS | Live: vacancy lists Emily; application at Applied, source "Careers page", history "Applied (System)" | | As expected | | |
| T6.3 | CV stored in S3 | PASS | DB (read-only): `provider_id = aws-s3`, status stored, key inside the tenant prefix, uploaded by the candidate | Private S3 storage | As expected | | |
| T6.4 | Download matches upload | PASS | Live: 200 `application/pdf`, `attachment`, `private, no-store`, `nosniff`, sandbox CSP, same origin; **SHA-256 identical** to the uploaded bytes | Same file | As expected | | |
| T6.5 | Download audited | PASS | DB (read-only): `online_application`, `cv_uploaded`, `cv_downloaded`; no names, emails or file names in any audit detail | Audited | As expected | | |
| T6.6 | No public CV URL | PASS | Live: the download is a TeamHappi route; signed out it returns 404 | | As expected | | |

Email used: `emily.carter.qa@example.com`. `example.com` is reserved and can never reach a real inbox, and nothing was sent.

### T7 Pipeline and hiring

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T7.1 | Stages | PASS | Live: Applied, then Screening, Interview, Offer | Update correctly | As expected | | |
| T7.2 | Screening note | PASS | Live: note shown | Persists | As expected | | |
| T7.3 | Interview | PASS | Live: 3 Nov 2026 10:30, 30 min, in person, with the owner | Persists | As expected | | |
| T7.4 | Interview outcome | PASS | Live: "Completed · Outcome: Progress", with feedback | Recorded | As expected. It was allowed **before** the interview date. | I-5 | Low |
| T7.5 | Hire with onboarding (Bar team template, start 10 Nov 2026) | PASS | Live: People record E0004, Bartender, City Centre (QA test), Front of House (QA test), "Starting soon" | One employee | Exactly one (People list has 1 row) | | |
| T7.6 | Linked to the application; CV on the People record | PASS | Live: "Hired from Bartender (QA test)", Open their application, Download CV | | As expected | | |
| T7.7 | Onboarding linked | PASS | Live: case "Bar team (suggested) v1 · starts 10 Nov 2026" for Emily | | As expected | | |
| T7.8 | Persists; duplicate hire prevented | PASS | Live: application shows Hired; the Hire action is gone | | As expected. A double hire is also covered by a local race test. | | |
| T7.9 | Vacancy status after hire | **Manual** | Live: "1 of 1 hired" but still **Open**, and the public form still accepts applications | | Requires a manual change to Filled | I-1 | Medium |

### T8 New-hire onboarding

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T8.1 | Template | PASS | Live: 11 tasks, 8 required | | As expected | | |
| T8.2 | Complete a manager task | PASS | Live: "Emergency contact recorded: Done by Jojo, 1 Nov 2026" | | As expected | | |
| T8.3 | Exception on an optional task | PASS | Live: "Uniform and equipment issued: Exception by Jojo, Reason: QA test …" | Recorded with reason | As expected | | |
| T8.4 | Progress | PASS | Live: 2 of 11 finished | | As expected | | |
| T8.5 | Sign-off blocked while required tasks are open | PASS | Live: button disabled. Code: `maySignOff` refuses with "n required tasks are still open". | Refused | As expected | | |
| T8.6 | Right-to-work separate; no clearance without a check | PASS | Live: "Not cleared: Required tasks are still open · No recorded right-to-work check covers the start date"; RTW page says TeamHappi records the check and doesn't decide; restricted and every view recorded | | As expected | | |
| T8.7 | Record a fictional RTW check | NOT RUN | | | **Deliberately not run.** RTW records can't be edited or deleted, so a fictional check would stay permanently in a real organisation's compliance history. Covered locally by `onboarding-compliance.spec.ts` (passed on rerun). | | |

### T9 Employee invitation and login

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T9.1 | Invite page | PASS | Live: email pre-filled from the record; role defaults to **Worker**, site defaults to her site | Safe defaults | As expected | | |
| T9.2 | Generate link, accept, sign in, open My onboarding and My training | **BLOCKED** | | Works without email | Not executed. Claude's safety rules don't allow creating accounts or entering passwords on a production site. | | |
| T9.3 | Does activation need email? | PASS (code) | `src/lib/auth/invitation-account.ts`: opening the one-time link counts as confirming the address (`emailVerifiedVia: "invitation"`), the PO's interim decision | | **No email is needed.** Locally, `invitations.spec.ts` passed on rerun. | | |

**Shortest PO action:**
1. On Emily's People record, open **Invite to TeamHappi** and click **Create invite link**. The link is shown once.
2. Open it in a private window and create her login.
3. Check **My onboarding** (her own tasks only, e.g. "Read the staff handbook") and **My training** (Challenge 25 and Fire safety).

### T10 Training completion

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T10.1 | Manager records Daniel's external Food safety course (completed 15 Oct 2026, fictional provider, reference QA-TEST-0001) | PASS | Live: "Training recorded."; Up to date, **expires 15 Oct 2029** (36 months, calculated); method "External certificate"; recorded by and when; Correct and Void available | | As expected | | |
| T10.2 | Matrix updates | PASS | Live: Daniel's Food safety shows "Up to date · Expires 15 Oct 2029"; Emily's due dates come from her start date (24 Nov, 10 Dec) | | As expected | | |
| T10.3 | Employee read-and-confirm (Emily) | BLOCKED | | | Depends on T9. Note that the course text is still a placeholder outline (see I-10). | | |
| T10.4 | Employees can't self-verify external certificates | PASS (local/code) | M8.2 design and `tests/security/my-training.test.ts` (in the 528 passing tests) | | Not demonstrated live (needs T9) | | |

### T11 Tenant isolation and security

| ID | Scenario | Result | Evidence | Expected | Actual | Issue | Severity |
|---|---|---|---|---|---|---|---|
| T11.1 | Signed-out access | PASS | Live: the CV route and QR route return 404; `/people` and `/platform/*` redirect to sign-in | Denied | As expected. The status is 200 with a streamed redirect, and nothing is leaked. | I-6 | Low |
| T11.2 | Unknown or foreign record IDs | PASS | Live: People, application, vacancy, onboarding, right-to-work and training pages show "Page not found"; the CV route returns 404 | Same answer as another tenant's ID | As expected | | |
| T11.3 | Cross-tenant requests with a second organisation | NOT RUN (live) | | | The live account has one organisation. Covered locally: `tenant-isolation`, `cv-documents`, `public-applications`, `recruitment` and the other security tests (528 passed). | | |
| T11.4 | Worker and site-scoped access | NOT RUN (live) | | | Needs a second live account (T9). Covered locally: `organisation-setup.spec.ts` ("site-scoped manager and worker are limited on the server") passed on rerun. | | |
| T11.5 | Security headers | PASS | Live: HSTS, nosniff, Referrer-Policy, CSP frame-ancestors none | | As expected | | |

### T12 General quality

| ID | Scenario | Result | Evidence | Actual | Issue | Severity |
|---|---|---|---|---|---|---|
| T12.1 | Console errors | PASS | Live: none recorded during the session | | | |
| T12.2 | Confirmations | PASS | Live: "Rule added", "Training recorded.", "Added 3 suggested templates", the application thank-you | | | |
| T12.3 | Persistence after refresh | PASS | Live: sites, teams, people, rules, vacancy status, stages and onboarding all reload correctly | | | |
| T12.4 | Mobile and accessibility | PASS (local) | Every browser test runs on desktop and mobile with axe checks | Not re-checked live at phone width | | |
| T12.5 | Browser automation stability | n/a | The Chrome extension's tabs froze several times and had to be reopened | A tooling issue, not the app | | |

### Automated tests (local, synthetic data)

- **`npm run check`** (lint, types, formatting, 45 test files with **528 tests**, build): **passed**.
- **Playwright (80 tests, desktop and mobile):**
  - first run: 61 passed, 8 flaky (passed on retry), 5 failed, 6 did not run;
  - every failure was the sign-in rate limit ("Too many attempts"), except one Platform Admin navigation interruption that passed on rerun;
  - reruns: every test passed at least once;
  - the final pass of `workspaces.spec.ts` on mobile hit the rate limit again, after passing minutes earlier.

  See I-7.

## Answers to the specific questions

1. **Can a new tenant configure its organisation?** Yes, once it exists: sites, teams, people, templates and training all work. **Creating** the tenant has no UI (I-2).
2. **Can a manager recruit without email?** Yes, end to end. Candidates aren't emailed, so the manager contacts them directly (M9.4).
3. **Does S3 CV upload and download work?** **Yes, verified:** stored with provider `aws-s3` in the tenant prefix, downloaded byte-identical, audited, and not reachable signed out.
4. **Does hiring create one employee and one onboarding case?** Yes: one employee and one case from the chosen template.
5. **Can a new hire activate an account without email?** By design yes: the invite link confirms the address. **Not executed live** (T9, PO action).
6. **Can the new hire complete onboarding tasks?** Manager tasks work live. The new hire's own tasks are pending T9; they pass locally.
7. **Can employees complete internal training?** Pending T9 live; passes locally. **The course content is placeholder text** (I-10).
8. **Are right-to-work controls correct?** Yes: separate from onboarding and sign-off, no clearance without a covering check, restricted and audited. The wording is still awaiting adviser review.
9. **Is tenant isolation maintained?** Yes, as far as one live account can show; fully covered by the local security tests.
10. **What must be fixed before real customers?**
    - adviser review of the privacy notice and right-to-work wording (I-9);
    - a way to create organisations without a database script (I-2);
    - I-1;
    - real training content, or partner links (I-10);
    - email (M9.4), so new hires aren't sent links by hand.

## Issues

| ID | Summary | Severity | Component | Steps to reproduce | Expected | Actual | Suggested fix | Migration? |
|---|---|---|---|---|---|---|---|---|
| I-1 | A vacancy stays Open after all openings are hired, so its public form keeps taking applications | Medium | `src/modules/recruitment/service.ts` (`hire`), vacancy page | Hire the last opening | Prompted or automatic move to Filled | "1 of 1 hired" but Open; QR form live | After a hire fills the last opening, set the vacancy to Filled (or show a clear "Mark as filled" prompt) | No |
| I-2 | No UI to create an organisation | Medium (blocks onboarding customers) | Platform Admin, `src/platform/tenancy/create-tenant.ts` | Platform Admin, then Organisations | A "Create organisation" action | Only `scripts/create-organisation.mjs` | Platform Admin create form (the planned M3.5) with a session-backed `PlatformStaffActor` | No (function exists) |
| I-3 | A training rule isn't listed until the page is reloaded | Low | Training course page rule form | Add a rule | It appears straight away | "Rule added" but "Nobody is required" until reload | Refresh the route after a successful rule action | No |
| I-4 | Person training card shows "Up to date" next to "2 need attention" | Low | People record training card | Open Daniel before recording training | A consistent status | Contradictory labels | Base the badge on overdue or due items, or rename it | No |
| I-5 | An interview outcome can be recorded before the interview time | Low | `updateInterview` | Record an outcome on a future interview | A warning or refusal | Saved as Completed | Warn, or refuse until the start time | No |
| I-6 | "Page not found" and signed-out redirects return HTTP 200 | Low | Streaming pages | Request an unknown ID | 404 / 307 | 200 with a streamed redirect or not-found; no data exposed | Resolve `notFound`/redirect before streaming where possible | No |
| I-7 | The browser test suite trips the sign-in rate limit | Low (test only) | `tests/e2e/*` | Run the full suite | Stable | About 10 tests need reruns | Reuse saved sessions in every spec | No |
| I-8 | Job-title rules match exact titles only ("Chef" ≠ "Senior Chef") | Info | Training rules | | | By design; the UI says so | Consider "contains" matching or a job-title list later | No |
| I-9 | Privacy notice and right-to-work wording not adviser-reviewed | Medium (compliance) | Public form; RTW pages | | Reviewed | Pending | Adviser review | No |
| I-10 | Read-and-confirm course content is a placeholder | Medium (product) | Suggested courses | Open Challenge 25 | Real content | "Suggested outline: replace it…" | The business writes its content; adviser-checked drafts, or partner links (M8.3) | No |

## Synthetic records created (all in Joemis Kitchen, kept for Rota and Attendance testing)

- **Site:** City Centre (QA test), code QA1, Manchester, Europe/London.
- **Teams:** Kitchen (QA test), Front of House (QA test).
- **People:**
  - Sarah M Mitchell (QA test), E0002, Restaurant Manager, Active;
  - Daniel Brooks (QA test), E0003, Chef, Active;
  - Emily Carter (QA test), E0004, Bartender, Starting soon (hired).
- **Onboarding:**
  - the 3 suggested templates (Bar, Front of house, Kitchen);
  - Emily's onboarding (Bar team): 1 task done, 1 exception.
- **Training rules:**
  - Food safety, for Chef;
  - Fire safety, for **everyone** (also applies to John Doe);
  - Challenge 25, for Bartender.
- **Training record:** Daniel's Food safety (external, 15 Oct 2026, fictional provider).
- **Recruitment:**
  - vacancy "Bartender (QA test)", **still Open with an active share link** (I-1; set it to Filled or remove the link when the test is complete);
  - Emily's candidate record and application (Hired);
  - 1 note and 1 interview;
  - 1 synthetic CV (608 bytes) in S3.
- **Not created:** a login for Emily (T9), a right-to-work record (T8.7), a second organisation (T1.1).

## Follow-up fixes (2 November 2026, branch `fix/vacancy-filled-on-last-hire`, not yet merged)

- **I-1 fixed.** When a hire fills a vacancy's last opening, the vacancy moves to **Filled** in the same transaction. That's audited as `recruitment.vacancy_status_changed` with `automatic: true`, and its share link stops taking applications. A vacancy with openings left stays Open. The hire message says so. Test: `tests/security/recruitment.test.ts`. No migration.
- **I-11 (High, test tooling) found and fixed.** Database test failures didn't fail the test command. `embedded-postgres` registers `async-exit-hook`, which calls `process.exit(0)` on `beforeExit`, turning vitest's exit code 1 into 0.
  - **Who it affected:** it was loaded in every run, **including CI**, so `npm run check` and the CI test step could report success while a database or security test was failing.
  - **The fix:** `tests/setup/db-global-setup.ts` now loads `embedded-postgres` only when it starts a local server, and removes that hook (our teardown stops the server). Checked: a failing database test now exits 1.
  - **The PO's reports so far quoted the actual pass counts from the output, not just the exit status.**
- **I-12 (Low) fixed.** `tests/security/training.test.ts` hard-coded a due date that was only right on 1 November. It now computes it from today.
- **After the fixes:** `npm run check` passes (529 tests, build). The recruitment and public-application browser tests pass. The only failures were the sign-in rate limit, and those passed on rerun.

**Still open:** I-2 to I-10 above, and T9 (new-hire login), which needs the product owner.
