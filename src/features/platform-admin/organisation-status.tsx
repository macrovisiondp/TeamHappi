"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";

import { changeOrganisationStatus, type ActionState } from "./actions";

function Submit({ label, danger }: { label: string; danger: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={danger ? "danger" : "primary"}
      disabled={pending}
    >
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** Suspend or reactivate, with a confirmation and (for suspension) a reason. */
export function OrganisationStatusControl({
  tenantId,
  name,
  status,
}: {
  tenantId: string;
  name: string;
  status: "active" | "suspended";
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(
    async (prev: ActionState, form: FormData) => {
      const result = await changeOrganisationStatus(prev, form);
      if (result.status === "ok") setOpen(false);
      return result;
    },
    { status: "idle" } as ActionState,
  );
  // A full reload after a change, so the status, controls and history all
  // reflect the database (no partially refreshed view).
  useEffect(() => {
    if (state.status === "ok") window.location.reload();
  }, [state]);

  const suspending = status === "active";
  return (
    <div className="flex flex-col gap-3">
      {state.status === "error" ? (
        <Alert
          tone={state.stepUp ? "warning" : "danger"}
          title={state.message}
          role="alert"
        >
          {state.stepUp ? (
            <a
              href={`/platform/mfa/verify?next=/platform/organisations/${tenantId}`}
              className="inline-flex min-h-6 items-center font-semibold underline"
            >
              Verify with your authenticator
            </a>
          ) : null}
        </Alert>
      ) : null}
      {state.status === "ok" && state.message ? (
        <Alert tone="success" title={state.message} role="status" />
      ) : null}
      <Button
        className="w-fit"
        variant={suspending ? "danger" : "secondary"}
        onClick={() => setOpen(true)}
      >
        {suspending ? "Suspend organisation" : "Reactivate organisation"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={suspending ? `Suspend ${name}?` : `Reactivate ${name}?`}
        description={
          suspending
            ? "Everyone in this organisation loses access on their next page load. Their data is kept, and you can reactivate at any time."
            : "Members can sign in to their workspace again."
        }
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input
            type="hidden"
            name="next"
            value={suspending ? "suspended" : "active"}
          />
          {suspending ? (
            <Field
              id="suspend-reason"
              label="Reason (recorded in the audit log)"
              hint="For example: payment overdue, at the owner's request. Don't include personal details."
            >
              <textarea
                id="suspend-reason"
                name="reason"
                required
                minLength={5}
                maxLength={300}
                rows={3}
                aria-describedby="suspend-reason-hint"
                className="w-full rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-base"
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Submit
              label={suspending ? "Suspend" : "Reactivate"}
              danger={suspending}
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}
