"use client";

import {
  CheckCircle2,
  FileUp,
  FolderOpen,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const take = (files: FileList | null) =>
    setChosen(files ? [...files].map((f) => f.name) : []);
  return (
    <form
      action={action}
      // The form clears its file field after sending; clear the list too.
      onSubmit={() => setChosen([])}
      className="flex flex-col gap-4"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          // Dropped files go into the real file field, so the form sends them.
          const field =
            e.currentTarget.querySelector<HTMLInputElement>("input[type=file]");
          if (field) field.files = e.dataTransfer.files;
          take(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${
          dragging ? "border-forest bg-sage" : "border-line-strong bg-surface"
        }`}
      >
        <FileUp aria-hidden="true" className="size-8 text-forest" />
        <div>
          <p className="font-semibold">Course files (.json)</p>
          <p className="text-sm text-ink-muted">
            Drag them here, or choose them. Up to 40 at once.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => input.current?.click()}
        >
          <FolderOpen aria-hidden="true" />
          Choose course files
        </Button>
        <input
          ref={input}
          id="course-files"
          type="file"
          name="files"
          accept=".json,application/json"
          multiple
          className="sr-only"
          aria-label="Course files"
          onChange={(e) => take(e.target.files)}
        />
        {chosen.length ? (
          <p className="text-sm" aria-live="polite">
            <span className="font-semibold">
              {chosen.length} file{chosen.length === 1 ? "" : "s"} chosen:
            </span>{" "}
            {chosen.slice(0, 6).join(", ")}
            {chosen.length > 6 ? ` and ${chosen.length - 6} more` : ""}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">
        A file for a course you already have adds a new version of it;
        people&rsquo;s existing records stay valid.
      </p>
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
