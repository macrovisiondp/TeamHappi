# M16: before HotRock's opening

**Status:** approved by the product owner on 20 November 2026 ("approve as recommended"), after the review of HotRock's HR and payroll packs. Same day, the product owner decided:
- HotRock starts as a pilot on the current setup;
- NI and bank details stay switched off (`PERSONAL_DATA_KEY` unset), because HotRock's PO15 keeps them in Sage only;
- the generic allergen course isn't used (HotRock's T05 covers allergens);
- paid hosting plans are the product owner's decision as TeamHappi scales.

## What it adds

| | |
|---|---|
| **Job-title list** (HotRock request R1) | Settings › Job titles: each organisation can keep a list (owners and admins, `tenant.settings.manage`). Once the list has any titles, five places accept only a listed title, stored with the list's exact spelling: staff records, vacancies (copied at hire), training rules, onboarding templates and starter packs. Imported course rules with unlisted titles are skipped and reported. Organisations without a list type freely, as before. Titles are archived, never deleted. |
| **No approving your own hours** (HotRock PO15 s7.5) | A manager can't approve a timesheet week at a site where they have clocked time themselves. Someone else with approval rights, such as an owner, approves it. |
| **Shift cover warning** (HotRock request R3) | A course can be marked **Needed on every shift** (for example first aid, or a "Nominated fire marshal" course recorded for the named people). For managers, the rota lists each stretch of time on each day when people are working but nobody holds a valid record (completed, not expired, not void). It's a warning; it doesn't block publishing. |

## Database (add-only)

Migration `20261117120000_job_titles_and_shift_cover`:
- new table `job_title`, with RLS (enabled and forced, plus a policy), a composite key, a unique live name per organisation, and no app-role DELETE;
- new column `training_course.shift_cover`, default false, with a column-level UPDATE grant.

## Not in M16

- Re-issuing a course to everyone after a menu change (R2);
- bulk CSV import (R5);
- recording a witness for deeds (HotRock signs HR18 on paper);
- holiday, sickness and probation forms;
- payroll.
