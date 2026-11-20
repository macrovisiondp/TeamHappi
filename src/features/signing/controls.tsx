"use client";

import { FileSignature, Send, Upload } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Submit } from "@/features/onboarding/controls";

import {
  archivePolicyAction,
  requestCommandAction,
  sendDocumentsAction,
  starterPackAction,
  uploadPolicyAction,
  type SigningFormState,
} from "./actions";

// Documents to sign (M13). These collect input only; the signing module decides
// on the server what is allowed.

const IDLE: SigningFormState = { status: "idle" };

function useReloadOnSave(state: SigningFormState) {
  useEffect(() => {
    if (state.status === "saved") window.location.reload();
  }, [state]);
}

function Problem({ state }: { state: SigningFormState }) {
  if (state.status !== "error") return null;
  const fields = Object.values(state.fieldErrors ?? {});
  return (
    <Alert tone="danger" title={state.message} role="alert">
      {fields.length ? (
        <ul className="list-disc pl-5">
          {fields.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

function FileField({ id, error }: { id: string; error?: string }) {
  return (
    <Field
      id={`file-${id}`}
      label="PDF file (up to 4 MB)"
      hint="In Word, use File > Save As > PDF."
      error={error}
    >
      <Input
        id={`file-${id}`}
        name="file"
        type="file"
        accept="application/pdf,.pdf"
      />
    </Field>
  );
}

/** Adds a policy PDF to the library. */
export function UploadPolicyForm() {
  const id = useId();
  const [state, action] = useActionState(uploadPolicyAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <Problem state={state} />
      <Field id={`title-${id}`} label="Title" error={e.title}>
        <Input
          id={`title-${id}`}
          name="title"
          required
          maxLength={120}
          placeholder="For example: Social Media Policy"
        />
      </Field>
      <FileField id={id} error={e.file} />
      <div>
        <Submit label="Add to library">
          <Upload aria-hidden="true" className="size-4" />
        </Submit>
      </div>
    </form>
  );
}

export function ArchivePolicyButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const [state, action] = useActionState(archivePolicyAction, IDLE);
  useReloadOnSave(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Problem state={state} />
      <div>
        <Submit label="Remove" variant="secondary" size="sm">
          <span className="sr-only">{title}: </span>
        </Submit>
      </div>
    </form>
  );
}

/** Sends library policies and/or an uploaded contract to one person. */
export function SendDocumentsDialog({
  employeeId,
  name,
  library,
}: {
  employeeId: string;
  name: string;
  library: readonly { id: string; title: string }[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(sendDocumentsAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Send aria-hidden="true" />
        Send documents to sign
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Send documents to ${name}`}
        description="They sign on their phone after signing in. Contracts come back to you to countersign."
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <Problem state={state} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">Policies</legend>
            {library.length ? (
              library.map((p) => (
                <label
                  key={p.id}
                  className="flex min-h-11 items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    name="policyId"
                    value={p.id}
                    className="size-5"
                  />
                  {p.title}
                </label>
              ))
            ) : (
              <p className="text-sm text-ink-muted">
                No policies in the library yet. Add them under Onboarding,
                Documents.
              </p>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">
              Contract (optional)
            </legend>
            <p className="text-sm text-ink-muted">
              Fill in {name}&rsquo;s details in your Word contract first, save
              it as PDF, then upload it here.
            </p>
            <Field id={`ctitle-${id}`} label="Contract title" error={e.title}>
              <Input
                id={`ctitle-${id}`}
                name="title"
                maxLength={120}
                defaultValue="Contract of employment"
              />
            </Field>
            <FileField id={id} error={e.file} />
          </fieldset>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Submit label="Send" />
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** The person signs: typed name plus an explicit agreement. */
export function SignForm({
  requestId,
  title,
}: {
  requestId: string;
  title: string;
}) {
  const id = useId();
  const [state, action] = useActionState(requestCommandAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="sign" />
      <input type="hidden" name="requestId" value={requestId} />
      <Problem state={state} />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="agree"
          required
          className="mt-0.5 size-5"
        />
        <span>
          I have read <strong>{title}</strong> and I agree to sign it
          electronically.
        </span>
      </label>
      <Field
        id={`name-${id}`}
        label="Type your full name to sign"
        error={e.name}
      >
        <Input
          id={`name-${id}`}
          name="name"
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
        />
      </Field>
      <div>
        <Submit label="Sign">
          <FileSignature aria-hidden="true" className="size-4" />
        </Submit>
      </div>
    </form>
  );
}

/** Countersign or withdraw a request (documents.manage). */
export function RequestActions({
  requestId,
  title,
  canCountersign,
  canWithdraw,
}: {
  requestId: string;
  title: string;
  canCountersign: boolean;
  canWithdraw: boolean;
}) {
  const id = useId();
  const [dialog, setDialog] = useState<"countersign" | "withdraw" | null>(null);
  const [state, action] = useActionState(requestCommandAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const close = () => setDialog(null);
  return (
    <div className="flex flex-wrap gap-2">
      {canCountersign ? (
        <Button size="sm" onClick={() => setDialog("countersign")}>
          Countersign<span className="sr-only">: {title}</span>
        </Button>
      ) : null}
      {canWithdraw ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDialog("withdraw")}
        >
          Withdraw<span className="sr-only">: {title}</span>
        </Button>
      ) : null}
      <Dialog
        open={dialog === "countersign"}
        onClose={close}
        title="Countersign this contract?"
        description={`${title}. Read it first. Your typed name is added to the signature page.`}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="countersign" />
          <input type="hidden" name="requestId" value={requestId} />
          <Problem state={state} />
          <Field
            id={`cs-${id}`}
            label="Type your full name to countersign"
            error={e.name}
          >
            <Input
              id={`cs-${id}`}
              name="name"
              required
              minLength={2}
              maxLength={100}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Submit label="Countersign" />
          </div>
        </form>
      </Dialog>
      <Dialog
        open={dialog === "withdraw"}
        onClose={close}
        title="Withdraw this request?"
        description={`${title}. They won't be able to sign it. You can send it again later.`}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="withdraw" />
          <input type="hidden" name="requestId" value={requestId} />
          <Problem state={state} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Submit label="Withdraw" variant="danger" />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// --- M14.1 starter packs ---------------------------------------------------------------

/** Create a starter pack: a name, an optional job title and library policies. */
export function StarterPackForm({
  library,
  jobTitles,
  fixedTitles = false,
}: {
  library: readonly { id: string; title: string }[];
  jobTitles: readonly string[];
  /** The organisation keeps a job-title list (M16): choose from it. */
  fixedTitles?: boolean;
}) {
  const id = useId();
  const [state, action] = useActionState(starterPackAction, IDLE);
  useReloadOnSave(state);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="create" />
      <Problem state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`pname-${id}`} label="Pack name" error={e.name}>
          <Input
            id={`pname-${id}`}
            name="name"
            required
            maxLength={80}
            placeholder="For example: Kitchen starter"
          />
        </Field>
        <Field
          id={`pjob-${id}`}
          label="For job title (leave empty for everyone)"
          error={e.jobTitle}
        >
          {fixedTitles ? (
            <Select id={`pjob-${id}`} name="jobTitle" defaultValue="">
              <option value="">Everyone</option>
              {jobTitles.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Input
                id={`pjob-${id}`}
                name="jobTitle"
                maxLength={100}
                list={`pjobs-${id}`}
              />
              <datalist id={`pjobs-${id}`}>
                {jobTitles.map((j) => (
                  <option key={j} value={j} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-semibold">Documents</legend>
        {e.documents ? (
          <p className="text-sm text-danger">{e.documents}</p>
        ) : null}
        {library.map((d) => (
          <label
            key={d.id}
            className="flex min-h-11 items-center gap-3 text-sm"
          >
            <input
              type="checkbox"
              name="documentId"
              value={d.id}
              className="size-5"
            />
            {d.title}
          </label>
        ))}
      </fieldset>
      <div>
        <Submit label="Save starter pack" />
      </div>
    </form>
  );
}

export function ArchivePackButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(starterPackAction, IDLE);
  useReloadOnSave(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="archive" />
      <input type="hidden" name="id" value={id} />
      <Problem state={state} />
      <div>
        <Submit label="Remove" variant="secondary" size="sm">
          <span className="sr-only">{name}: </span>
        </Submit>
      </div>
    </form>
  );
}

/** On a person's record: send everything in their job title's starter pack. */
export function SendStarterPackButton({ employeeId }: { employeeId: string }) {
  const [state, action] = useActionState(starterPackAction, IDLE);
  useReloadOnSave(state);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="send" />
      <input type="hidden" name="employeeId" value={employeeId} />
      <Problem state={state} />
      <div>
        <Submit label="Send starter pack" variant="secondary" size="sm" />
      </div>
    </form>
  );
}
