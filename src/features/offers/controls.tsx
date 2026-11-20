"use client";

import { Send } from "lucide-react";
import { useActionState, useEffect, useId } from "react";

import { Alert } from "@/components/ui/alert";
import { FormError } from "@/components/ui/form-error";
import { reloadWithNote } from "@/components/ui/toast";
import { Field, Input } from "@/components/ui/field";
import { Submit } from "@/features/onboarding/controls";

import { offerCommandAction, type OfferFormState } from "./actions";

// Offer letters for staff (M14.3). Input only; the recruitment module decides.

const IDLE: OfferFormState = { status: "idle" };

export function SendOfferForm({ applicationId }: { applicationId: string }) {
  const id = useId();
  const [state, action] = useActionState(offerCommandAction, IDLE);
  useEffect(() => {
    if (state.status === "saved" && !state.link) reloadWithNote(state.message);
  }, [state]);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  if (state.status === "saved" && state.link)
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="warning" title={state.message} role="status" />
        <Field id={`ol-${id}`} label="Private offer link">
          <Input
            id={`ol-${id}`}
            readOnly
            value={state.link}
            onFocus={(ev) => ev.currentTarget.select()}
          />
        </Field>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="send" />
      <input type="hidden" name="applicationId" value={applicationId} />
      {state.status === "error" ? <FormError message={state.message} /> : null}
      <Field id={`ot-${id}`} label="Title" error={e.title}>
        <Input
          id={`ot-${id}`}
          name="title"
          required
          maxLength={120}
          defaultValue="Offer of employment"
        />
      </Field>
      <Field
        id={`of-${id}`}
        label="Offer letter (PDF, up to 4 MB)"
        hint="In Word, use File > Save As > PDF."
        error={e.file}
      >
        <Input
          id={`of-${id}`}
          name="file"
          type="file"
          accept="application/pdf,.pdf"
        />
      </Field>
      <div>
        <Submit label="Send the offer">
          <Send aria-hidden="true" className="size-4" />
        </Submit>
      </div>
    </form>
  );
}

export function WithdrawOfferButton({
  offerId,
  title,
}: {
  offerId: string;
  title: string;
}) {
  const [state, action] = useActionState(offerCommandAction, IDLE);
  useEffect(() => {
    if (state.status === "saved") reloadWithNote(state.message);
  }, [state]);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="withdraw" />
      <input type="hidden" name="offerId" value={offerId} />
      {state.status === "error" ? <FormError message={state.message} /> : null}
      <div>
        <Submit label="Withdraw" variant="secondary" size="sm">
          <span className="sr-only">{title}: </span>
        </Submit>
      </div>
    </form>
  );
}
