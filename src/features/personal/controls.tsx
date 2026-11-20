"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";

import { FormError } from "@/components/ui/form-error";
import { reloadWithNote } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Submit } from "@/features/onboarding/controls";

import {
  revealAction,
  saveAboutAction,
  saveBankAction,
  type PersonalFormState,
  type RevealState,
} from "./actions";

// Personal and bank details (M14.2). These collect input only; the personal
// module decides on the server. Sensitive numbers are never sent to the page
// unless someone presses Reveal, which is audited.

const IDLE: PersonalFormState = { status: "idle" };

function useReloadOnSave(state: PersonalFormState) {
  useEffect(() => {
    if (state.status === "saved") reloadWithNote(state.message);
  }, [state]);
}

function Problem({ state }: { state: PersonalFormState }) {
  if (state.status !== "error") return null;
  return (
    <FormError
      message={state.message}
      details={Object.values(state.fieldErrors ?? {})}
    />
  );
}

export interface AboutValues {
  line1: string | null;
  line2: string | null;
  town: string | null;
  postcode: string | null;
  dateOfBirth: string | null;
  emergencyName: string | null;
  emergencyRelationship: string | null;
  emergencyPhone: string | null;
  niLast4: string | null;
}

export function AboutForm({
  employeeId,
  values,
  sensitiveOn,
}: {
  employeeId: string;
  values: AboutValues;
  sensitiveOn: boolean;
}) {
  const id = useId();
  const [state, action] = useActionState(saveAboutAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const f = (name: string) => `${name}-${id}`;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <Problem state={state} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Home address</legend>
        <Field id={f("a1")} label="Address line 1" error={e.addressLine1}>
          <Input
            id={f("a1")}
            name="addressLine1"
            maxLength={100}
            autoComplete="address-line1"
            defaultValue={values.line1 ?? ""}
          />
        </Field>
        <Field
          id={f("a2")}
          label="Address line 2 (optional)"
          error={e.addressLine2}
        >
          <Input
            id={f("a2")}
            name="addressLine2"
            maxLength={100}
            autoComplete="address-line2"
            defaultValue={values.line2 ?? ""}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={f("town")} label="Town or city" error={e.town}>
            <Input
              id={f("town")}
              name="town"
              maxLength={60}
              autoComplete="address-level2"
              defaultValue={values.town ?? ""}
            />
          </Field>
          <Field id={f("pc")} label="Postcode" error={e.postcode}>
            <Input
              id={f("pc")}
              name="postcode"
              maxLength={10}
              autoComplete="postal-code"
              defaultValue={values.postcode ?? ""}
            />
          </Field>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={f("dob")} label="Date of birth" error={e.dateOfBirth}>
          <Input
            id={f("dob")}
            name="dateOfBirth"
            type="date"
            autoComplete="bday"
            defaultValue={values.dateOfBirth ?? ""}
          />
        </Field>
        <Field
          id={f("ni")}
          label="National Insurance number"
          hint={
            !sensitiveOn
              ? "Not switched on yet."
              : values.niLast4
                ? `Saved, ending ${values.niLast4}. Leave blank to keep it.`
                : "For example AB 12 34 56 C."
          }
          error={e.niNumber}
        >
          <Input
            id={f("ni")}
            name="niNumber"
            maxLength={13}
            autoComplete="off"
            disabled={!sensitiveOn}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">
          Emergency contact
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={f("en")} label="Name" error={e.emergencyName}>
            <Input
              id={f("en")}
              name="emergencyName"
              maxLength={100}
              defaultValue={values.emergencyName ?? ""}
            />
          </Field>
          <Field
            id={f("er")}
            label="Relationship"
            error={e.emergencyRelationship}
          >
            <Input
              id={f("er")}
              name="emergencyRelationship"
              maxLength={40}
              defaultValue={values.emergencyRelationship ?? ""}
            />
          </Field>
          <Field id={f("ep")} label="Phone" error={e.emergencyPhone}>
            <Input
              id={f("ep")}
              name="emergencyPhone"
              type="tel"
              maxLength={30}
              defaultValue={values.emergencyPhone ?? ""}
            />
          </Field>
        </div>
      </fieldset>
      <div>
        <Submit label="Save" />
      </div>
    </form>
  );
}

export function BankForm({
  employeeId,
  last4,
}: {
  employeeId: string;
  last4: string | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(!last4);
  const [state, action] = useActionState(saveBankAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p>
          Account ending <span className="font-semibold">{last4}</span>
        </p>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Change
        </Button>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4" autoComplete="off">
      <input type="hidden" name="employeeId" value={employeeId} />
      <Problem state={state} />
      <Field id={`an-${id}`} label="Name on the account" error={e.accountName}>
        <Input id={`an-${id}`} name="accountName" maxLength={60} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`sc-${id}`}
          label="Sort code"
          hint="6 digits, like 12-34-56"
          error={e.sortCode}
        >
          <Input
            id={`sc-${id}`}
            name="sortCode"
            inputMode="numeric"
            maxLength={8}
            required
          />
        </Field>
        <Field
          id={`acc-${id}`}
          label="Account number"
          hint="8 digits"
          error={e.accountNumber}
        >
          <Input
            id={`acc-${id}`}
            name="accountNumber"
            inputMode="numeric"
            maxLength={8}
            required
          />
        </Field>
      </div>
      <p className="text-sm text-ink-muted">
        Stored encrypted. Only you and your employer&rsquo;s HR team can see it,
        and every time they view it is recorded.
      </p>
      <div className="flex gap-3">
        <Submit label="Save bank details" />
        {last4 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Shows a masked value in full on request (audited on the server). */
export function RevealButton({
  employeeId,
  field,
  label,
}: {
  employeeId: string;
  field: "ni" | "bank";
  label: string;
}) {
  const [state, action] = useActionState(revealAction, {
    status: "idle",
  } as RevealState);
  const [hidden, setHidden] = useState(false);
  if (state.status === "shown" && !hidden)
    return (
      <div className="flex flex-col gap-1 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3">
          {state.lines.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <Button size="sm" variant="secondary" onClick={() => setHidden(true)}>
            <EyeOff aria-hidden="true" />
            Hide
          </Button>
        </div>
      </div>
    );
  return (
    <form
      action={(fd) => {
        setHidden(false);
        action(fd);
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="field" value={field} />
      {state.status === "error" ? <FormError message={state.message} /> : null}
      <div>
        <Submit label={label} variant="secondary" size="sm">
          <Eye aria-hidden="true" className="size-4" />
        </Submit>
      </div>
    </form>
  );
}
