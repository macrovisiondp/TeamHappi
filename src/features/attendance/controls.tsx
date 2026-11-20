"use client";

import { Clock, Coffee, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";

import { FormError } from "@/components/ui/form-error";
import { reloadWithNote } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Submit, textareaClass } from "@/features/onboarding/controls";

import {
  clockAction,
  entryAction,
  settingsAction,
  timesheetAction,
  type AttendanceFormState,
} from "./actions";

// Attendance controls (M11.1). They collect input only; the attendance module
// decides on the server what is allowed. Staff never send a time.

const IDLE: AttendanceFormState = { status: "idle" };

function useReloadOnSave(state: AttendanceFormState) {
  useEffect(() => {
    if (state.status === "saved") reloadWithNote(state.message);
  }, [state]);
}

function Problem({ state }: { state: AttendanceFormState }) {
  if (state.status !== "error") return null;
  return (
    <FormError
      message={state.message}
      details={Object.values(state.fieldErrors ?? {})}
    />
  );
}

// --- Staff ---------------------------------------------------------------------------

/** Clock in / break / clock out buttons for the signed-in person. */
export function ClockButtons({
  clockedIn,
  onBreak,
}: {
  clockedIn: boolean;
  onBreak: boolean;
}) {
  const [state, action] = useActionState(clockAction, IDLE);
  useReloadOnSave(state);
  return (
    <div className="flex flex-col gap-3">
      <Problem state={state} />
      <div className="flex flex-wrap gap-3">
        {!clockedIn ? (
          <form action={action}>
            <input type="hidden" name="intent" value="in" />
            <Submit label="Clock in">
              <Clock aria-hidden="true" className="size-4" />
            </Submit>
          </form>
        ) : (
          <>
            <form action={action}>
              <input
                type="hidden"
                name="intent"
                value={onBreak ? "break-end" : "break-start"}
              />
              <Submit
                label={onBreak ? "End break" : "Start break"}
                variant="secondary"
              >
                <Coffee aria-hidden="true" className="size-4" />
              </Submit>
            </form>
            <form action={action}>
              <input type="hidden" name="intent" value="out" />
              <Submit label="Clock out">
                <LogOut aria-hidden="true" className="size-4" />
              </Submit>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// --- Managers ------------------------------------------------------------------------

function ReasonField({ id, error }: { id: string; error?: string }) {
  return (
    <Field id={`reason-${id}`} label="Reason" error={error}>
      <textarea
        id={`reason-${id}`}
        name="reason"
        required
        maxLength={300}
        rows={2}
        className={textareaClass}
        placeholder="For example: phone had no signal"
      />
    </Field>
  );
}

/** Records times for someone at the site. */
export function RecordEntryDialog({
  siteId,
  day,
  staff,
}: {
  siteId: string;
  day: string;
  staff: readonly { id: string; name: string }[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(entryAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        Record times
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Record times"
        description="Times are in the site's time zone. Leave the clock-out empty if they're still here."
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="record" />
          <input type="hidden" name="siteId" value={siteId} />
          <Problem state={state} />
          <Field id={`person-${id}`} label="Person" error={e.employeeId}>
            <Select id={`person-${id}`} name="employeeId" required>
              <option value="">Choose…</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <TimesFields id={id} errors={e} clockIn={`${day}T09:00`} />
          <ReasonField id={id} error={e.reason} />
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Submit label="Record" />
          </div>
        </form>
      </Dialog>
    </>
  );
}

function TimesFields({
  id,
  errors,
  clockIn,
  clockOut,
}: {
  id: string;
  errors: Record<string, string>;
  clockIn: string;
  clockOut?: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={`in-${id}`} label="Clock in" error={errors.clockIn}>
        <Input
          id={`in-${id}`}
          name="clockIn"
          type="datetime-local"
          required
          defaultValue={clockIn}
        />
      </Field>
      <Field id={`out-${id}`} label="Clock out" error={errors.clockOut}>
        <Input
          id={`out-${id}`}
          name="clockOut"
          type="datetime-local"
          defaultValue={clockOut ?? ""}
        />
      </Field>
    </div>
  );
}

/** Correct or remove one entry. */
export function EntryActions({
  entryId,
  summary,
  clockIn,
  clockOut,
}: {
  entryId: string;
  summary: string;
  clockIn: string;
  clockOut: string | null;
}) {
  const id = useId();
  const [dialog, setDialog] = useState<"correct" | "remove" | null>(null);
  const [state, action] = useActionState(entryAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const close = () => setDialog(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setDialog("correct")}
      >
        <Pencil aria-hidden="true" className="size-4" />
        {clockOut ? "Correct" : "Correct or clock out"}
        <span className="sr-only">: {summary}</span>
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setDialog("remove")}>
        <Trash2 aria-hidden="true" className="size-4" />
        Remove<span className="sr-only">: {summary}</span>
      </Button>
      <Dialog
        open={dialog === "correct"}
        onClose={close}
        title="Correct times"
        description={`${summary}. The original times are kept in the history.`}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="correct" />
          <input type="hidden" name="entryId" value={entryId} />
          <Problem state={state} />
          <TimesFields
            id={id}
            errors={e}
            clockIn={clockIn}
            clockOut={clockOut}
          />
          <ReasonField id={id} error={e.reason} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Submit label="Save" />
          </div>
        </form>
      </Dialog>
      <Dialog
        open={dialog === "remove"}
        onClose={close}
        title="Remove this entry?"
        description={`${summary}. Use this only for an entry made in error. It's kept in the history.`}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="remove" />
          <input type="hidden" name="entryId" value={entryId} />
          <Problem state={state} />
          <ReasonField id={`rm-${id}`} error={e.reason} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Submit label="Remove entry" variant="danger" />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** The organisation's flag limits (owners and admins). */
export function SettingsForm({
  toleranceMinutes,
  missedClockOutHours,
}: {
  toleranceMinutes: number;
  missedClockOutHours: number;
}) {
  const id = useId();
  const [state, action] = useActionState(settingsAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <Problem state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`tol-${id}`}
          label="Flag early or late by more than (minutes)"
          error={e.toleranceMinutes}
        >
          <Input
            id={`tol-${id}`}
            name="toleranceMinutes"
            type="number"
            min={0}
            max={60}
            required
            defaultValue={toleranceMinutes}
          />
        </Field>
        <Field
          id={`missed-${id}`}
          label="Missed clock-out after the shift ends (hours)"
          error={e.missedClockOutHours}
        >
          <Input
            id={`missed-${id}`}
            name="missedClockOutHours"
            type="number"
            min={1}
            max={12}
            required
            defaultValue={missedClockOutHours}
          />
        </Field>
      </div>
      <div>
        <Submit label="Save settings" variant="secondary" />
      </div>
    </form>
  );
}

/** Approve a finished week, or reopen an approved one with a reason. */
export function TimesheetActions({
  siteId,
  weekStart,
  approved,
  label,
}: {
  siteId: string;
  weekStart: string;
  approved: boolean;
  label: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(timesheetAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <>
      <Button
        variant={approved ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
      >
        {approved ? "Reopen week" : "Approve week"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={approved ? "Reopen this week?" : "Approve this week?"}
        description={
          approved
            ? `${label}. Times can be changed again until it's approved again. The reason is kept.`
            : `${label}. Approving locks every time in this week. You can reopen it later with a reason.`
        }
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="weekStart" value={weekStart} />
          <input
            type="hidden"
            name="intent"
            value={approved ? "reopen" : "approve"}
          />
          <Problem state={state} />
          {approved ? <ReasonField id={id} error={e.reason} /> : null}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Submit label={approved ? "Reopen" : "Approve"} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
