"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";

import { ErrorAlert, Submit, useReload } from "@/features/onboarding/controls";
import { IDLE } from "@/features/setup/form-state";

import { confirmMyTraining } from "./actions";

// "My training" control (M8.2). The server checks the course is theirs to
// confirm, and that the content version they read is still current.

export function ConfirmCourse({
  courseId,
  name,
  version,
}: {
  courseId: string;
  name: string;
  version: number;
}) {
  const [state, action] = useActionState(confirmMyTraining, IDLE);
  useReload(state);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="version" value={String(version)} />
      {state.status === "error" ? <ErrorAlert state={state} /> : null}
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          name="acknowledge"
          required
          className="mt-0.5 size-6 shrink-0 accent-[var(--brand-forest)]"
        />
        <span className="text-base">
          I&rsquo;ve read and understood{" "}
          <span className="font-semibold">{name}</span>
        </span>
      </label>
      <p className="text-sm text-ink-muted">
        This records that you&rsquo;ve read it. It isn&rsquo;t a test or a
        qualification.
      </p>
      <Submit label="Confirm">
        <Check aria-hidden="true" />
      </Submit>
    </form>
  );
}
