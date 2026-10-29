"use client";

import { Download, FileText } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ErrorAlert, Submit, useReload } from "@/features/onboarding/controls";
import { SetupForm } from "@/features/setup/form";
import { IDLE } from "@/features/setup/form-state";

import { removeCvAction, uploadCvAction } from "./actions";

// CV controls (M9.2b). The server checks the file's content, size and the
// member's access again; these only collect the file.

export function CvUploadForm({ applicationId }: { applicationId: string }) {
  return (
    <SetupForm
      action={uploadCvAction}
      submitLabel="Upload CV"
      hidden={{ applicationId }}
    >
      {(e) => (
        <Field
          id="field-file"
          label="CV file"
          hint="PDF or Word (.docx), up to 4 MB. Upload only what the candidate gave you for this job."
          error={e.file}
        >
          <input
            id="field-file"
            name="file"
            type="file"
            required
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-describedby="field-file-hint"
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-[10px] file:border file:border-line-strong file:bg-surface file:px-4 file:font-semibold"
          />
        </Field>
      )}
    </SetupForm>
  );
}

export function CvItem({
  id,
  fileName,
  meta,
  canRemove,
}: {
  id: string;
  fileName: string;
  meta: string;
  canRemove: boolean;
}) {
  const [state, action] = useActionState(removeCvAction, IDLE);
  const [confirm, setConfirm] = useState(false);
  useReload(state);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line p-3">
      <div className="flex min-w-0 items-start gap-2">
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold break-all">{fileName}</p>
          <p className="text-xs text-ink-muted">{meta}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`/recruitment/cv/${id}`}
          download
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line-strong px-4 text-sm font-semibold"
        >
          <Download aria-hidden="true" className="size-4" />
          Download<span className="sr-only"> {fileName}</span>
        </a>
        {canRemove ? (
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
            Remove<span className="sr-only"> {fileName}</span>
          </Button>
        ) : null}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remove this CV?"
        description="The file is deleted from storage and can't be recovered. The audit log keeps a record that a CV was removed."
      >
        <form action={action} className="flex flex-wrap justify-end gap-3">
          <input type="hidden" name="documentId" value={id} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirm(false)}
          >
            Back
          </Button>
          <Submit label="Remove CV" variant="danger" />
        </form>
      </Dialog>
    </li>
  );
}
