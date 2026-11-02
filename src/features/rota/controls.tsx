"use client";

import { AlertTriangle, Ban, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Submit, textareaClass } from "@/features/onboarding/controls";

import {
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
