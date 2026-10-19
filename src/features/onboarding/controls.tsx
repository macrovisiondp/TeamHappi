"use client";

import { Check, RotateCcw, ShieldAlert, UserCog } from "lucide-react";
import type * as React from "react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { SelectField, SetupForm, TextField } from "@/features/setup/form";
import { IDLE, type FormState } from "@/features/setup/form-state";

import {
  onboardingCaseCommand,
  onboardingTaskCommand,
  onboardingTemplateCommand,
  saveOnboardingTemplate,
  startOnboarding,
} from "./actions";

// Onboarding controls (M7.1). They collect input only; the onboarding module
// decides on the server what is allowed.

interface Option {
  id: string;
  name: string;
}

function Submit({
  label,
  variant = "primary",
  size,
  children,
}: {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm";
  children?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {children}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function ErrorAlert({ state }: { state: FormState }) {
  return state.status === "error" ? (
    <Alert tone="danger" title={state.message} role="alert">
      {state.fieldErrors ? (
        <ul className="list-disc pl-5">
          {Object.values(state.fieldErrors).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  ) : null;
}

/** Full reload after a change, so progress, badges and history all agree. */
function useReload(state: FormState) {
  useEffect(() => {
    if (state.status === "saved") window.location.reload();
  }, [state]);
}

const textareaClass =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-base";

// --- Starting onboarding ------------------------------------------------------------

export function StartOnboardingForm({
  employees,
  templates,
  members,
  selfMembershipId,
  preselect,
}: {
  employees: readonly {
    id: string;
    name: string;
    jobTitle: string | null;
    siteName: string | null;
    startDate: string | null;
    suggestedTemplateIds: readonly string[];
  }[];
  templates: readonly { id: string; name: string }[];
  members: readonly Option[];
  selfMembershipId: string;
  preselect?: string;
}) {
  const initial = employees.find((e) => e.id === preselect) ?? employees[0];
  const [employeeId, setEmployeeId] = useState(initial?.id ?? "");
  const employee = employees.find((e) => e.id === employeeId);
  const suggested = templates.filter((t) =>
    employee?.suggestedTemplateIds.includes(t.id),
  );
  const [templateId, setTemplateId] = useState(
    suggested[0]?.id ?? templates[0]?.id ?? "",
  );
  return (
    <SetupForm action={startOnboarding} submitLabel="Start onboarding">
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="field-employeeId" label="Person" error={e.employeeId}>
            <Select
              id="field-employeeId"
              name="employeeId"
              value={employeeId}
              onChange={(ev) => {
                setEmployeeId(ev.target.value);
                const next = employees.find((x) => x.id === ev.target.value);
                const first = templates.find((t) =>
                  next?.suggestedTemplateIds.includes(t.id),
                );
                if (first) setTemplateId(first.id);
              }}
              aria-invalid={e.employeeId ? true : undefined}
            >
              {employees.map((x) => (
                <option key={x.id} value={x.id}>
                  {[x.name, x.jobTitle, x.siteName].filter(Boolean).join(" · ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="field-templateId"
            label="Template"
            hint={
              suggested.length
                ? `Suits this person: ${suggested.map((t) => t.name).join(", ")}`
                : "No template is set up for this person's site or job title; choose any."
            }
            error={e.templateId}
          >
            <Select
              id="field-templateId"
              name="templateId"
              value={templateId}
              onChange={(ev) => setTemplateId(ev.target.value)}
              aria-describedby="field-templateId-hint"
              aria-invalid={e.templateId ? true : undefined}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <TextField
            key={employeeId}
            name="startDate"
            label="Start date"
            type="date"
            defaultValue={employee?.startDate ?? undefined}
            error={e.startDate}
            hint="Due dates are worked out from this."
            required
          />
          <SelectField
            name="ownerMembershipId"
            label="Onboarding owner"
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            defaultValue={selfMembershipId}
            error={e.ownerMembershipId}
            hint="Manager tasks are assigned to them."
            required
          />
        </div>
      )}
    </SetupForm>
  );
}

// --- Tasks ----------------------------------------------------------------------------

type TaskDialog = null | "waive" | "assign";

export function TaskActions({
  caseId,
  taskId,
  title,
  status,
  required,
  canWaiveRequired,
  assigneeMembershipId,
  dueOn,
  members,
  forEmployee,
}: {
  caseId: string;
  taskId: string;
  title: string;
  status: "to_do" | "done" | "waived";
  required: boolean;
  canWaiveRequired: boolean;
  assigneeMembershipId: string | null;
  dueOn: string | null;
  members: readonly Option[];
  forEmployee: boolean;
}) {
  const [open, setOpen] = useState<TaskDialog>(null);
  const [state, action] = useActionState(onboardingTaskCommand, IDLE);
  useReload(state);
  const hidden = (
    <>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="taskId" value={taskId} />
    </>
  );
  const canWaive = !required || canWaiveRequired;
  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" && !open ? <ErrorAlert state={state} /> : null}
      <div className="flex flex-wrap gap-2">
        {status === "to_do" ? (
          <>
            <form action={action}>
              {hidden}
              <input type="hidden" name="intent" value="complete" />
              <Submit
                label={forEmployee ? "Done on their behalf" : "Mark done"}
                size="sm"
              >
                <Check aria-hidden="true" />
              </Submit>
            </form>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setOpen("assign")}
            >
              <UserCog aria-hidden="true" />
              Reassign<span className="sr-only"> {title}</span>
            </Button>
            {canWaive ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setOpen("waive")}
              >
                <ShieldAlert aria-hidden="true" />
                Exception<span className="sr-only"> for {title}</span>
              </Button>
            ) : null}
          </>
        ) : status === "done" || canWaive ? (
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
          open === "waive"
            ? `Make an exception: ${title}`
            : `Reassign: ${title}`
        }
        description={
          open === "waive"
            ? required
              ? "This is a required task. The exception and your reason are recorded, and it counts as finished for readiness. It doesn't affect right to work."
              : "Mark this optional task as not needed. Your reason is recorded."
            : "Choose who does it and when it's due."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          {hidden}
          <input type="hidden" name="intent" value={open ?? ""} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          {open === "waive" ? (
            <Field
              id={`reason-${taskId}`}
              label="Reason (recorded)"
              hint="Don't include personal or health details."
            >
              <textarea
                id={`reason-${taskId}`}
                name="reason"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                aria-describedby={`reason-${taskId}-hint`}
                className={textareaClass}
              />
            </Field>
          ) : (
            <>
              <Field id={`assignee-${taskId}`} label="Assigned to">
                <Select
                  id={`assignee-${taskId}`}
                  name="assigneeMembershipId"
                  defaultValue={assigneeMembershipId ?? ""}
                >
                  <option value="">
                    {forEmployee ? "The employee" : "Not assigned"}
                  </option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`due-${taskId}`} label="Due date (optional)">
                <Input
                  id={`due-${taskId}`}
                  name="dueOn"
                  type="date"
                  defaultValue={dueOn ?? ""}
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
            <Submit label={open === "waive" ? "Record exception" : "Save"} />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// --- Case: sign-off, cancel, owner ------------------------------------------------------

type CaseDialog = null | "signoff" | "cancel" | "owner";

export function CaseActions({
  caseId,
  name,
  canManage,
  canSignOff,
  signOffBlockedReason,
  ownerMembershipId,
  members,
}: {
  caseId: string;
  name: string;
  canManage: boolean;
  canSignOff: boolean;
  signOffBlockedReason: string | null;
  ownerMembershipId: string | null;
  members: readonly Option[];
}) {
  const [open, setOpen] = useState<CaseDialog>(null);
  const [state, action] = useActionState(onboardingCaseCommand, IDLE);
  useReload(state);
  return (
    <div className="flex flex-col gap-3">
      {state.status === "error" && !open ? <ErrorAlert state={state} /> : null}
      <div className="flex flex-wrap gap-2">
        {signOffBlockedReason !== null || canSignOff ? (
          <Button
            onClick={() => setOpen("signoff")}
            disabled={!canSignOff}
            disabledReason={signOffBlockedReason ?? undefined}
          >
            Give final sign-off
          </Button>
        ) : null}
        {canManage ? (
          <>
            <Button variant="secondary" onClick={() => setOpen("owner")}>
              Change owner
            </Button>
            <Button variant="secondary" onClick={() => setOpen("cancel")}>
              Cancel onboarding
            </Button>
          </>
        ) : null}
      </div>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          open === "signoff"
            ? `Sign off ${name}'s onboarding?`
            : open === "cancel"
              ? `Cancel ${name}'s onboarding?`
              : "Change the onboarding owner"
        }
        description={
          open === "signoff"
            ? "Your sign-off confirms the onboarding checklist is complete. It is recorded with your name and the time. It does not confirm right to work, which is recorded separately."
            : open === "cancel"
              ? "Use this if they aren't starting after all. The record and its history are kept."
              : undefined
        }
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="intent" value={open ?? ""} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          {open === "signoff" ? (
            <Field
              id="signoff-note"
              label="Note (optional)"
              hint="Don't include personal or health details."
            >
              <textarea
                id="signoff-note"
                name="note"
                maxLength={500}
                rows={3}
                aria-describedby="signoff-note-hint"
                className={textareaClass}
              />
            </Field>
          ) : open === "cancel" ? (
            <Field id="cancel-reason" label="Reason (recorded)">
              <textarea
                id="cancel-reason"
                name="reason"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                className={textareaClass}
              />
            </Field>
          ) : (
            <Field id="case-owner" label="Owner">
              <Select
                id="case-owner"
                name="ownerMembershipId"
                defaultValue={ownerMembershipId ?? ""}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
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
                open === "signoff"
                  ? "Sign off"
                  : open === "cancel"
                    ? "Cancel onboarding"
                    : "Save"
              }
              variant={open === "cancel" ? "danger" : "primary"}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// --- Templates ----------------------------------------------------------------------------

export function TemplateForm({
  template,
  sites,
}: {
  template?: {
    id: string;
    name: string;
    description: string | null;
    scope: "organisation" | "site" | "job_title";
    siteId: string | null;
    jobTitle: string | null;
  };
  sites: readonly Option[];
}) {
  const [scope, setScope] = useState(template?.scope ?? "organisation");
  return (
    <SetupForm
      action={saveOnboardingTemplate}
      submitLabel={template ? "Save template" : "Create template"}
      hidden={template ? { id: template.id } : undefined}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="name"
            label="Template name"
            defaultValue={template?.name}
            error={e.name}
            required
          />
          <Field id="field-scope" label="Use for" error={e.scope}>
            <Select
              id="field-scope"
              name="scope"
              value={scope}
              onChange={(ev) => setScope(ev.target.value as typeof scope)}
            >
              <option value="organisation">Anyone in the organisation</option>
              <option value="site">People at one site</option>
              <option value="job_title">People with a job title</option>
            </Select>
          </Field>
          {scope === "site" ? (
            <SelectField
              name="siteId"
              label="Site"
              options={sites.map((s) => ({ value: s.id, label: s.name }))}
              defaultValue={template?.siteId}
              error={e.siteId}
              placeholder="Choose a site"
              required
            />
          ) : null}
          {scope === "job_title" ? (
            <TextField
              name="jobTitle"
              label="Job title"
              defaultValue={template?.jobTitle}
              error={e.jobTitle}
              hint="Matched to the job title on the person's record, ignoring capitals."
              required
            />
          ) : null}
          <Field
            id="field-description"
            label="Description (optional)"
            error={e.description}
            className="md:col-span-2"
          >
            <textarea
              id="field-description"
              name="description"
              defaultValue={template?.description ?? ""}
              maxLength={1000}
              rows={2}
              className={textareaClass}
            />
          </Field>
        </div>
      )}
    </SetupForm>
  );
}

const CATEGORY_OPTIONS = [
  { value: "task", label: "Task" },
  { value: "document", label: "Document" },
  { value: "induction", label: "Induction" },
  { value: "policy", label: "Policy" },
];
const OWNER_OPTIONS = [
  { value: "manager", label: "Manager" },
  { value: "hr", label: "HR" },
  { value: "employee", label: "The employee" },
];

export function TemplateTaskForm({
  templateId,
  task,
}: {
  templateId: string;
  task?: {
    id: string;
    title: string;
    guidance: string | null;
    category: string;
    ownerKind: string;
    dueOffsetDays: number;
    required: boolean;
  };
}) {
  const key = task?.id ?? "new";
  return (
    <SetupForm
      action={onboardingTemplateCommand}
      submitLabel={task ? "Save task" : "Add task"}
      hidden={{
        templateId,
        intent: "save-task",
        ...(task ? { taskId: task.id } : {}),
      }}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="title"
            label="Task"
            defaultValue={task?.title}
            error={e.title}
            required
            className="md:col-span-2"
          />
          <SelectField
            name="category"
            label="Type"
            options={CATEGORY_OPTIONS}
            defaultValue={task?.category ?? "task"}
            error={e.category}
            required
          />
          <SelectField
            name="ownerKind"
            label="Who does it"
            options={OWNER_OPTIONS}
            defaultValue={task?.ownerKind ?? "manager"}
            error={e.ownerKind}
            required
          />
          <Field
            id={`field-dueOffsetDays-${key}`}
            label="Due (days from the start date)"
            hint="0 = the first day; -3 = three days before."
            error={e.dueOffsetDays}
          >
            <Input
              id={`field-dueOffsetDays-${key}`}
              name="dueOffsetDays"
              type="number"
              min={-90}
              max={365}
              step={1}
              defaultValue={String(task?.dueOffsetDays ?? 0)}
              aria-describedby={`field-dueOffsetDays-${key}-hint`}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 self-end">
            <input
              type="checkbox"
              name="required"
              defaultChecked={task?.required ?? true}
              className="size-5 accent-[var(--brand-forest)]"
            />
            <span className="text-sm font-semibold">
              Required before final sign-off
            </span>
          </label>
          <Field
            id={`field-guidance-${key}`}
            label="Guidance (optional)"
            error={e.guidance}
            className="md:col-span-2"
          >
            <textarea
              id={`field-guidance-${key}`}
              name="guidance"
              defaultValue={task?.guidance ?? ""}
              maxLength={2000}
              rows={2}
              className={textareaClass}
            />
          </Field>
        </div>
      )}
    </SetupForm>
  );
}

/** Small one-button template commands (remove a task, archive, add suggested). */
export function TemplateCommand({
  templateId = "",
  taskId,
  intent,
  label,
  confirm,
  variant = "secondary",
}: {
  templateId?: string;
  taskId?: string;
  intent: "remove-task" | "archive" | "add-suggested";
  label: string;
  confirm?: { title: string; description: string };
  variant?: "primary" | "secondary" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, action] = useActionState(
    async (prev: FormState, form: FormData) => {
      const r = await onboardingTemplateCommand(prev, form);
      if (r.status === "saved") setOpen(false);
      return r;
    },
    IDLE,
  );
  // Refresh in place, so the confirmation stays visible.
  useEffect(() => {
    if (state.status === "saved") {
      if (state.href) router.push(state.href as never);
      else router.refresh();
    }
  }, [state, router]);
  const form = (
    <form
      action={action}
      className={confirm ? "flex flex-wrap justify-end gap-3" : undefined}
    >
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="intent" value={intent} />
      {taskId ? <input type="hidden" name="taskId" value={taskId} /> : null}
      {confirm ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen(false)}
        >
          Back
        </Button>
      ) : null}
      <Submit
        label={label}
        variant={variant}
        size={confirm ? undefined : "sm"}
      />
    </form>
  );
  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" ? <ErrorAlert state={state} /> : null}
      {state.status === "saved" ? (
        <Alert tone="success" title={state.message} role="status" />
      ) : null}
      {confirm ? (
        <>
          <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
            {label}
          </Button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title={confirm.title}
            description={confirm.description}
          >
            {form}
          </Dialog>
        </>
      ) : (
        form
      )}
    </div>
  );
}
