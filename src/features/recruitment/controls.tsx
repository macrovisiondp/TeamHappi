"use client";

import { Check, UserCheck, XCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import {
  ErrorAlert,
  Submit,
  textareaClass,
  useReload,
} from "@/features/onboarding/controls";
import { SelectField, SetupForm, TextField } from "@/features/setup/form";
import { IDLE } from "@/features/setup/form-state";

import {
  addApplicationAction,
  anonymiseCandidateAction,
  applicationCommandAction,
  interviewCommandAction,
  saveRecruitmentSettingsAction,
  saveVacancyAction,
  vacancyStatusAction,
} from "./actions";
import { REJECTION_REASON } from "./labels";

// Recruitment controls (M9.1). They collect input only; the recruitment module
// decides on the server what is allowed and checks every value again.

interface Option {
  id: string;
  name: string;
}

// --- Vacancies -------------------------------------------------------------------------

export function VacancyForm({
  options,
  vacancy,
}: {
  options: {
    sites: readonly Option[];
    teams: readonly (Option & { siteId: string })[];
    members: readonly Option[];
  };
  vacancy?: {
    id: string;
    title: string;
    jobTitle: string;
    siteId: string;
    teamId: string | null;
    employmentType: string;
    description: string | null;
    openings: number;
    closesOn: string | null;
    hiringManagerMembershipId: string | null;
    payMin: string | null;
    payMax: string | null;
    payPeriod: string | null;
  };
}) {
  const [siteId, setSiteId] = useState(
    vacancy?.siteId ?? options.sites[0]?.id ?? "",
  );
  const teams = options.teams.filter((t) => t.siteId === siteId);
  return (
    <SetupForm
      action={saveVacancyAction}
      submitLabel={vacancy ? "Save vacancy" : "Create vacancy"}
      hidden={vacancy ? { id: vacancy.id } : undefined}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="title"
            label="Vacancy title"
            defaultValue={vacancy?.title}
            error={e.title}
            hint='For example "Weekend bartender".'
            required
          />
          <TextField
            name="jobTitle"
            label="Job title on hire"
            defaultValue={vacancy?.jobTitle}
            error={e.jobTitle}
            hint="Copied to the person's record when they're hired."
            required
          />
          <Field id="field-siteId" label="Site" error={e.siteId}>
            <Select
              id="field-siteId"
              name="siteId"
              value={siteId}
              onChange={(ev) => setSiteId(ev.target.value)}
              aria-invalid={e.siteId ? true : undefined}
            >
              {options.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="field-teamId" label="Team (optional)" error={e.teamId}>
            <Select
              id="field-teamId"
              name="teamId"
              key={siteId}
              defaultValue={
                vacancy?.siteId === siteId ? (vacancy?.teamId ?? "") : ""
              }
            >
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <SelectField
            name="employmentType"
            label="Employment type"
            options={[
              { value: "full_time", label: "Full time" },
              { value: "part_time", label: "Part time" },
              { value: "casual", label: "Casual" },
              { value: "fixed_term", label: "Fixed term" },
              { value: "seasonal", label: "Seasonal" },
            ]}
            defaultValue={vacancy?.employmentType ?? "part_time"}
            error={e.employmentType}
            required
          />
          <Field id="field-openings" label="Openings" error={e.openings}>
            <Input
              id="field-openings"
              name="openings"
              type="number"
              min={1}
              max={100}
              step={1}
              defaultValue={String(vacancy?.openings ?? 1)}
            />
          </Field>
          <TextField
            name="closesOn"
            label="Closing date"
            type="date"
            defaultValue={vacancy?.closesOn}
            error={e.closesOn}
          />
          <SelectField
            name="hiringManagerMembershipId"
            label="Hiring manager"
            options={options.members.map((m) => ({
              value: m.id,
              label: m.name,
            }))}
            defaultValue={vacancy?.hiringManagerMembershipId}
            placeholder="Not set"
            error={e.hiringManagerMembershipId}
          />
          <fieldset className="grid gap-4 md:col-span-2 md:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">
              Pay (optional)
            </legend>
            <TextField
              name="payMin"
              label="From (£)"
              defaultValue={vacancy?.payMin}
              error={e.payMin}
            />
            <TextField
              name="payMax"
              label="To (£)"
              defaultValue={vacancy?.payMax}
              error={e.payMax}
            />
            <SelectField
              name="payPeriod"
              label="Per"
              options={[
                { value: "hour", label: "Hour" },
                { value: "year", label: "Year" },
              ]}
              defaultValue={vacancy?.payPeriod}
              placeholder="Choose"
              error={e.payPeriod}
            />
          </fieldset>
          <Field
            id="field-description"
            label="Description (optional)"
            error={e.description}
            className="md:col-span-2"
          >
            <textarea
              id="field-description"
              name="description"
              defaultValue={vacancy?.description ?? ""}
              maxLength={5000}
              rows={5}
              className={textareaClass}
            />
          </Field>
        </div>
      )}
    </SetupForm>
  );
}

export function VacancyStatusControl({
  vacancyId,
  status,
}: {
  vacancyId: string;
  status: string;
}) {
  const [state, action] = useActionState(vacancyStatusAction, IDLE);
  useReload(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="vacancyId" value={vacancyId} />
      <Field id="vacancy-status" label="Vacancy status">
        <Select id="vacancy-status" name="status" defaultValue={status}>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="paused">Paused</option>
          <option value="filled">Filled</option>
          <option value="closed">Closed</option>
        </Select>
      </Field>
      <Submit label="Change status" variant="secondary" />
      {state.status === "error" ? <ErrorAlert state={state} /> : null}
    </form>
  );
}

// --- Applicants -------------------------------------------------------------------------

export function AddApplicantForm({
  vacancyId,
  matches,
  email,
}: {
  vacancyId: string;
  matches: readonly (Option & { vacancies: readonly string[] })[];
  email: string;
}) {
  const [existing, setExisting] = useState("");
  return (
    <SetupForm
      action={addApplicationAction}
      submitLabel="Add applicant"
      hidden={{ vacancyId }}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          {matches.length ? (
            <Field
              id="field-candidateId"
              label="Existing candidate"
              hint="Candidates are never merged automatically. Choose one only if it's the same person."
              error={e.candidateId}
              className="md:col-span-2"
            >
              <Select
                id="field-candidateId"
                name="candidateId"
                value={existing}
                onChange={(ev) => setExisting(ev.target.value)}
                aria-describedby="field-candidateId-hint"
              >
                <option value="">No, add a new candidate</option>
                {matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.vacancies.length
                      ? ` (applied for ${m.vacancies.join(", ")})`
                      : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {existing ? null : (
            <>
              <TextField
                name="givenName"
                label="First name"
                error={e.givenName}
                required
              />
              <TextField
                name="familyName"
                label="Last name"
                error={e.familyName}
                required
              />
              <TextField
                name="email"
                label="Email"
                type="email"
                defaultValue={email}
                error={e.email}
              />
              <TextField
                name="phone"
                label="Phone"
                type="tel"
                error={e.phone}
              />
              <SelectField
                name="source"
                label="Source"
                options={[
                  { value: "manual", label: "Applied directly" },
                  { value: "referral", label: "Referral" },
                  { value: "agency", label: "Agency" },
                ]}
                defaultValue="manual"
              />
              <label className="flex min-h-11 items-center gap-3 self-end">
                <input
                  type="checkbox"
                  name="confirmNew"
                  className="size-5 accent-[var(--brand-forest)]"
                />
                <span className="text-sm font-semibold">
                  This is a different person
                </span>
              </label>
              <p className="text-sm text-ink-muted md:col-span-2">
                Collect only what you need. Don&rsquo;t record date of birth,
                nationality, photos or right-to-work details at this stage.
              </p>
            </>
          )}
        </div>
      )}
    </SetupForm>
  );
}

type AppDialog = null | "reject" | "withdraw" | "hire";

export function ApplicationActions({
  applicationId,
  stage,
  labels,
  canHire,
  hireAuthorised,
  templates,
  vacancyTitle,
  name,
}: {
  applicationId: string;
  stage: string;
  labels: Record<string, string>;
  canHire: boolean;
  hireAuthorised: boolean;
  templates: readonly Option[];
  vacancyTitle: string;
  name: string;
}) {
  const [open, setOpen] = useState<AppDialog>(null);
  const [state, action] = useActionState(applicationCommandAction, IDLE);
  // After a hire, go to the new employee record; otherwise reload the page.
  useEffect(() => {
    if (state.status !== "saved") return;
    if (state.href) window.location.assign(state.href);
    else window.location.reload();
  }, [state]);
  const [onboard, setOnboard] = useState(templates.length > 0);
  const hidden = (
    <input type="hidden" name="applicationId" value={applicationId} />
  );
  return (
    <div className="flex flex-col gap-3">
      {state.status === "error" && !open ? <ErrorAlert state={state} /> : null}
      <form action={action} className="flex flex-wrap items-end gap-3">
        {hidden}
        <input type="hidden" name="intent" value="move" />
        <Field id="move-stage" label="Stage">
          <Select id="move-stage" name="stage" defaultValue={stage}>
            {(
              [
                "applied",
                "screening",
                "shortlisted",
                "interview",
                "offer",
              ] as const
            ).map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Submit label="Move" variant="secondary" />
      </form>
      <div className="flex flex-wrap gap-2">
        {hireAuthorised ? (
          <Button
            onClick={() => setOpen("hire")}
            disabled={!canHire}
            disabledReason={
              canHire ? undefined : `Move to ${labels.offer} first`
            }
          >
            <UserCheck aria-hidden="true" />
            Hire
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setOpen("reject")}>
          <XCircle aria-hidden="true" />
          Reject
        </Button>
        <Button variant="secondary" onClick={() => setOpen("withdraw")}>
          Withdrawn by candidate
        </Button>
      </div>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          open === "hire"
            ? `Hire ${name}?`
            : open === "reject"
              ? `Reject ${name}?`
              : `Mark ${name} as withdrawn?`
        }
        description={
          open === "hire"
            ? `This creates their employee record for ${vacancyTitle}. It doesn't create a TeamHappi login: you can invite them from their record afterwards.`
            : open === "reject"
              ? "The application is closed. No email is sent: tell the candidate yourself."
              : "Use this when the candidate tells you they're no longer interested."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          {hidden}
          <input type="hidden" name="intent" value={open ?? ""} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          {open === "reject" ? (
            <Field id="reject-reason" label="Reason (recorded)">
              <Select id="reject-reason" name="reason" required defaultValue="">
                <option value="" disabled>
                  Choose a reason
                </option>
                {Object.entries(REJECTION_REASON).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          ) : open === "hire" ? (
            <>
              <Field id="hire-start" label="Start date">
                <Input id="hire-start" name="startDate" type="date" required />
              </Field>
              {templates.length ? (
                <>
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      name="startOnboarding"
                      checked={onboard}
                      onChange={(ev) => setOnboard(ev.target.checked)}
                      className="size-5 accent-[var(--brand-forest)]"
                    />
                    <span className="text-sm font-semibold">
                      Start onboarding now
                    </span>
                  </label>
                  {onboard ? (
                    <Field id="hire-template" label="Onboarding template">
                      <Select id="hire-template" name="templateId" required>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  Onboarding can be started from their record afterwards.
                </p>
              )}
            </>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(null)}
            >
              Back
            </Button>
            <Submit
              label={
                open === "hire"
                  ? "Hire"
                  : open === "reject"
                    ? "Reject"
                    : "Mark withdrawn"
              }
              variant={open === "hire" ? "primary" : "danger"}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function NoteForm({ applicationId }: { applicationId: string }) {
  return (
    <SetupForm
      action={applicationCommandAction}
      submitLabel="Add note"
      hidden={{ applicationId, intent: "note" }}
    >
      {(e) => (
        <Field
          id="field-body"
          label="Note"
          hint="Notes can't be edited or deleted. Write as if the candidate will read it: they can ask to see it."
          error={e.body}
        >
          <textarea
            id="field-body"
            name="body"
            required
            maxLength={2000}
            rows={3}
            aria-describedby="field-body-hint"
            className={textareaClass}
          />
        </Field>
      )}
    </SetupForm>
  );
}

// --- Interviews -------------------------------------------------------------------------

export function ScheduleInterviewForm({
  applicationId,
  members,
  self,
}: {
  applicationId: string;
  members: readonly Option[];
  self: string;
}) {
  return (
    <SetupForm
      action={applicationCommandAction}
      submitLabel="Schedule interview"
      hidden={{ applicationId, intent: "schedule" }}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="field-scheduledAt"
            label="Date and time"
            error={e.scheduledAt}
          >
            <Input
              id="field-scheduledAt"
              name="scheduledAt"
              type="datetime-local"
              required
              aria-invalid={e.scheduledAt ? true : undefined}
            />
          </Field>
          <Field
            id="field-durationMinutes"
            label="Length (minutes)"
            error={e.durationMinutes}
          >
            <Input
              id="field-durationMinutes"
              name="durationMinutes"
              type="number"
              min={5}
              max={480}
              step={5}
              defaultValue="30"
            />
          </Field>
          <SelectField
            name="format"
            label="Format"
            options={[
              { value: "in_person", label: "In person" },
              { value: "phone", label: "Phone" },
              { value: "video", label: "Video call" },
            ]}
            defaultValue="in_person"
            required
          />
          <TextField
            name="location"
            label="Where"
            error={e.location}
            hint="A room, or how to join. No candidate details."
          />
          <fieldset className="flex flex-col gap-1 md:col-span-2">
            <legend id="field-interviewerIds" className="text-sm font-semibold">
              Interviewers
            </legend>
            {e.interviewerIds ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {e.interviewerIds}
              </p>
            ) : null}
            <div className="grid gap-1 sm:grid-cols-2">
              {members.map((m) => (
                <label key={m.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    name="interviewerIds"
                    value={m.id}
                    defaultChecked={m.id === self}
                    className="size-5 accent-[var(--brand-forest)]"
                  />
                  <span className="text-sm">{m.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </SetupForm>
  );
}

type InterviewDialog = null | "feedback" | "cancel";

export function InterviewActions({
  interviewId,
  status,
  canManage,
  canFeedback,
}: {
  interviewId: string;
  status: string;
  canManage: boolean;
  canFeedback: boolean;
}) {
  const [open, setOpen] = useState<InterviewDialog>(null);
  const [state, action] = useActionState(interviewCommandAction, IDLE);
  useReload(state);
  const hidden = <input type="hidden" name="interviewId" value={interviewId} />;
  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" && !open ? <ErrorAlert state={state} /> : null}
      <div className="flex flex-wrap gap-2">
        {canFeedback && status !== "cancelled" ? (
          <Button size="sm" onClick={() => setOpen("feedback")}>
            <Check aria-hidden="true" />
            {status === "completed" ? "Update feedback" : "Record outcome"}
          </Button>
        ) : null}
        {canManage && status === "scheduled" ? (
          <>
            <form action={action}>
              {hidden}
              <input type="hidden" name="intent" value="no_show" />
              <Submit label="No show" variant="secondary" size="sm" />
            </form>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setOpen("cancel")}
            >
              Cancel interview
            </Button>
          </>
        ) : null}
      </div>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          open === "feedback" ? "Interview outcome" : "Cancel this interview?"
        }
        description={
          open === "feedback"
            ? "Write as if the candidate will read it: they can ask to see it."
            : "No email is sent: tell the candidate and interviewers yourself."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          {hidden}
          <input type="hidden" name="intent" value={open ?? ""} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          {open === "feedback" ? (
            <>
              <Field id={`outcome-${interviewId}`} label="Outcome">
                <Select
                  id={`outcome-${interviewId}`}
                  name="outcome"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose
                  </option>
                  <option value="progress">Progress</option>
                  <option value="hold">Hold</option>
                  <option value="do_not_progress">Don&rsquo;t progress</option>
                </Select>
              </Field>
              <Field id={`feedback-${interviewId}`} label="Feedback (optional)">
                <textarea
                  id={`feedback-${interviewId}`}
                  name="feedback"
                  maxLength={4000}
                  rows={4}
                  className={textareaClass}
                />
              </Field>
            </>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(null)}
            >
              Back
            </Button>
            <Submit
              label={open === "feedback" ? "Save" : "Cancel interview"}
              variant={open === "cancel" ? "danger" : "primary"}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// --- Settings and data review --------------------------------------------------------------

export function RecruitmentSettingsForm({
  labels,
  retentionMonths,
}: {
  labels: Record<string, string>;
  retentionMonths: number;
}) {
  return (
    <SetupForm
      action={saveRecruitmentSettingsAction}
      submitLabel="Save settings"
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              "applied",
              "screening",
              "shortlisted",
              "interview",
              "offer",
            ] as const
          ).map((k) => (
            <TextField
              key={k}
              name={`label-${k}`}
              label={`Name for the "${k}" stage`}
              defaultValue={labels[k]}
              error={e.labels}
            />
          ))}
          <Field
            id="field-retentionMonths"
            label="Review candidate data after (months)"
            hint="After an application ends. Between 3 and 12 months; confirm the period with your adviser."
            error={e.retentionMonths}
          >
            <Input
              id="field-retentionMonths"
              name="retentionMonths"
              type="number"
              min={3}
              max={12}
              step={1}
              defaultValue={String(retentionMonths)}
              aria-describedby="field-retentionMonths-hint"
            />
          </Field>
        </div>
      )}
    </SetupForm>
  );
}

export function AnonymiseButton({
  candidateId,
  name,
}: {
  candidateId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(anonymiseCandidateAction, IDLE);
  useReload(state);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Anonymise<span className="sr-only"> {name}</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Anonymise ${name}?`}
        description="Their name and contact details are removed, notes and interview feedback are cleared. Stage history is kept for reporting. This can't be undone."
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="candidateId" value={candidateId} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Back
            </Button>
            <Submit label="Anonymise" variant="danger" />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function EmailNotice() {
  return (
    <Alert tone="info" title="No emails are sent to candidates yet">
      Applicant email isn&rsquo;t set up. Tell candidates about interviews and
      decisions yourself.
    </Alert>
  );
}
