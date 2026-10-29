"use client";

import { Ban, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { IDLE, type FormState } from "@/features/setup/form-state";

import {
  saveTrainingCourse,
  trainingCourseCommand,
  trainingRecordCommand,
} from "./actions";
import { CATEGORY_LABEL } from "./labels";

// Training controls (M8.1). They collect input only; the training module
// decides on the server what is allowed and checks every value again.

interface Option {
  id: string;
  name: string;
}

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(
  ([value, label]) => ({ value, label }),
);

// --- Courses ---------------------------------------------------------------------------

export function CourseForm({
  course,
}: {
  course?: {
    id: string;
    name: string;
    description: string | null;
    category: string;
    kind: "internal" | "external";
    completionMethod: "read_and_confirm" | "in_person" | "external_certificate";
    certificateExpected: boolean;
    validityMonths: number | null;
    warnDays: number;
    content: string | null;
    contentVersion: number;
  };
}) {
  const [kind, setKind] = useState(course?.kind ?? "internal");
  const [method, setMethod] = useState(course?.completionMethod ?? "in_person");
  const effective = kind === "external" ? "external_certificate" : method;
  return (
    <SetupForm
      action={saveTrainingCourse}
      submitLabel={course ? "Save course" : "Create course"}
      hidden={course ? { id: course.id } : undefined}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            name="name"
            label="Course name"
            defaultValue={course?.name}
            error={e.name}
            required
          />
          <SelectField
            name="category"
            label="Category"
            options={CATEGORY_OPTIONS}
            defaultValue={course?.category ?? "other"}
            error={e.category}
            required
          />
          {course ? (
            <p className="text-sm md:col-span-2">
              {course.kind === "external"
                ? "External course, recorded with a certificate."
                : course.completionMethod === "read_and_confirm"
                  ? "Internal course, read and confirmed."
                  : "Internal course, given in person."}{" "}
              <span className="text-ink-muted">
                The type can&rsquo;t change once a course exists.
              </span>
            </p>
          ) : (
            <>
              <Field id="field-kind" label="Type" error={e.kind}>
                <Select
                  id="field-kind"
                  name="kind"
                  value={kind}
                  onChange={(ev) => setKind(ev.target.value as typeof kind)}
                >
                  <option value="internal">Internal (your own training)</option>
                  <option value="external">
                    External (a provider&rsquo;s course or qualification)
                  </option>
                </Select>
              </Field>
              {kind === "internal" ? (
                <Field
                  id="field-completionMethod"
                  label="How it's completed"
                  error={e.completionMethod}
                >
                  <Select
                    id="field-completionMethod"
                    name="completionMethod"
                    value={method}
                    onChange={(ev) =>
                      setMethod(ev.target.value as typeof method)
                    }
                  >
                    <option value="in_person">
                      Given in person (a manager records it)
                    </option>
                    <option value="read_and_confirm">
                      Read and confirm (from M8.2, staff confirm themselves)
                    </option>
                  </Select>
                </Field>
              ) : (
                <input
                  type="hidden"
                  name="completionMethod"
                  value="external_certificate"
                />
              )}
            </>
          )}
          <Field
            id="field-validityMonths"
            label="Valid for (months, optional)"
            hint="Leave blank if it doesn't need renewing."
            error={e.validityMonths}
          >
            <Input
              id="field-validityMonths"
              name="validityMonths"
              type="number"
              min={1}
              max={120}
              step={1}
              defaultValue={
                course?.validityMonths ? String(course.validityMonths) : ""
              }
              aria-describedby="field-validityMonths-hint"
            />
          </Field>
          <Field
            id="field-warnDays"
            label="Warn before expiry (days)"
            error={e.warnDays}
          >
            <Input
              id="field-warnDays"
              name="warnDays"
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue={String(course?.warnDays ?? 60)}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-3 md:col-span-2">
            <input
              type="checkbox"
              name="certificateExpected"
              defaultChecked={
                course?.certificateExpected ?? kind === "external"
              }
              className="size-5 accent-[var(--brand-forest)]"
            />
            <span className="text-sm font-semibold">
              A certificate is expected
            </span>
          </label>
          <Field
            id="field-description"
            label="Description (optional)"
            error={e.description}
            className="md:col-span-2"
          >
            <textarea
              id="field-description"
              name="description"
              defaultValue={course?.description ?? ""}
              maxLength={1000}
              rows={2}
              className={textareaClass}
            />
          </Field>
          {effective === "read_and_confirm" ? (
            <Field
              id="field-content"
              label={`Content people read and confirm${course ? ` (version ${course.contentVersion})` : ""}`}
              hint="Changing it makes a new version. Earlier confirmations keep the version they confirmed. Confirming isn't an exam or a qualification."
              error={e.content}
              className="md:col-span-2"
            >
              <textarea
                id="field-content"
                name="content"
                defaultValue={course?.content ?? ""}
                maxLength={20000}
                rows={8}
                aria-describedby="field-content-hint"
                className={textareaClass}
              />
            </Field>
          ) : null}
        </div>
      )}
    </SetupForm>
  );
}

/** One-button course commands (add suggested, archive, remove a rule). */
export function CourseCommand({
  courseId = "",
  ruleId,
  intent,
  label,
  confirm,
  variant = "secondary",
}: {
  courseId?: string;
  ruleId?: string;
  intent: "add-suggested" | "archive" | "remove-rule";
  label: string;
  confirm?: { title: string; description: string };
  variant?: "primary" | "secondary" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, action] = useActionState(
    async (prev: FormState, form: FormData) => {
      const r = await trainingCourseCommand(prev, form);
      if (r.status === "saved") setOpen(false);
      return r;
    },
    IDLE,
  );
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
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="intent" value={intent} />
      {ruleId ? <input type="hidden" name="ruleId" value={ruleId} /> : null}
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
      {state.status === "saved" && !state.href ? (
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

// --- Rules -------------------------------------------------------------------------------

export function AddRuleForm({
  courseId,
  sites,
  people,
}: {
  courseId: string;
  sites: readonly Option[];
  people: readonly Option[];
}) {
  const [scope, setScope] = useState("organisation");
  return (
    <SetupForm
      action={trainingCourseCommand}
      submitLabel="Add rule"
      hidden={{ courseId, intent: "add-rule" }}
    >
      {(e) => (
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="field-scope" label="Applies to" error={e.scope}>
            <Select
              id="field-scope"
              name="scope"
              value={scope}
              onChange={(ev) => setScope(ev.target.value)}
            >
              <option value="organisation">Everyone</option>
              <option value="site">Everyone at one site</option>
              <option value="job_title">Everyone with a job title</option>
              <option value="employee">One named person</option>
            </Select>
          </Field>
          {scope === "site" ? (
            <SelectField
              name="siteId"
              label="Site"
              options={sites.map((s) => ({ value: s.id, label: s.name }))}
              error={e.siteId}
              placeholder="Choose a site"
              required
            />
          ) : scope === "job_title" ? (
            <TextField
              name="jobTitle"
              label="Job title"
              error={e.jobTitle}
              hint="Matched to the job title on each person's record, ignoring capitals."
              required
            />
          ) : scope === "employee" ? (
            <SelectField
              name="employeeId"
              label="Person"
              options={people.map((p) => ({ value: p.id, label: p.name }))}
              error={e.employeeId}
              placeholder="Choose a person"
              required
            />
          ) : (
            <div />
          )}
          <SelectField
            name="mandatory"
            label="Requirement"
            options={[
              { value: "mandatory", label: "Mandatory (your business rule)" },
              { value: "recommended", label: "Recommended" },
            ]}
            defaultValue="mandatory"
            required
          />
          <Field
            id="field-dueDays"
            label="Due within (days)"
            hint="After their start date, or after today for people already working."
            error={e.dueDays}
          >
            <Input
              id="field-dueDays"
              name="dueDays"
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue="14"
              aria-describedby="field-dueDays-hint"
            />
          </Field>
        </div>
      )}
    </SetupForm>
  );
}

export function EditRule({
  courseId,
  rule,
}: {
  courseId: string;
  rule: { id: string; target: string; mandatory: boolean; dueDays: number };
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(trainingCourseCommand, IDLE);
  useReload(state);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <PencilLine aria-hidden="true" />
        Edit<span className="sr-only"> rule for {rule.target}</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit rule: ${rule.target}`}
        description="To change who it applies to, remove it and add a new rule."
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="ruleId" value={rule.id} />
          <input type="hidden" name="intent" value="edit-rule" />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          <Field id={`mandatory-${rule.id}`} label="Requirement">
            <Select
              id={`mandatory-${rule.id}`}
              name="mandatory"
              defaultValue={rule.mandatory ? "mandatory" : "recommended"}
            >
              <option value="mandatory">Mandatory (your business rule)</option>
              <option value="recommended">Recommended</option>
            </Select>
          </Field>
          <Field id={`due-${rule.id}`} label="Due within (days)">
            <Input
              id={`due-${rule.id}`}
              name="dueDays"
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue={String(rule.dueDays)}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Submit label="Save rule" />
          </div>
        </form>
      </Dialog>
    </>
  );
}

// --- Records -------------------------------------------------------------------------------

function RecordFields({
  e,
  courses,
  fixedCourse,
  prefix = "field",
  defaults = {},
}: {
  e: Record<string, string>;
  courses: readonly (Option & { kind: "internal" | "external" })[];
  fixedCourse?: Option & { kind: "internal" | "external" };
  /** Ids must be unique on the page (the correction dialog sits beside the form). */
  prefix?: string;
  /** Starting values (a correction starts from the record it corrects). */
  defaults?: Partial<
    Record<
      "completedOn" | "expiresOn" | "provider" | "reference",
      string | null
    >
  >;
}) {
  const [courseId, setCourseId] = useState(fixedCourse?.id ?? "");
  const course = fixedCourse ?? courses.find((c) => c.id === courseId);
  const field = (
    name: string,
    label: string,
    opts: { type?: string; hint?: string; required?: boolean } = {},
  ) => {
    const id = `${prefix}-${name}`;
    const initial = defaults[name as keyof typeof defaults] ?? "";
    return (
      <Field
        id={id}
        label={opts.required ? label : `${label} (optional)`}
        hint={opts.hint}
        error={e[name]}
      >
        <Input
          id={id}
          name={name}
          type={opts.type ?? "text"}
          defaultValue={initial}
          required={opts.required}
          autoComplete="off"
          aria-invalid={e[name] ? true : undefined}
          aria-describedby={
            [opts.hint ? `${id}-hint` : "", e[name] ? `${id}-error` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
      </Field>
    );
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {fixedCourse ? (
        <input type="hidden" name="courseId" value={fixedCourse.id} />
      ) : (
        <Field id={`${prefix}-courseId`} label="Course" error={e.courseId}>
          <Select
            id={`${prefix}-courseId`}
            name="courseId"
            value={courseId}
            onChange={(ev) => setCourseId(ev.target.value)}
            required
          >
            <option value="">Choose a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {field("completedOn", "Completed on", { type: "date", required: true })}
      {field("expiresOn", "Expires on", {
        type: "date",
        hint: "From the certificate. Leave blank to work it out from the course.",
      })}
      {course?.kind !== "internal" ? (
        <>
          {field("provider", "Training provider")}
          {field("reference", "Certificate reference", {
            hint: "Only a certificate number. Never ID, passport or National Insurance numbers.",
          })}
        </>
      ) : null}
    </div>
  );
}

export function RecordTrainingForm({
  employeeId,
  courses,
}: {
  employeeId: string;
  courses: readonly (Option & { kind: "internal" | "external" })[];
}) {
  return (
    <SetupForm
      action={trainingRecordCommand}
      submitLabel="Record training"
      hidden={{ employeeId, intent: "record" }}
    >
      {(e) => <RecordFields e={e} courses={courses} />}
    </SetupForm>
  );
}

type RecordDialog = null | "correct" | "void";

export function RecordActions({
  employeeId,
  record,
}: {
  employeeId: string;
  record: {
    id: string;
    courseId: string;
    courseName: string;
    kind: "internal" | "external";
    completedOn: string;
    expiresOn: string | null;
    provider: string | null;
    reference: string | null;
  };
}) {
  const [open, setOpen] = useState<RecordDialog>(null);
  const [state, action] = useActionState(trainingRecordCommand, IDLE);
  useReload(state);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setOpen("correct")}>
        <PencilLine aria-hidden="true" />
        Correct<span className="sr-only"> {record.courseName} record</span>
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen("void")}>
        <Ban aria-hidden="true" />
        Void<span className="sr-only"> {record.courseName} record</span>
      </Button>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          open === "correct"
            ? `Correct ${record.courseName}`
            : `Void ${record.courseName}`
        }
        description={
          open === "correct"
            ? "The current record is marked void with your reason, and the corrected one replaces it. Both stay in the history."
            : "Use this if it was recorded by mistake. It stays in the history, marked void, and no longer counts."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="intent" value={open ?? ""} />
          {open === "correct" ? (
            <input type="hidden" name="replacesId" value={record.id} />
          ) : (
            <input type="hidden" name="recordId" value={record.id} />
          )}
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          <Field
            id={`reason-${record.id}`}
            label="What was wrong (recorded)"
            error={errors.voidReason ?? errors.reason}
          >
            <textarea
              id={`reason-${record.id}`}
              name={open === "correct" ? "voidReason" : "reason"}
              required
              minLength={3}
              maxLength={500}
              rows={2}
              className={textareaClass}
            />
          </Field>
          {open === "correct" ? (
            <RecordFields
              e={errors}
              courses={[]}
              fixedCourse={{
                id: record.courseId,
                name: record.courseName,
                kind: record.kind,
              }}
              prefix={`fix-${record.id}`}
              defaults={record}
            />
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(null)}
            >
              Cancel
            </Button>
            <Submit
              label={open === "correct" ? "Save correction" : "Void record"}
              variant={open === "void" ? "danger" : "primary"}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}
