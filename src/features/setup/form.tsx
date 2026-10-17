"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";

import { IDLE, type FormState } from "./form-state";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/**
 * A setup form: server action + accessible feedback. Errors show as a summary
 * (focused, linked to fields) and next to each field; success is announced and,
 * for new records, moves to the record's page.
 */
export function SetupForm({
  action,
  children,
  submitLabel,
  hidden,
}: {
  action: Action;
  children: (errors: Record<string, string>) => ReactNode;
  submitLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const router = useRouter();
  const summaryRef = useRef<HTMLDivElement>(null);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  useEffect(() => {
    if (state.status === "error") summaryRef.current?.focus();
    if (state.status === "saved") {
      if (state.href) router.push(state.href as never);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {state.status === "error" ? (
          <Alert tone="danger" title="There's a problem" role="alert">
            <p>{state.message}</p>
            {Object.keys(errors).length ? (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field}>
                    <a
                      href={`#field-${field}`}
                      className="inline-flex min-h-6 items-center py-0.5 underline"
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        {state.status === "saved" ? (
          <Alert tone="success" title={state.message} role="status" />
        ) : null}
      </div>
      {children(errors)}
      <div className="flex flex-wrap gap-3">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

const describedBy = (name: string, hint?: string, error?: string) =>
  [hint ? `field-${name}-hint` : null, error ? `field-${name}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;

export function TextField({
  name,
  label,
  defaultValue,
  error,
  hint,
  required,
  type = "text",
  autoComplete = "off",
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  error?: string;
  hint?: string;
  required?: boolean;
  type?: "text" | "email" | "tel" | "date";
  autoComplete?: string;
  className?: string;
}) {
  const id = `field-${name}`;
  return (
    <Field
      id={id}
      label={required ? label : `${label} (optional)`}
      hint={hint}
      error={error}
      className={className}
    >
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, hint, error)}
      />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  error,
  hint,
  required,
  placeholder,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const id = `field-${name}`;
  return (
    <Field
      id={id}
      label={required ? label : `${label} (optional)`}
      hint={hint}
      error={error}
    >
      <Select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, hint, error)}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Checkbox group submitted as repeated `name` values. */
export function CheckboxGroup({
  name,
  legend,
  options,
  defaultValues,
  error,
  hint,
}: {
  name: string;
  legend: string;
  options: readonly { value: string; label: string; detail?: string }[];
  defaultValues: readonly string[];
  error?: string;
  hint?: string;
}) {
  return (
    <fieldset
      id={`field-${name}`}
      tabIndex={-1}
      className="flex flex-col gap-2 outline-none"
      aria-describedby={describedBy(name, hint, error)}
    >
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {hint ? (
        <p id={`field-${name}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {options.length === 0 ? (
        <p className="text-sm text-ink-muted">No teams available yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <li key={o.value}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-line px-3 py-2 hover:bg-sage">
                <input
                  type="checkbox"
                  name={name}
                  value={o.value}
                  defaultChecked={defaultValues.includes(o.value)}
                  className="size-5 accent-[var(--brand-forest)]"
                />
                <span className="text-sm">
                  {o.label}
                  {o.detail ? (
                    <span className="block text-xs text-ink-muted">
                      {o.detail}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p
          id={`field-${name}-error`}
          role="alert"
          className="text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Deactivate / reactivate with a confirmation dialog. Deactivating keeps all
 * history; nothing is deleted.
 */
export function StatusChange({
  action,
  id,
  nextStatus,
  label,
  confirmTitle,
  confirmText,
}: {
  action: Action;
  id: string;
  nextStatus: "archived" | "active";
  label: string;
  confirmTitle: string;
  confirmText: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, formAction] = useActionState(
    async (prev: FormState, form: FormData) => {
      const result = await action(prev, form);
      if (result.status === "saved") {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    IDLE,
  );

  return (
    <>
      <Button
        type="button"
        variant={nextStatus === "archived" ? "danger" : "secondary"}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {state.status === "error" ? (
        <Alert tone="danger" title="That didn't work" role="alert">
          {state.message}
        </Alert>
      ) : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        description={confirmText}
      >
        <form action={formAction} className="flex flex-wrap justify-end gap-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={nextStatus} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <SubmitButton label={label} />
        </form>
      </Dialog>
    </>
  );
}
