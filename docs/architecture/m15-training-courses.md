# M15: interactive training courses (course import)

**Status:** approved by the product owner on 20 November 2026 ("Yes, as recommended": T1 to T5 below). First customer: HotRock Steakhouse, Hove (21 courses). Built so **any** organisation can import courses in the same format.

## Decisions

| | Decision |
|---|---|
| **T1** | Courses are **imported natively** from a course file (JSON, format `hotrock-course` v1), not hosted as the supplier's HTML. TeamHappi shows the pages, runs the quizzes and grades the answers **on the server**, so a learner can't mark their own work. The answer key never reaches the browser before an answer is submitted. |
| **T2** | The file's pass rules are used: each module quiz needs its pass mark (default 75%); the final assessment draws a set number of questions (default 15) from a pool, always including every **safety question**, needs its pass mark (default 80%) and **every safety question right**. Retakes are allowed; each final attempt draws a new mix. The final unlocks when every module quiz is passed. |
| **T3** | A course file may carry job-title rules: **R** = mandatory, **Rec** = recommended (not mandatory). **S** (selected people) isn't imported: managers add named people with the existing "one person" rule. Rules are only added on the first import of a course, and only if the importer ticks the box. |
| **T4** | If the course has a **practical sign-off** (for example a trainer watching the person use the slicer), passing the final isn't the end: the course shows "Awaiting practical sign-off" and a manager with `training.record` at the person's site signs it off. Only then is the training record made. Without a practical, passing the final makes the record straight away. |
| **T5** | A passed course gives a **TeamHappi certificate PDF** (person, course, date, score, expiry, certificate number) downloadable by the person and by managers who can see their training. External courses (for example First Aid at Work) stay "recorded from a certificate". Uploading external certificate files is the next step (M15.2). |

## How it fits the existing training module (M8)

- A new completion method `interactive` (internal courses only) and a new record method `assessment`.
- `training_course_package`: the imported course content, one row per version, insert-only. Re-importing a course with the same code adds a new version and bumps the course's `content_version`; people's existing records stay valid.
- `training_attempt`: every module quiz and final attempt (questions asked, score, pass). Final questions are drawn **by the server** when the attempt starts; the answers are graded against that draw. Submitted attempts can't be changed (database trigger). No deletes.
- Requirements, due dates, expiry, the training matrix and "My training" all work as before: an interactive course is simply another course whose record is made by passing it.

## Security

- RLS (enabled and forced) and composite keys on both new tables; cross-organisation requests return 404.
- Learners only see courses that apply to them (the same rule as read-and-confirm). Managers need `training.manage` to import.
- The course file is validated strictly (shape, sizes, answer ranges, at most 500 KB). Text is shown as plain text with **bold** only; no HTML from the file is ever rendered.
- Audit: `training.course_imported`, `training.attempt_submitted`, `training.practical_signed_off`, `training.certificate_downloaded`, with ids and scores only.

## Not in M15

Uploading external certificate files (M15.2), SCORM/xAPI, timed exams, video.
