"use client";

import { CheckCircle2, Upload, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { FormError } from "@/components/ui/form-error";

import { Submit } from "@/features/onboarding/controls";

import { importTrainingCourses, type ImportState } from "./course-actions";

// Import interactive course files (M15). Each file is validated on the server;
// the result for every file is listed.

export function ImportCourses() {
  const router = useRouter();
  const [state, action] = useActionState<ImportState, FormData>(
    importTrainingCourses,
    { status: "idle" },
  );
  useEffect(() => {
    if (state.status === "done") router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Course files (.json)</span>
        <input
          type="file"
          name="files"
          accept=".json,application/json"
          multiple
          required
          className="min-h-11 text-base"
        />
        <span className="text-sm text-ink-muted">
          Up to 40 files at once. A file for a course you already have adds a
          new version of it; people&rsquo;s existing records stay valid.
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          name="addRules"
          defaultChecked
          className="mt-0.5 size-6 shrink-0 accent-[var(--brand-forest)]"
        />
        <span className="text-base">
          Also add the job-title rules in the files (new courses only). Check
          the job titles match your staff records afterwards.
        </span>
      </label>
      {state.status === "error" ? <FormError message={state.message} /> : null}
      {state.status === "done" ? (
        <ul className="flex flex-col gap-2" aria-label="Import results">
          {state.outcomes.map((o, i) => (
            <li key={i} className="flex items-start gap-2 text-base">
              {o.ok ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-forest"
                />
              ) : (
                <XCircle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-danger"
                />
              )}
              <span>
                <span className="font-semibold">{o.file}: </span>
                {o.message}{" "}
                {o.courseId ? (
                  <Link
                    href={`/training/courses/${o.courseId}`}
                    className="font-semibold text-forest underline-offset-4 hover:underline"
                  >
                    Open
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Submit label="Import">
        <Upload aria-hidden="true" />
      </Submit>
    </form>
  );
}
