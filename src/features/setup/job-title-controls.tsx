"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

import { jobTitleAction } from "./job-title-actions";
import { IDLE, type FormState } from "./form-state";

function useRefreshOnSave(state: FormState) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "saved") router.refresh();
  }, [state, router]);
}

function Message({ state }: { state: FormState }) {
  if (state.status === "error")
    return (
      <Alert tone="danger" title="That didn't work">
        {state.message}
      </Alert>
    );
  if (state.status === "saved")
    return (
      <Alert tone="success" title="Done">
        {state.message}
      </Alert>
    );
  return null;
}

/** Add one or more job titles (one per line). */
export function AddJobTitles() {
  const [state, action] = useActionState(jobTitleAction, IDLE);
  useRefreshOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="add" />
      <Message state={state} />
      <Field
        id="field-names"
        label="Job titles"
        hint="One per line. You can paste a whole list."
        error={e.names}
      >
        <textarea
          id="field-names"
          name="names"
          rows={5}
          required
          className="min-h-28 w-full rounded-[10px] border border-line bg-surface p-3 text-base"
        />
      </Field>
      <Button type="submit" className="w-fit">
        <Plus aria-hidden="true" />
        Add to the list
      </Button>
    </form>
  );
}

export function RemoveJobTitle({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(jobTitleAction, IDLE);
  useRefreshOnSave(state);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="intent" value="archive" />
      <input type="hidden" name="id" value={id} />
      {state.status === "error" ? (
        <span className="text-sm text-danger">{state.message}</span>
      ) : null}
      <Button type="submit" variant="secondary" aria-label={`Remove ${name}`}>
        <X aria-hidden="true" />
        Remove
      </Button>
    </form>
  );
}
