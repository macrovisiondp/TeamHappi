"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import { ownerInviteAction, type OwnerInviteState } from "./actions";

// Resend (new link) or cancel an organisation's owner invitation. Platform
// Admin re-checks the grant and recent MFA on the server.

function Submit({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={danger ? "secondary" : "primary"}
      disabled={pending}
    >
      {pending ? "Working…" : label}
    </Button>
  );
}

export function OwnerInviteControls({
  tenantId,
  organisation,
  email,
  canCancel,
}: {
  tenantId: string;
  organisation: string;
  email: string;
  canCancel: boolean;
}) {
  const [state, action] = useActionState(ownerInviteAction, {
    status: "idle",
  } as OwnerInviteState);
  const [to, setTo] = useState(email);
  useEffect(() => {
    if (state.status === "ok" && !state.inviteLink)
      window.setTimeout(() => window.location.reload(), 1500);
  }, [state]);
  return (
    <div className="flex flex-col gap-3 text-sm">
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
      {state.status === "ok" ? (
        <Alert tone="success" title={state.message} role="status" />
      ) : null}
      {state.status === "ok" && state.inviteLink ? (
        <Field id={`link-${tenantId}`} label="Owner invite link">
          <Input
            id={`link-${tenantId}`}
            readOnly
            value={state.inviteLink}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
      ) : null}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="organisation" value={organisation} />
        <input type="hidden" name="intent" value="renew" />
        <Field id={`owner-email-${tenantId}`} label="Owner's email">
          <Input
            id={`owner-email-${tenantId}`}
            name="email"
            type="email"
            required
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
        </Field>
        <Submit label="Send a new invitation" />
      </form>
      {canCancel ? (
        <form action={action}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="intent" value="cancel" />
          <Submit label="Cancel the invitation" danger />
        </form>
      ) : null}
    </div>
  );
}
