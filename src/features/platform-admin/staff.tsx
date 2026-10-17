"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  GRANT_LABELS,
  PLATFORM_GRANTS,
  type PlatformGrantCode,
} from "@/lib/permissions/platform";

import { addStaff, updateStaffMember, type ActionState } from "./actions";

const IDLE: ActionState = { status: "idle" };

function Feedback({ state, next }: { state: ActionState; next: string }) {
  if (state.status === "error")
    return (
      <Alert
        tone={state.stepUp ? "warning" : "danger"}
        title={state.message}
        role="alert"
      >
        {state.stepUp ? (
          <a
            href={`/platform/mfa/verify?next=${next}`}
            className="inline-flex min-h-6 items-center font-semibold underline"
          >
            Verify with your authenticator
          </a>
        ) : null}
      </Alert>
    );
  if (state.status === "ok" && state.message)
    return <Alert tone="success" title={state.message} role="status" />;
  return null;
}

function Submit({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function GrantChoices({
  selected,
  idPrefix,
}: {
  selected: readonly string[];
  idPrefix: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">Permissions</legend>
      <ul className="grid gap-2 sm:grid-cols-2">
        {PLATFORM_GRANTS.map((g) => (
          <li key={g}>
            <label
              htmlFor={`${idPrefix}-${g}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-line px-3 py-2 hover:bg-sage"
            >
              <input
                id={`${idPrefix}-${g}`}
                type="checkbox"
                name="grants"
                value={g}
                defaultChecked={selected.includes(g)}
                className="size-5 accent-[var(--brand-forest)]"
              />
              <span className="text-sm">{GRANT_LABELS[g]}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function useRefreshOnSuccess(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);
}

export function AddStaffForm() {
  const [state, action] = useActionState(addStaff, IDLE);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} next="/platform/staff" />
      <Field
        id="staff-email"
        label="Email of an existing, verified TeamHappi account"
      >
        <Input
          id="staff-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          className="max-w-md"
        />
      </Field>
      <GrantChoices selected={[]} idPrefix="new" />
      <div>
        <Submit label="Add platform staff" />
      </div>
    </form>
  );
}

export interface StaffView {
  userId: string;
  name: string;
  email: string | null;
  status: "active" | "suspended" | "revoked";
  grants: PlatformGrantCode[];
  mfaEnrolled: boolean;
  isSelf: boolean;
}

const STATUS = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  revoked: { tone: "neutral", label: "Revoked" },
} as const;

export function StaffMember({ member }: { member: StaffView }) {
  const [confirm, setConfirm] = useState<
    null | "suspend" | "revoke" | "reset_mfa"
  >(null);
  const [state, action] = useActionState(
    async (prev: ActionState, form: FormData) => {
      const result = await updateStaffMember(prev, form);
      setConfirm(null);
      return result;
    },
    IDLE,
  );
  useRefreshOnSuccess(state);
  const headingId = `staff-${member.userId}`;
  const locked = member.isSelf || member.status === "revoked";

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold">
            {member.name}
            {member.isSelf ? " (you)" : ""}
          </h3>
          <p className="text-sm break-all text-ink-muted">{member.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS[member.status].tone}>
            {STATUS[member.status].label}
          </Badge>
          <Badge tone={member.mfaEnrolled ? "success" : "warning"}>
            {member.mfaEnrolled ? "MFA on" : "MFA not set up"}
          </Badge>
        </div>
      </div>
      <Feedback state={state} next="/platform/staff" />
      {locked ? (
        <p className="text-sm text-ink-muted">
          {member.isSelf
            ? "You can't change your own access. Ask another administrator."
            : "Revoked access can't be changed. Add them again if needed."}
        </p>
      ) : (
        <>
          <form action={action} className="flex flex-col gap-3" noValidate>
            <input type="hidden" name="userId" value={member.userId} />
            <input type="hidden" name="intent" value="grants" />
            <GrantChoices selected={member.grants} idPrefix={member.userId} />
            <div>
              <Submit label="Save permissions" variant="secondary" />
            </div>
          </form>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {member.status === "active" ? (
              <Button variant="secondary" onClick={() => setConfirm("suspend")}>
                Suspend access
              </Button>
            ) : (
              <form action={action}>
                <input type="hidden" name="userId" value={member.userId} />
                <input type="hidden" name="intent" value="reactivate" />
                <Submit label="Reactivate access" variant="secondary" />
              </form>
            )}
            {member.mfaEnrolled ? (
              <Button
                variant="secondary"
                onClick={() => setConfirm("reset_mfa")}
              >
                Reset MFA
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => setConfirm("revoke")}>
              Revoke access
            </Button>
          </div>
        </>
      )}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === "suspend"
            ? `Suspend ${member.name}?`
            : confirm === "revoke"
              ? `Revoke ${member.name}'s access?`
              : `Reset ${member.name}'s MFA?`
        }
        description={
          confirm === "suspend"
            ? "They lose Platform Admin access immediately. You can reactivate them later."
            : confirm === "revoke"
              ? "Permanent: to give access again, add them as new staff."
              : "Their authenticator and recovery codes stop working. They must set up MFA again before using Platform Admin."
        }
      >
        <form action={action} className="flex flex-wrap justify-end gap-3">
          <input type="hidden" name="userId" value={member.userId} />
          <input type="hidden" name="intent" value={confirm ?? ""} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirm(null)}
          >
            Cancel
          </Button>
          <Submit
            label={
              confirm === "suspend"
                ? "Suspend"
                : confirm === "revoke"
                  ? "Revoke"
                  : "Reset MFA"
            }
            variant={confirm === "revoke" ? "danger" : "primary"}
          />
        </form>
      </Dialog>
    </section>
  );
}
