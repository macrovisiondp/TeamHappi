# M18: offboarding

**Status:** approved by the product owner on 20 November 2026 ("Yes, as recommended").

## What it does

| | |
|---|---|
| **Mark as leaving** | On a person's record, someone with `employee.manage` at their site records the last working day, a reason (resigned, end of contract, dismissed, other) and an optional private note. A leaver checklist starts by itself when a leaving template fits (job title, then site, then everyone). |
| **After the last day** | The leaving is finalised: the record becomes "left", the login stops working for this organisation (membership "left"), open invitations are revoked, shifts after the last day are unassigned (they show as open), and documents still waiting for a signature are withdrawn. Everything else is kept. |
| **On time, no scheduled job** | Finalising is checked whenever anyone in the organisation loads TeamHappi (`resolve.ts`), before that person's own access is checked: one indexed query when nothing is due. |
| **End access now** | When recording, or later, for example after a dismissal: finalised at once, shifts from now on released. |
| **Cancel leaving** | Until it's final; the leaver checklist is cancelled with it. After that, the person is rehired in the normal way. |
| **Leaver checklists** | Onboarding templates and checklists now have a purpose, joining or leaving. A leaving checklist's dates count from the last day. A suggested "Leaver checklist" is included. Joining counts are unchanged: cleared to start, rota warnings and My onboarding all look at joining checklists only. |

## Privacy

The private note is shown only to people who can edit the record. It's never put in the audit trail, which records ids, the reason code and the date. Leavings can't be deleted.

## Database (add-only, plus one widened index)

Migration `20261119120000_offboarding`:
- new table `employee_leaving`, with RLS (enabled and forced, plus a policy), a composite key, at most one open leaving per person, and no DELETE;
- `purpose` added to `onboarding_template` and `onboarding_case` (default `joining`, so existing rows are unchanged);
- the "one active checklist per person" index becomes one active checklist **of each purpose** per person.
