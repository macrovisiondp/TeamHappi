"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";

import {
  createOrganisationAction,
  type CreateOrganisationState,
} from "./actions";

// Collects input only; Platform Admin re-checks the grant, recent MFA and every
// field on the server (src/lib/platform-access).

const ZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris"] as const;

const slugFrom = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create organisation"}
    </Button>
  );
}

export function CreateOrganisation() {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [state, action] = useActionState(createOrganisationAction, {
    status: "idle",
  } as CreateOrganisationState);
  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Create organisation
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create an organisation"
        description="Sets up the organisation with its standard roles and makes the person below its owner."
      >
        {state.status === "ok" ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title="Organisation created" role="status">
              {state.inviteLink
                ? "The owner doesn't have a TeamHappi login yet. Send them this link (valid for 7 days). They create their login from it and become the owner."
                : "The owner already had a TeamHappi login and can open the organisation now."}
            </Alert>
            {state.inviteLink ? (
              <Field id="owner-invite" label="Owner invite link">
                <Input
                  id="owner-invite"
                  readOnly
                  value={state.inviteLink}
                  onFocus={(ev) => ev.currentTarget.select()}
                />
              </Field>
            ) : null}
            <div className="flex justify-end gap-3">
              <a
                href={`/platform/organisations/${state.tenantId}`}
                className="inline-flex min-h-11 items-center rounded-[10px] border border-line-strong px-4 text-sm font-semibold"
              >
                Open it
              </a>
              <Button onClick={() => window.location.reload()}>Done</Button>
            </div>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            {state.status === "error" ? (
              <Alert
                tone={state.stepUp ? "warning" : "danger"}
                title={state.message}
                role="alert"
              >
                {state.stepUp ? (
                  <a
                    href="/platform/mfa/verify?next=/platform/organisations"
                    className="inline-flex min-h-6 items-center font-semibold underline"
                  >
                    Verify with your authenticator
                  </a>
                ) : null}
              </Alert>
            ) : null}
            <Field id="org-name" label="Organisation name" error={e.legalName}>
              <Input
                id="org-name"
                name="legalName"
                required
                maxLength={200}
                onChange={(ev) => {
                  if (!slugEdited) setSlug(slugFrom(ev.currentTarget.value));
                }}
              />
            </Field>
            <Field
              id="org-slug"
              label="Short name (used in links)"
              error={e.slug}
            >
              <Input
                id="org-slug"
                name="slug"
                required
                value={slug}
                onChange={(ev) => {
                  setSlugEdited(true);
                  setSlug(ev.currentTarget.value.toLowerCase());
                }}
              />
            </Field>
            <Field id="org-tz" label="Time zone" error={e.timezone}>
              <Select id="org-tz" name="timezone" defaultValue="Europe/London">
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="org-owner" label="Owner's email" error={e.ownerEmail}>
              <Input
                id="org-owner"
                name="ownerEmail"
                type="email"
                required
                autoComplete="off"
              />
            </Field>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Submit />
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
