# M19: a smoother start for new staff

**Status:** requested by the product owner on 21 November 2026 ("make it as interactive as possible, a progressive onboarding with confetti at the completion").

| | |
|---|---|
| **Add person sends the welcome** | "Send their invitation and starter pack now" is ticked by default on Add person. An email is then required. Saving creates the record, emails the invitation and sends the starter pack for their job title, as hiring through Recruitment already does. The employee number is no longer on the Add form; it's given automatically and can be changed on Edit. |
| **Contract templates** | The document library holds policies and **contract templates**: one file for everyone in a job, for example a zero-hours contract. Starter packs can include them. They're sent as a contract and countersigned after the person signs. |
| **Your first steps** (`/welcome`) | A new starter lands here from the dashboard until all three steps are done: **About you** (address, date of birth, emergency contact), **Sign your documents** (policies and contract, signed on the page), and **Start your training** (opens once 1 and 2 are done). A progress bar fills, ticks pop in, and confetti plays once on completion (skipped with reduced motion). "Do this later" and "See my shifts" are always there; nothing is hard-locked. |

## Database

Migration `20261120120000_contract_templates`: widens `sign_document_kind` so `contract_template` (no person) is allowed. Every existing row already fits, and no rows change.
