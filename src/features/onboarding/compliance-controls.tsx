"use client";

import { Check, RotateCcw, ShieldAlert } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { SelectField, SetupForm, TextField } from "@/features/setup/form";
import { IDLE } from "@/features/setup/form-state";

import { onboardingDocumentCommand, recordRightToWorkCheck } from "./actions";
import { ErrorAlert, Submit, textareaClass, useReload } from "./controls";

// Compliance controls (M7.2). They collect input only; the onboarding module
// decides on the server what is allowed and checks every value again.

// --- Document checklist ------------------------------------------------------------------

const DOCUMENT_SUGGESTIONS = [
  "Signed contract",
  "Level 2 Food Hygiene certificate",
  "Allergen awareness certificate",
  "Personal licence",
  "First aid certificate",
];

export function AddDocumentForm({ caseId }: { caseId: string }) {
  return (
    <SetupForm
      action={onboardingDocumentCommand}
      submitLabel="Add document"
      hidden={{ caseId, intent: "add" }}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="field-title"
            label="Document"
            hint="For example a certificate or licence. Right-to-work documents belong in the right-to-work check instead."
            error={e.title}
          >
            <Input
              id="field-title"
              name="title"
              list="document-suggestions"
              maxLength={120}
              required
              aria-describedby="field-title-hint"
              aria-invalid={e.title ? true : undefined}
            />
          </Field>
          <datalist id="document-suggestions">
            {DOCUMENT_SUGGESTIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <label className="flex min-h-11 items-center gap-3 self-end">
            <input
              type="checkbox"
              name="required"
              defaultChecked
              className="size-5 accent-[var(--brand-forest)]"
            />
            <span className="text-sm font-semibold">
              Required before they start
            </span>
          </label>
        </div>
      )}
    </SetupForm>
  );
}

type DocumentDialog = null | "seen" | "reject" | "waive";

export function DocumentActions({
  caseId,
  documentId,
  title,
  status,
  required,
  expiresOn,
  canWaiveRequired,
}: {
  caseId: string;
  documentId: string;
  title: string;
  status: "requested" | "seen" | "verified" | "rejected" | "waived";
  required: boolean;
  expiresOn: string | null;
  canWaiveRequired: boolean;
}) {
  const [open, setOpen] = useState<DocumentDialog>(null);
  const [state, action] = useActionState(onboardingDocumentCommand, IDLE);
  useReload(state);
  const hidden = (
    <>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="documentId" value={documentId} />
    </>
  );
  const canWaive = !required || canWaiveRequired;
  const isOpen = status === "requested";
  const held = status === "seen" || status === "verified";
  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" && !open ? <ErrorAlert state={state} /> : null}
      <div className="flex flex-wrap gap-2">
        {status !== "waived" ? (
          <Button size="sm" onClick={() => setOpen("seen")}>
            <Check aria-hidden="true" />
            {held ? "Update" : "Record as seen"}
            <span className="sr-only"> {title}</span>
          </Button>
        ) : null}
        {isOpen || held ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setOpen("reject")}
          >
            Reject<span className="sr-only"> {title}</span>
          </Button>
        ) : null}
        {isOpen && canWaive ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setOpen("waive")}
          >
            <ShieldAlert aria-hidden="true" />
            Waive<span className="sr-only"> {title}</span>
          </Button>
        ) : null}
        {!isOpen && (status !== "waived" || canWaive) ? (
          <form action={action}>
            {hidden}
            <input type="hidden" name="intent" value="reopen" />
            <Submit label="Reopen" variant="secondary" size="sm">
              <RotateCcw aria-hidden="true" />
            </Submit>
          </form>
        ) : null}
      </div>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          open === "seen"
            ? `Record ${title}`
            : open === "reject"
              ? `Reject ${title}`
              : `Waive ${title}`
        }
        description={
          open === "seen"
            ? "Record that you've seen the original. Keep any copy in your own records: TeamHappi doesn't store files yet."
            : open === "reject"
              ? "Use this if the document isn't acceptable. Your reason is recorded."
              : required
                ? "This is a required document. The waiver and your reason are recorded."
                : "Mark this optional document as not needed. Your reason is recorded."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          {hidden}
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          {open === "seen" ? (
            <>
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-semibold">What you did</legend>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="intent"
                    value="seen"
                    defaultChecked={status !== "verified"}
                    className="size-5 accent-[var(--brand-forest)]"
                  />
                  <span className="text-sm">Saw the original</span>
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="intent"
                    value="verified"
                    defaultChecked={status === "verified"}
                    className="size-5 accent-[var(--brand-forest)]"
                  />
                  <span className="text-sm">
                    Saw the original and checked it with the issuer
                  </span>
                </label>
              </fieldset>
              <Field
                id={`expires-${documentId}`}
                label="Expiry date (optional)"
                hint="Leave blank if it doesn't expire."
              >
                <Input
                  id={`expires-${documentId}`}
                  name="expiresOn"
                  type="date"
                  defaultValue={expiresOn ?? ""}
                  aria-describedby={`expires-${documentId}-hint`}
                />
              </Field>
            </>
          ) : (
            <>
              <input type="hidden" name="intent" value={open ?? ""} />
              <Field
                id={`doc-reason-${documentId}`}
                label="Reason (recorded)"
                hint="Don't include personal details or document numbers."
              >
                <textarea
                  id={`doc-reason-${documentId}`}
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  aria-describedby={`doc-reason-${documentId}-hint`}
                  className={textareaClass}
                />
              </Field>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(null)}
            >
              Cancel
            </Button>
            <Submit
              label={
                open === "seen"
                  ? "Save"
                  : open === "reject"
                    ? "Reject document"
                    : "Waive document"
              }
              variant={open === "reject" ? "danger" : "primary"}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// --- Right-to-work check -----------------------------------------------------------------

const METHOD_OPTIONS = [
  { value: "manual_document", label: "Manual check of original documents" },
  { value: "online_check", label: "Home Office online check (share code)" },
  {
    value: "idsp",
    label: "Identity service provider (digital identity check)",
  },
];
const LIST_OPTIONS = [
  { value: "list_a", label: "List A (continuous)" },
  { value: "list_b_group_1", label: "List B group 1 (time-limited)" },
  { value: "list_b_group_2", label: "List B group 2 (time-limited)" },
];
const OUTCOME_OPTIONS = [
  { value: "confirmed", label: "Confirmed, no follow-up needed" },
  { value: "time_limited", label: "Confirmed, time-limited permission" },
  { value: "not_confirmed", label: "Couldn't be confirmed" },
];

export function RightToWorkForm({
  employeeId,
  currentId,
  members,
  selfMembershipId,
  today,
}: {
  employeeId: string;
  /** The current check, which a new record supersedes; null for the first check. */
  currentId: string | null;
  members: readonly { id: string; name: string }[];
  selfMembershipId: string;
  today: string;
}) {
  // The choice applies to the current record only: once a new record becomes
  // current (after saving), it starts again from "follow-up".
  const [choice, setChoice] = useState({ for: currentId, kind: "follow_up" });
  const kind = !currentId
    ? "initial"
    : choice.for === currentId
      ? choice.kind
      : "follow_up";
  const setKind = (k: string) => setChoice({ for: currentId, kind: k });
  const [method, setMethod] = useState("manual_document");
  const [outcome, setOutcome] = useState("confirmed");
  return (
    <SetupForm
      action={recordRightToWorkCheck}
      submitLabel="Record check"
      hidden={{ employeeId, supersedesId: currentId ?? "" }}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          {currentId ? (
            <Field
              id="field-kind"
              label="What are you recording?"
              hint="The current record stays in the history either way."
              error={e.kind}
              className="md:col-span-2"
            >
              <Select
                id="field-kind"
                name="kind"
                value={kind}
                onChange={(ev) => setKind(ev.target.value)}
                aria-describedby="field-kind-hint"
              >
                <option value="follow_up">A new (follow-up) check</option>
                <option value="correction">
                  A correction to the current record
                </option>
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="kind" value="initial" />
          )}
          {kind === "correction" ? (
            <Field
              id="field-correctionReason"
              label="What was wrong with the current record?"
              hint="Recorded with the correction. Don't include document numbers or share codes."
              error={e.correctionReason}
              className="md:col-span-2"
            >
              <textarea
                id="field-correctionReason"
                name="correctionReason"
                required
                minLength={3}
                maxLength={500}
                rows={2}
                aria-describedby="field-correctionReason-hint"
                aria-invalid={e.correctionReason ? true : undefined}
                className={textareaClass}
              />
            </Field>
          ) : null}
          <Field
            id="field-method"
            label="How the check was done"
            error={e.method}
          >
            <Select
              id="field-method"
              name="method"
              value={method}
              onChange={(ev) => setMethod(ev.target.value)}
              aria-invalid={e.method ? true : undefined}
            >
              {METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {method === "manual_document" ? (
            <SelectField
              name="listType"
              label="Home Office list"
              options={LIST_OPTIONS}
              error={e.listType}
              placeholder="Choose a list"
              required
            />
          ) : null}
          <TextField
            name="checkedOn"
            label="Date of the check"
            type="date"
            defaultValue={today}
            error={e.checkedOn}
            required
          />
          <SelectField
            name="checkedByMembershipId"
            label="Checked by"
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            defaultValue={selfMembershipId}
            error={e.checkedByMembershipId}
            required
          />
          <Field
            id="field-outcome"
            label="Outcome"
            error={e.outcome}
            className="md:col-span-2"
          >
            <Select
              id="field-outcome"
              name="outcome"
              value={outcome}
              onChange={(ev) => setOutcome(ev.target.value)}
              aria-invalid={e.outcome ? true : undefined}
            >
              {OUTCOME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {outcome === "time_limited" ? (
            <>
              <TextField
                name="permissionEndsOn"
                label="Permission ends on"
                type="date"
                error={e.permissionEndsOn}
                required
              />
              <TextField
                name="followUpDueOn"
                label="Follow-up check due by"
                type="date"
                error={e.followUpDueOn}
                hint="On or before the date permission ends. Leave blank to use that date."
              />
            </>
          ) : null}
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="flex min-h-11 items-center gap-3">
              <input
                id="field-personPresent"
                type="checkbox"
                name="personPresent"
                defaultChecked
                aria-invalid={e.personPresent ? true : undefined}
                aria-describedby={
                  e.personPresent ? "field-personPresent-error" : undefined
                }
                className="size-5 accent-[var(--brand-forest)]"
              />
              <span className="text-sm font-semibold">
                The person was present for the check (in person, or by live
                video for an online check)
              </span>
            </label>
            {e.personPresent ? (
              <p
                id="field-personPresent-error"
                role="alert"
                className="text-sm font-medium text-danger"
              >
                {e.personPresent}
              </p>
            ) : null}
          </div>
          <Field
            id="field-note"
            label="Note (optional)"
            hint="Seen only by people who can view right-to-work records. Never type document numbers, share codes or nationality."
            error={e.note}
            className="md:col-span-2"
          >
            <textarea
              id="field-note"
              name="note"
              maxLength={500}
              rows={2}
              aria-describedby="field-note-hint"
              aria-invalid={e.note ? true : undefined}
              className={textareaClass}
            />
          </Field>
        </div>
      )}
    </SetupForm>
  );
}
