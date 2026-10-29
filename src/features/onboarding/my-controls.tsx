"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";

import { IDLE } from "@/features/setup/form-state";

import { completeMyOnboardingTask } from "./actions";
import { ErrorAlert, Submit, useReload } from "./controls";

// "My onboarding" control (M7.3). The server checks the task is the signed-in
// person's own; this only collects the tap (and the acknowledgement for policies).

export function MyTaskAction({
  taskId,
  title,
  isPolicy,
}: {
  taskId: string;
  title: string;
  isPolicy: boolean;
}) {
  const [state, action] = useActionState(completeMyOnboardingTask, IDLE);
  useReload(state);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="taskId" value={taskId} />
      {state.status === "error" ? <ErrorAlert state={state} /> : null}
      {isPolicy ? (
        <>
          <input type="hidden" name="policy" value="1" />
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              name="acknowledge"
              required
              className="mt-0.5 size-6 shrink-0 accent-[var(--brand-forest)]"
            />
            <span className="text-base">
              I&rsquo;ve read and understood{" "}
              <span className="font-semibold">{title}</span>
            </span>
          </label>
          <Submit label="Confirm">
            <Check aria-hidden="true" />
          </Submit>
        </>
      ) : (
        <Submit label="Mark as done">
          <Check aria-hidden="true" />
          <span className="sr-only">{title}: </span>
        </Submit>
      )}
    </form>
  );
}
