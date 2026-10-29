"use client";

import { Check, Copy, Link2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";

import {
  invitationCommand,
  inviteMember,
  memberCommand,
  type MemberActionState,
} from "./actions";

// Members and invitations (M6). These only collect input; the server decides
// what is allowed and the database enforces the organisation boundary.

const IDLE: MemberActionState = { status: "idle" };

export interface Option {
  id: string;
  name: string;
}

function Submit({
  label,
  pending: pendingLabel = "Saving…",
  variant = "primary",
  size,
}: {
  label: string;
  pending?: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ErrorAlert({ state }: { state: MemberActionState }) {
  return state.status === "error" ? (
    <Alert tone="danger" title={state.message} role="alert" />
  ) : null;
}

/** The one-time link, with a copy button. Shown once; never stored. */
export function LinkBox({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line-strong bg-surface-muted p-3">
      <label htmlFor="invite-link" className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="invite-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-sm"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-sm text-ink-muted">
        Send it to them yourself, for example by text or WhatsApp. Anyone with
        this link can join as this person, so send it only to them. You
        won&rsquo;t see this link again; create a new one if it&rsquo;s lost.
      </p>
    </div>
  );
}

export function InviteForm({
  roles,
  sites,
  person,
}: {
  roles: readonly Option[];
  sites: readonly Option[];
  /** M7.3: inviting a person's record; accepting links the record to the login. */
  person?: { employeeId: string; email: string | null; siteId: string | null };
}) {
  const router = useRouter();
  const [state, action] = useActionState(inviteMember, IDLE);
  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const described = (id: string, hint?: boolean) =>
    [
      hint ? `${id}-hint` : "",
      errors[id.replace("invite-", "")] ? `${id}-error` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-4">
      {state.status === "ok" ? (
        <>
          <Alert tone="success" title={state.message} role="status" />
          {state.link ? (
            <LinkBox link={state.link} label="Invite link" />
          ) : null}
        </>
      ) : null}
      <ErrorAlert state={state} />
      <form action={action} className="grid gap-4 md:grid-cols-3" noValidate>
        {person ? (
          <input type="hidden" name="employeeId" value={person.employeeId} />
        ) : null}
        <Field id="invite-email" label="Email address" error={errors.email}>
          <Input
            id="invite-email"
            name="email"
            type="email"
            defaultValue={person?.email ?? undefined}
            autoComplete="off"
            required
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={described("invite-email")}
          />
        </Field>
        <Field id="invite-roleId" label="Role" error={errors.roleId}>
          <Select
            id="invite-roleId"
            name="roleId"
            required
            defaultValue={
              roles.find((r) => r.name === "Worker")?.id ?? roles[0]?.id
            }
            aria-invalid={errors.roleId ? true : undefined}
            aria-describedby={described("invite-roleId")}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="invite-siteId"
          label="Site"
          hint="Limit the role to one site, or leave as all sites."
          error={errors.siteId}
        >
          <Select
            id="invite-siteId"
            name="siteId"
            defaultValue={person?.siteId ?? ""}
            aria-invalid={errors.siteId ? true : undefined}
            aria-describedby={described("invite-siteId", true)}
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-3">
          <Submit label="Create invite link" pending="Creating…" />
        </div>
      </form>
    </div>
  );
}

export function InvitationActions({
  id,
  email,
}: {
  id: string;
  email: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(
    async (prev: MemberActionState, form: FormData) => {
      const r = await invitationCommand(prev, form);
      setConfirming(false);
      return r;
    },
    IDLE,
  );
  useEffect(() => {
    if (state.status === "ok" && !state.link) router.refresh();
  }, [state, router]);
  return (
    <div className="flex flex-col gap-2">
      {state.status === "ok" && state.link ? (
        <LinkBox link={state.link} label={`New invite link for ${email}`} />
      ) : null}
      <ErrorAlert state={state} />
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="invitationId" value={id} />
          <input type="hidden" name="intent" value="renew" />
          <Button type="submit" size="sm" variant="secondary">
            <Link2 aria-hidden="true" />
            New link
            <span className="sr-only"> for {email}</span>
          </Button>
        </form>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setConfirming(true)}
        >
          Cancel invitation
          <span className="sr-only"> for {email}</span>
        </Button>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Cancel the invitation for ${email}?`}
        description="The link stops working straight away. You can invite them again later."
      >
        <form action={action} className="flex flex-wrap justify-end gap-3">
          <input type="hidden" name="invitationId" value={id} />
          <input type="hidden" name="intent" value="revoke" />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirming(false)}
          >
            Keep it
          </Button>
          <Submit label="Cancel invitation" variant="danger" />
        </form>
      </Dialog>
    </div>
  );
}

type Confirm = null | "role" | "suspend" | "reactivate" | "remove";

export function MemberActions({
  membershipId,
  name,
  status,
  currentRoleId,
  currentSiteId,
  roles,
  sites,
  canAssign,
  canManage,
}: {
  membershipId: string;
  name: string;
  status: "active" | "suspended";
  currentRoleId: string | null;
  currentSiteId: string | null;
  roles: readonly Option[];
  sites: readonly Option[];
  canAssign: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState<Confirm>(null);
  const [state, action] = useActionState(
    async (prev: MemberActionState, form: FormData) => {
      const r = await memberCommand(prev, form);
      if (r.status === "ok") setOpen(null);
      return r;
    },
    IDLE,
  );
  // Full reload so badges, roles and activity all reflect the database.
  useEffect(() => {
    if (state.status === "ok") window.location.reload();
  }, [state]);

  const titles: Record<Exclude<Confirm, null>, string> = {
    role: `Change ${name}'s role`,
    suspend: `Suspend ${name}?`,
    reactivate: `Restore ${name}'s access?`,
    remove: `Remove ${name} from the organisation?`,
  };
  const descriptions: Record<Exclude<Confirm, null>, string> = {
    role: "Their new role replaces the current one.",
    suspend:
      "They lose access on their next page load. You can restore it at any time.",
    reactivate: "They can use this organisation again with their current role.",
    remove:
      "They lose access straight away. Their history is kept, and you can invite them again later.",
  };
  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" && !open ? <ErrorAlert state={state} /> : null}
      <div className="flex flex-wrap gap-2">
        {canAssign ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen("role")}>
            Change role<span className="sr-only"> for {name}</span>
          </Button>
        ) : null}
        {canManage ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setOpen(status === "active" ? "suspend" : "reactivate")
              }
            >
              {status === "active" ? "Suspend" : "Restore access"}
              <span className="sr-only"> for {name}</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setOpen("remove")}
            >
              Remove<span className="sr-only"> {name}</span>
            </Button>
          </>
        ) : null}
      </div>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? titles[open] : ""}
        description={open ? descriptions[open] : undefined}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="intent" value={open ?? ""} />
          {state.status === "error" ? <ErrorAlert state={state} /> : null}
          {open === "role" ? (
            <>
              <Field id={`role-${membershipId}`} label="Role">
                <Select
                  id={`role-${membershipId}`}
                  name="roleId"
                  defaultValue={currentRoleId ?? undefined}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`site-${membershipId}`} label="Site">
                <Select
                  id={`site-${membershipId}`}
                  name="siteId"
                  defaultValue={currentSiteId ?? ""}
                >
                  <option value="">All sites</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(null)}
            >
              Cancel
            </Button>
            <Submit
              label={
                open === "role"
                  ? "Save role"
                  : open === "suspend"
                    ? "Suspend"
                    : open === "remove"
                      ? "Remove"
                      : "Restore access"
              }
              variant={
                open === "suspend" || open === "remove" ? "danger" : "primary"
              }
            />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function InviteHeading() {
  return (
    <span className="inline-flex items-center gap-2">
      <UserPlus aria-hidden="true" className="size-5" />
      Invite someone
    </span>
  );
}
