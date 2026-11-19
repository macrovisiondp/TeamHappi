"use client";

import { AlertTriangle, Ban, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Submit, textareaClass } from "@/features/onboarding/controls";

import {
  availabilityAction,
  changeCommandAction,
  markShiftsSeenAction,
  myChangeAction,
  myShiftAction,
  requestCommandAction,
  saveShiftAction,
  shiftCommandAction,
  weekCommandAction,
  type RotaFormState,
} from "./actions";

// Rota controls (M10.1). They collect input only; the rota module decides on
// the server what is allowed and runs every check again.

const IDLE: RotaFormState = { status: "idle" };

function useReloadOnSave(state: RotaFormState) {
  useEffect(() => {
    if (state.status === "saved") window.location.reload();
  }, [state]);
}

function Problem({ state }: { state: RotaFormState }) {
  if (state.status !== "error") return null;
  const fields = Object.values(state.fieldErrors ?? {});
  return (
    <Alert tone="danger" title={state.message} role="alert">
      {fields.length ? (
        <ul className="list-disc pl-5">
          {fields.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

function WarningList({
  warnings,
}: {
  warnings: readonly { message: string; blocking: boolean }[];
}) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {warnings.map((w) => (
        <li key={w.message} className="flex items-start gap-2">
          {w.blocking ? (
            <Ban
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-danger"
            />
          ) : (
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
          )}
          <span>
            <span className="sr-only">
              {w.blocking ? "Blocked: " : "Warning: "}
            </span>
            {w.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ShiftFormValues {
  id?: string;
  day: string;
  start: string;
  end: string;
  breakMinutes: number;
  teamId: string | null;
  roleLabel: string | null;
  note: string | null;
}

const DAY_LABEL = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

/** Add a shift, or edit one (`shift` given). */
export function ShiftDialog({
  siteId,
  weekStart,
  days,
  teams,
  shift,
  label,
}: {
  siteId: string;
  weekStart: string;
  days: readonly string[];
  teams: readonly { id: string; name: string }[];
  shift?: ShiftFormValues;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveShiftAction, IDLE);
  useReloadOnSave(state);
  const id = shift?.id ?? "new";
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <>
      <Button
        size="sm"
        variant={shift ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
      >
        {shift ? null : <Plus aria-hidden="true" />}
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={shift ? "Edit shift" : "Add a shift"}
        description="Times are in the site's time zone. An end time before the start means the shift finishes the next day."
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="weekStart" value={weekStart} />
          {shift?.id ? (
            <input type="hidden" name="shiftId" value={shift.id} />
          ) : null}
          <Problem state={state} />
          <Field id={`day-${id}`} label="Day" error={e.day}>
            <Select
              id={`day-${id}`}
              name="day"
              defaultValue={shift?.day ?? days[0]}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {DAY_LABEL(d)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id={`start-${id}`} label="Start" error={e.start}>
              <Input
                id={`start-${id}`}
                name="start"
                type="time"
                required
                defaultValue={shift?.start ?? "09:00"}
              />
            </Field>
            <Field id={`end-${id}`} label="End" error={e.end}>
              <Input
                id={`end-${id}`}
                name="end"
                type="time"
                required
                defaultValue={shift?.end ?? "17:00"}
              />
            </Field>
            <Field
              id={`break-${id}`}
              label="Break (min)"
              error={e.breakMinutes}
            >
              <Input
                id={`break-${id}`}
                name="breakMinutes"
                type="number"
                min={0}
                max={240}
                defaultValue={shift?.breakMinutes ?? 30}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`role-${id}`}
              label="Role (optional)"
              error={e.roleLabel}
            >
              <Input
                id={`role-${id}`}
                name="roleLabel"
                maxLength={60}
                placeholder="For example Bar or Grill"
                defaultValue={shift?.roleLabel ?? ""}
              />
            </Field>
            <Field id={`team-${id}`} label="Team (optional)" error={e.teamId}>
              <Select
                id={`team-${id}`}
                name="teamId"
                defaultValue={shift?.teamId ?? ""}
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id={`note-${id}`} label="Note (optional)" error={e.note}>
            <textarea
              id={`note-${id}`}
              name="note"
              maxLength={500}
              rows={2}
              defaultValue={shift?.note ?? ""}
              className={textareaClass}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Back
            </Button>
            <Submit label={shift ? "Save shift" : "Add shift"} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Assign, unassign or cancel one shift. */
export function ShiftActions({
  shiftId,
  summary,
  people,
  assigneeId,
}: {
  shiftId: string;
  summary: string;
  people: readonly { id: string; name: string; jobTitle: string | null }[];
  assigneeId: string | null;
}) {
  const [dialog, setDialog] = useState<null | "assign" | "unassign" | "cancel">(
    null,
  );
  const [state, action] = useActionState(shiftCommandAction, IDLE);
  useReloadOnSave(state);
  const close = () => setDialog(null);
  const err = state.status === "error" ? state : null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setDialog("assign")}>
        {assigneeId ? "Change person" : "Assign"}
        <span className="sr-only"> for {summary}</span>
      </Button>
      {assigneeId ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDialog("unassign")}
        >
          Make open<span className="sr-only"> for {summary}</span>
        </Button>
      ) : null}
      <Button size="sm" variant="danger" onClick={() => setDialog("cancel")}>
        Cancel shift<span className="sr-only"> {summary}</span>
      </Button>

      <Dialog
        open={dialog === "assign"}
        onClose={close}
        title="Who's working this shift?"
        description={summary}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="intent" value="assign" />
          {err && !err.warnings?.length ? <Problem state={state} /> : null}
          {err?.warnings?.length ? (
            <Alert
              tone={err.needsReason ? "warning" : "danger"}
              title={
                err.needsReason
                  ? "Check before going ahead"
                  : "This can't be assigned"
              }
              role="alert"
            >
              <WarningList warnings={err.warnings} />
            </Alert>
          ) : null}
          <Field id={`person-${shiftId}`} label="Person">
            <Select
              id={`person-${shiftId}`}
              name="employeeId"
              required
              defaultValue={assigneeId ?? ""}
            >
              <option value="" disabled>
                Choose a person
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.jobTitle ? ` (${p.jobTitle})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {err?.needsReason ? (
            <Field
              id={`reason-${shiftId}`}
              label="Why is it OK to go ahead?"
              hint="Kept with the shift for managers. It isn't shown to the person."
              error={err.fieldErrors?.overrideReason}
            >
              <textarea
                id={`reason-${shiftId}`}
                name="overrideReason"
                required
                maxLength={300}
                rows={2}
                aria-describedby={`reason-${shiftId}-hint`}
                className={textareaClass}
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Back
            </Button>
            <Submit label={err?.needsReason ? "Assign anyway" : "Assign"} />
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "unassign" || dialog === "cancel"}
        onClose={close}
        title={
          dialog === "cancel" ? "Cancel this shift?" : "Make this shift open?"
        }
        description={
          dialog === "cancel"
            ? `${summary}. It stays in the history but no longer counts.`
            : `${summary}. Nobody will be on it until you assign someone.`
        }
      >
        <form action={action} className="flex flex-wrap justify-end gap-3">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="intent" value={dialog ?? ""} />
          {err ? <Problem state={state} /> : null}
          <Button type="button" variant="secondary" onClick={close}>
            Back
          </Button>
          <Submit
            label={dialog === "cancel" ? "Cancel shift" : "Make open"}
            variant="danger"
          />
        </form>
      </Dialog>
    </div>
  );
}

/** Copy last week and Publish. */
export function WeekActions({
  siteId,
  weekStart,
  canCopy,
  canPublish,
  shifts,
}: {
  siteId: string;
  weekStart: string;
  canCopy: boolean;
  canPublish: boolean;
  shifts: number;
}) {
  const [confirm, setConfirm] = useState<null | "copy" | "publish">(null);
  const [state, action] = useActionState(weekCommandAction, IDLE);
  useReloadOnSave(state);
  if (!canCopy && !canPublish) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canCopy ? (
        <Button variant="secondary" onClick={() => setConfirm("copy")}>
          Copy last week
        </Button>
      ) : null}
      {canPublish ? (
        <Button onClick={() => setConfirm("publish")}>Publish week</Button>
      ) : null}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "publish" ? "Publish this week?" : "Copy last week?"}
        description={
          confirm === "publish"
            ? `${shifts} shift${shifts === 1 ? "" : "s"}. Once published, changes are kept in the week's history.`
            : "Copies last week's shifts at the same times. People are copied only where every check passes; the rest are left open."
        }
      >
        <form action={action} className="flex flex-wrap justify-end gap-3">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="weekStart" value={weekStart} />
          <input type="hidden" name="intent" value={confirm ?? ""} />
          {state.status === "error" ? <Problem state={state} /> : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirm(null)}
          >
            Back
          </Button>
          <Submit label={confirm === "publish" ? "Publish" : "Copy"} />
        </form>
      </Dialog>
    </div>
  );
}

// --- M10.2: requests ---------------------------------------------------------------------

/** A manager answers one request to take an open shift. */
export function RequestActions({
  requestId,
  name,
  summary,
}: {
  requestId: string;
  name: string;
  summary: string;
}) {
  const [state, action] = useActionState(requestCommandAction, IDLE);
  // A blocked or warned approval opens the dialog to explain, until closed.
  const [closedFor, setClosedFor] = useState<RotaFormState | null>(null);
  useReloadOnSave(state);
  const err = state.status === "error" ? state : null;
  const open = !!err?.warnings?.length && closedFor !== state;
  const close = () => setClosedFor(state);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{name}</span>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <Button size="sm" type="submit" name="decision" value="approve">
          Approve
          <span className="sr-only">
            {" "}
            {name} for {summary}
          </span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="submit"
          name="decision"
          value="decline"
        >
          Decline
          <span className="sr-only">
            {" "}
            {name} for {summary}
          </span>
        </Button>
      </form>
      {err && !err.warnings?.length ? <Problem state={state} /> : null}
      <Dialog
        open={open}
        onClose={close}
        title={`Approve ${name}?`}
        description={summary}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="approve" />
          {err?.warnings?.length ? (
            <Alert
              tone={err.needsReason ? "warning" : "danger"}
              title={
                err.needsReason
                  ? "Check before going ahead"
                  : "This can't be approved"
              }
              role="alert"
            >
              <WarningList warnings={err.warnings} />
            </Alert>
          ) : null}
          {err?.needsReason ? (
            <Field
              id={`req-reason-${requestId}`}
              label="Why is it OK to go ahead?"
              error={err.fieldErrors?.overrideReason}
            >
              <textarea
                id={`req-reason-${requestId}`}
                name="overrideReason"
                required
                maxLength={300}
                rows={2}
                className={textareaClass}
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Back
            </Button>
            {err?.needsReason ? <Submit label="Approve anyway" /> : null}
          </div>
        </form>
      </Dialog>
    </li>
  );
}

// --- M10.2: My shifts --------------------------------------------------------------------

/** Ask for an open shift, or withdraw the request. */
export function MyShiftButton({
  shiftId,
  requestId,
  summary,
}: {
  shiftId: string;
  requestId: string | null;
  summary: string;
}) {
  const [state, action] = useActionState(myShiftAction, IDLE);
  useReloadOnSave(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="shiftId" value={shiftId} />
      {requestId ? (
        <input type="hidden" name="requestId" value={requestId} />
      ) : null}
      <input
        type="hidden"
        name="intent"
        value={requestId ? "withdraw" : "request"}
      />
      {state.status === "error" ? <Problem state={state} /> : null}
      <div>
        <Submit
          label={requestId ? "Withdraw request" : "Ask for this shift"}
          variant={requestId ? "secondary" : "primary"}
          size="sm"
        >
          <span className="sr-only">{summary}: </span>
        </Submit>
      </div>
    </form>
  );
}

/** Marks My shifts as seen once shown, so highlights clear next time. */
export function MarkShiftsSeen() {
  useEffect(() => {
    void markShiftsSeenAction();
  }, []);
  return null;
}

// --- M10.3: drops and swaps (managers) ---------------------------------------------------

/** A manager answers a drop or swap request on a shift. */
export function ChangeActions({
  requestId,
  label,
  canApprove,
  summary,
}: {
  requestId: string;
  label: string;
  canApprove: boolean;
  summary: string;
}) {
  const [state, action] = useActionState(changeCommandAction, IDLE);
  const [closedFor, setClosedFor] = useState<RotaFormState | null>(null);
  useReloadOnSave(state);
  const err = state.status === "error" ? state : null;
  const open = !!err?.warnings?.length && closedFor !== state;
  const close = () => setClosedFor(state);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold">{label}</p>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        {canApprove ? (
          <Button size="sm" type="submit" name="decision" value="approve">
            Approve<span className="sr-only"> change to {summary}</span>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          type="submit"
          name="decision"
          value="decline"
        >
          Decline<span className="sr-only"> change to {summary}</span>
        </Button>
      </form>
      {err && !err.warnings?.length ? <Problem state={state} /> : null}
      <Dialog
        open={open}
        onClose={close}
        title="Approve this change?"
        description={summary}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="approve" />
          {err?.warnings?.length ? (
            <Alert
              tone={err.needsReason ? "warning" : "danger"}
              title={
                err.needsReason
                  ? "Check before going ahead"
                  : "This can't be approved"
              }
              role="alert"
            >
              <WarningList warnings={err.warnings} />
            </Alert>
          ) : null}
          {err?.needsReason ? (
            <Field
              id={`change-reason-${requestId}`}
              label="Why is it OK to go ahead?"
              error={err.fieldErrors?.overrideReason}
            >
              <textarea
                id={`change-reason-${requestId}`}
                name="overrideReason"
                required
                maxLength={300}
                rows={2}
                className={textareaClass}
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Back
            </Button>
            {err?.needsReason ? <Submit label="Approve anyway" /> : null}
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// --- M10.3: drops and swaps (staff) ------------------------------------------------------

/** On one of their own shifts: ask to drop or swap, or withdraw the request. */
export function MyChangeControls({
  shiftId,
  summary,
  change,
  colleagues,
}: {
  shiftId: string;
  summary: string;
  change: {
    id: string;
    kind: "drop" | "swap";
    status: "pending" | "accepted";
    to: string | null;
  } | null;
  colleagues: readonly { id: string; name: string }[];
}) {
  const [state, action] = useActionState(myChangeAction, IDLE);
  const [dialog, setDialog] = useState<null | "drop" | "swap">(null);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  if (change)
    return (
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="requestId" value={change.id} />
        <input type="hidden" name="intent" value="withdraw" />
        <p className="text-sm font-semibold text-forest">
          {change.kind === "drop"
            ? "You've asked to drop this shift."
            : change.status === "accepted"
              ? `${change.to} accepted your swap. Waiting for your manager.`
              : `Waiting for ${change.to} to accept your swap.`}
        </p>
        <Submit label="Withdraw" variant="secondary" size="sm">
          <span className="sr-only">{summary}: </span>
        </Submit>
        {state.status === "error" ? <Problem state={state} /> : null}
      </form>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setDialog("drop")}>
        Ask to drop<span className="sr-only"> {summary}</span>
      </Button>
      {colleagues.length ? (
        <Button size="sm" variant="secondary" onClick={() => setDialog("swap")}>
          Ask to swap<span className="sr-only"> {summary}</span>
        </Button>
      ) : null}
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === "swap" ? "Swap this shift?" : "Drop this shift?"}
        description={
          dialog === "swap"
            ? `${summary}. Your colleague accepts first, then your manager decides. You stay on it until then.`
            : `${summary}. Your manager decides. You stay on it until then.`
        }
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="intent" value={dialog ?? ""} />
          {state.status === "error" ? <Problem state={state} /> : null}
          {dialog === "swap" ? (
            <Field
              id={`swap-${shiftId}`}
              label="Colleague"
              error={e.targetEmployeeId}
            >
              <Select
                id={`swap-${shiftId}`}
                name="targetEmployeeId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a colleague
                </option>
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDialog(null)}
            >
              Back
            </Button>
            <Submit label={dialog === "swap" ? "Ask to swap" : "Ask to drop"} />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** A colleague offered them a shift: accept or decline. */
export function SwapOfferButtons({
  requestId,
  summary,
}: {
  requestId: string;
  summary: string;
}) {
  const [state, action] = useActionState(myChangeAction, IDLE);
  useReloadOnSave(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      {state.status === "error" ? <Problem state={state} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" name="intent" value="accept">
          Accept<span className="sr-only"> {summary}</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="submit"
          name="intent"
          value="refuse"
        >
          Decline<span className="sr-only"> {summary}</span>
        </Button>
      </div>
    </form>
  );
}

// --- M10.3: availability (staff) ----------------------------------------------------------

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Add a time they can't work. */
export function UnavailabilityForm() {
  const [state, action] = useActionState(availabilityAction, IDLE);
  const [kind, setKind] = useState<"weekly" | "dates">("weekly");
  const [allDay, setAllDay] = useState(true);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="add" />
      <Problem state={state} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-semibold">When</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="kind"
            value="weekly"
            checked={kind === "weekly"}
            onChange={() => setKind("weekly")}
            className="size-5 accent-[var(--brand-forest)]"
          />
          Every week
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="kind"
            value="dates"
            checked={kind === "dates"}
            onChange={() => setKind("dates")}
            className="size-5 accent-[var(--brand-forest)]"
          />
          Specific dates
        </label>
      </fieldset>
      {kind === "weekly" ? (
        <Field id="unav-weekday" label="Day" error={e.weekday}>
          <Select id="unav-weekday" name="weekday" defaultValue="7">
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="unav-from" label="From" error={e.startsOn}>
            <Input id="unav-from" name="startsOn" type="date" required />
          </Field>
          <Field id="unav-to" label="To (optional)" error={e.endsOn}>
            <Input id="unav-to" name="endsOn" type="date" />
          </Field>
        </div>
      )}
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          onChange={(ev) => setAllDay(ev.currentTarget.checked)}
          className="size-5 accent-[var(--brand-forest)]"
        />
        All day
      </label>
      {allDay ? null : (
        <div className="grid grid-cols-2 gap-3">
          <Field id="unav-start" label="From time" error={e.startTime}>
            <Input id="unav-start" name="startTime" type="time" required />
          </Field>
          <Field id="unav-end" label="Until" error={e.endTime}>
            <Input id="unav-end" name="endTime" type="time" required />
          </Field>
        </div>
      )}
      <Field
        id="unav-note"
        label="Note for your manager (optional)"
        error={e.note}
      >
        <Input
          id="unav-note"
          name="note"
          maxLength={200}
          placeholder="For example: college"
        />
      </Field>
      <div>
        <Submit label="Save" />
      </div>
    </form>
  );
}

export function RemoveUnavailability({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const [state, action] = useActionState(availabilityAction, IDLE);
  useReloadOnSave(state);
  return (
    <form action={action}>
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="id" value={id} />
      <Submit label="Remove" variant="secondary" size="sm">
        <span className="sr-only">{label}: </span>
      </Submit>
    </form>
  );
}
