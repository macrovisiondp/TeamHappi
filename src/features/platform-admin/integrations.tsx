"use client";

import { Power, Send, Wrench } from "lucide-react";
import type * as React from "react";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";

import {
  configureIntegration,
  integrationCommand,
  saveAiControls,
  type ActionState,
} from "./actions";

// Client controls for Platform Admin integrations (M5.3). They only collect
// input: the server decides whether anything is allowed. Field definitions
// arrive as plain props (client code never imports integration modules).

export interface ConfigField {
  name: string;
  label: string;
  type: "text" | "email" | "select" | "list";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
}

const IDLE: ActionState = { status: "idle" };

function Submit({
  label,
  pendingLabel = "Saving…",
  size,
  variant = "primary",
  children,
}: {
  label: string;
  pendingLabel?: string;
  size?: "sm";
  variant?: "primary" | "secondary";
  children?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant={variant} disabled={pending}>
      {children}
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Outcome({
  state,
  returnTo,
}: {
  state: ActionState;
  returnTo: string;
}) {
  if (state.status === "error")
    return (
      <Alert
        tone={state.stepUp ? "warning" : "danger"}
        title={state.message}
        role="alert"
      >
        {state.stepUp ? (
          <a
            href={`/platform/mfa/verify?next=${returnTo}`}
            className="inline-flex min-h-6 items-center font-semibold underline"
          >
            Verify with your authenticator
          </a>
        ) : null}
      </Alert>
    );
  if (state.status === "ok" && state.message)
    return <Alert tone="success" title={state.message} role="status" />;
  return null;
}

/** A full reload after a change, so every card reflects the database. */
function useReloadOnSuccess(state: ActionState) {
  useEffect(() => {
    if (state.status === "ok") {
      const t = window.setTimeout(() => window.location.reload(), 900);
      return () => window.clearTimeout(t);
    }
  }, [state]);
}

export function ProviderControls({
  providerId,
  name,
  fields,
  values,
  active,
  available,
  returnTo,
}: {
  providerId: string;
  name: string;
  fields: readonly ConfigField[];
  values: Record<string, string>;
  active: boolean;
  /** False for planned providers: nothing can be done yet. */
  available: boolean;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [configState, configure] = useActionState(
    async (prev: ActionState, form: FormData) => {
      const result = await configureIntegration(prev, form);
      if (result.status === "ok") setOpen(false);
      return result;
    },
    IDLE,
  );
  const [commandState, command] = useActionState(integrationCommand, IDLE);
  useReloadOnSuccess(configState.status === "ok" ? configState : commandState);

  const unavailable = `${name} isn't available yet`;
  const errors =
    configState.status === "error" ? (configState.fieldErrors ?? {}) : {};
  const latest = commandState.status !== "idle" ? commandState : configState;
  return (
    <div className="flex flex-col gap-3">
      <Outcome
        state={open && configState.status === "error" ? IDLE : latest}
        returnTo={returnTo}
      />
      <div className="flex flex-wrap gap-2">
        {fields.length ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={!available}
            disabledReason={available ? undefined : unavailable}
          >
            <Wrench aria-hidden="true" />
            Configure
            <span className="sr-only"> {name}</span>
          </Button>
        ) : null}
        <form action={command} className="contents">
          <input type="hidden" name="providerId" value={providerId} />
          {available ? (
            <Submit
              label="Test connection"
              pendingLabel="Testing…"
              size="sm"
              variant="secondary"
            >
              <Send aria-hidden="true" />
            </Submit>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled
              disabledReason={unavailable}
            >
              <Send aria-hidden="true" />
              Test connection
            </Button>
          )}
        </form>
        {!active ? (
          <form action={command} className="contents">
            <input type="hidden" name="providerId" value={providerId} />
            <input type="hidden" name="intent" value="activate" />
            {available ? (
              <Submit label="Make active" pendingLabel="Switching…" size="sm">
                <Power aria-hidden="true" />
              </Submit>
            ) : (
              <Button size="sm" disabled disabledReason={unavailable}>
                <Power aria-hidden="true" />
                Make active
              </Button>
            )}
          </form>
        ) : null}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Configure ${name}`}
        description="Settings only. Keys and passwords are never entered here: they are set in the hosting provider's encrypted environment settings."
      >
        <form action={configure} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="providerId" value={providerId} />
          {configState.status === "error" ? (
            <Alert
              tone={configState.stepUp ? "warning" : "danger"}
              title={configState.message}
              role="alert"
            >
              {configState.stepUp ? (
                <a
                  href={`/platform/mfa/verify?next=${returnTo}`}
                  className="inline-flex min-h-6 items-center font-semibold underline"
                >
                  Verify with your authenticator
                </a>
              ) : null}
            </Alert>
          ) : null}
          {fields.map((f) => {
            const id = `${providerId}-${f.name}`;
            const describedBy =
              [f.hint ? `${id}-hint` : "", errors[f.name] ? `${id}-error` : ""]
                .filter(Boolean)
                .join(" ") || undefined;
            return (
              <Field
                key={f.name}
                id={id}
                label={f.required ? f.label : `${f.label} (optional)`}
                hint={f.hint}
                error={errors[f.name]}
              >
                {f.type === "select" ? (
                  <Select
                    id={id}
                    name={f.name}
                    defaultValue={values[f.name] ?? f.options?.[0]?.value}
                    aria-describedby={describedBy}
                    aria-invalid={errors[f.name] ? true : undefined}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={id}
                    name={f.name}
                    type={f.type === "email" ? "email" : "text"}
                    required={f.required}
                    defaultValue={values[f.name] ?? ""}
                    placeholder={f.placeholder}
                    autoComplete="off"
                    aria-describedby={describedBy}
                    aria-invalid={errors[f.name] ? true : undefined}
                  />
                )}
              </Field>
            );
          })}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Submit label="Save settings" />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function AiControlsForm({
  enabled,
  features,
  selected,
  requestLimit,
  tokenLimit,
  spendLimit,
  canManage,
}: {
  enabled: boolean;
  features: readonly { id: string; label: string }[];
  selected: readonly string[];
  requestLimit: number;
  tokenLimit: number;
  /** Pounds, as a decimal string, for example "25.00". */
  spendLimit: string;
  canManage: boolean;
}) {
  const [state, action] = useActionState(saveAiControls, IDLE);
  useReloadOnSuccess(state);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const field = (
    name: string,
    label: string,
    value: string,
    hint?: string,
    errorKey = name,
  ) => (
    <Field id={`ai-${name}`} label={label} hint={hint} error={errors[errorKey]}>
      <Input
        id={`ai-${name}`}
        name={name}
        inputMode="decimal"
        defaultValue={value}
        disabled={!canManage}
        aria-describedby={
          [
            hint ? `ai-${name}-hint` : "",
            errors[errorKey] ? `ai-${name}-error` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        aria-invalid={errors[errorKey] ? true : undefined}
      />
    </Field>
  );
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Outcome state={state} returnTo="/platform/integrations/ai" />
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          name="aiEnabled"
          defaultChecked={enabled}
          disabled={!canManage}
          className="size-5 accent-[var(--brand-forest)]"
        />
        <span className="font-semibold">
          Allow AI requests (turning this off is the kill switch)
        </span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Features</legend>
        {features.map((f) => (
          <label key={f.id} className="flex min-h-6 items-center gap-3">
            <input
              type="checkbox"
              name="features"
              value={f.id}
              defaultChecked={selected.includes(f.id)}
              disabled={!canManage}
              className="size-5 accent-[var(--brand-forest)]"
            />
            <span className="text-sm">{f.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        {field("requestLimit", "Requests per month", String(requestLimit))}
        {field("tokenLimit", "Tokens per month", String(tokenLimit))}
        {field(
          "spendLimit",
          "Spend cap per month (£)",
          spendLimit,
          "0 means no AI spend is allowed.",
          "spendLimitPence",
        )}
      </div>
      {canManage ? (
        <Submit label="Save AI controls" />
      ) : (
        <p className="text-sm text-ink-muted">
          Changing AI controls needs the “Manage integrations” permission.
        </p>
      )}
    </form>
  );
}
