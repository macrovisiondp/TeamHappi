"use client";

import { DoorOpen, LogOut, Undo2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { reloadWithNote } from "@/components/ui/toast";
import { Submit, textareaClass } from "@/features/onboarding/controls";
import { formatDate } from "@/lib/format";

import { leavingAction, type LeavingState } from "./leaving-actions";

// Offboarding on a person's record (M18).

const IDLE: LeavingState = { status: "idle" };

const REASONS = [
  { value: "resigned", label: "Resigned" },
  { value: "end_of_contract", label: "End of contract" },
  { value: "dismissed", label: "Dismissed" },
  { value: "other", label: "Other" },
] as const;

const reasonLabel = (r: string) =>
  REASONS.find((x) => x.value === r)?.label ?? r;

function useDone(state: LeavingState) {
  useEffect(() => {
    if (state.status === "saved") reloadWithNote(state.message);
  }, [state]);
}

export interface LeavingView {
  status: "pending" | "active" | "left";
  leaving: {
    lastDay: string;
    reason: string;
    note: string | null;
    finalised: boolean;
    endedEarly: boolean;
  } | null;
  checklist: { id: string; status: string; done: number; total: number } | null;
  templates: { id: string; name: string }[];
}

export function LeavingPanel({
  employeeId,
  name,
  today,
  view,
}: {
  employeeId: string;
  name: string;
  today: string;
  view: LeavingView;
}) {
  const l = view.leaving;
  if (!l && view.status === "left")
    return (
      <p className="text-sm text-ink-muted">
        {name} has left. Their records are kept.
      </p>
    );
  if (!l)
    return (
      <MarkLeaving
        employeeId={employeeId}
        name={name}
        today={today}
        templates={view.templates}
      />
    );
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">Last working day</dt>
          <dd className="font-semibold">{formatDate(l.lastDay)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Reason</dt>
          <dd>{reasonLabel(l.reason)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Access</dt>
          <dd>
            {l.finalised
              ? l.endedEarly
                ? "Ended early"
                : "Ended after their last day"
              : "Ends after their last day"}
          </dd>
        </div>
      </dl>
      {l.note ? (
        <p className="rounded-lg bg-sage/50 p-3 text-sm">
          <span className="font-semibold">Private note: </span>
          {l.note}
        </p>
      ) : null}
      {view.checklist ? (
        <p className="text-sm">
          Leaver checklist: {view.checklist.done} of {view.checklist.total}{" "}
          done.{" "}
          <a
            href={`/onboarding/${view.checklist.id}`}
            className="font-semibold text-forest underline-offset-4 hover:underline"
          >
            Open it
          </a>
        </p>
      ) : view.templates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Tip: add a leaving checklist in Onboarding › Templates, and it starts
          automatically for the next leaver.
        </p>
      ) : null}
      {!l.finalised ? (
        <div className="flex flex-wrap gap-2">
          <Command
            employeeId={employeeId}
            intent="end-now"
            label="End access now"
            icon="end"
            confirmTitle={`End ${name}'s access now?`}
            confirmText="They can't sign in to your organisation from now on, and their shifts from now on become open. Their records are kept."
          />
          <Command
            employeeId={employeeId}
            intent="cancel"
            label="Cancel leaving"
            icon="undo"
            confirmTitle={`Cancel ${name}'s leaving?`}
            confirmText="They stay on as normal, and their leaver checklist is closed."
          />
        </div>
      ) : null}
    </div>
  );
}

function MarkLeaving({
  employeeId,
  name,
  today,
  templates,
}: {
  employeeId: string;
  name: string;
  today: string;
  templates: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(leavingAction, IDLE);
  useDone(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-muted">
          When {name} leaves, record their last day. Their access ends
          automatically after it, and their later shifts become open.
        </p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <DoorOpen aria-hidden="true" />
          Mark as leaving
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${name} is leaving`}
        description="Their records, signed documents and history are kept."
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="mark" />
          <input type="hidden" name="employeeId" value={employeeId} />
          {state.status === "error" && !Object.keys(e).length ? (
            <FormError message={state.message} />
          ) : null}
          <Field id="leave-lastDay" label="Last working day" error={e.lastDay}>
            <Input
              id="leave-lastDay"
              name="lastDay"
              type="date"
              defaultValue={today}
              required
            />
          </Field>
          <Field id="leave-reason" label="Reason" error={e.reason}>
            <Select id="leave-reason" name="reason" defaultValue="" required>
              <option value="" disabled>
                Choose a reason
              </option>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          {templates.length ? (
            <Field
              id="leave-template"
              label="Leaver checklist"
              hint="Chosen for you from their job title unless you pick one."
            >
              <Select id="leave-template" name="templateId" defaultValue="">
                <option value="">Choose for me</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            id="leave-note"
            label="Private note (optional)"
            hint="Only managers who can edit their record see this."
            error={e.note}
          >
            <textarea
              id="leave-note"
              name="note"
              rows={3}
              maxLength={1000}
              className={textareaClass}
            />
          </Field>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              name="endNow"
              className="mt-0.5 size-5 shrink-0 accent-[var(--brand-forest)]"
            />
            <span className="text-sm">
              <span className="font-semibold">End their access now</span>
              <span className="block text-ink-muted">
                For example after a dismissal. Otherwise access ends after their
                last day.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Back
            </Button>
            <Submit label="Record leaving" />
          </div>
        </form>
      </Dialog>
    </>
  );
}

function Command({
  employeeId,
  intent,
  label,
  icon,
  confirmTitle,
  confirmText,
}: {
  employeeId: string;
  intent: "cancel" | "end-now";
  label: string;
  icon: "end" | "undo";
  confirmTitle: string;
  confirmText: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(leavingAction, IDLE);
  useDone(state);
  const Icon = icon === "end" ? LogOut : Undo2;
  return (
    <>
      <Button
        variant={icon === "end" ? "danger" : "secondary"}
        onClick={() => setOpen(true)}
      >
        <Icon aria-hidden="true" />
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        description={confirmText}
      >
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="employeeId" value={employeeId} />
          {state.status === "error" ? (
            <FormError message={state.message} />
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Back
            </Button>
            <Submit
              label={label}
              variant={icon === "end" ? "danger" : "primary"}
            />
          </div>
        </form>
      </Dialog>
    </>
  );
}
