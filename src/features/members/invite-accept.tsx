"use client";

import Link from "next/link";
import type * as React from "react";
import { startTransition, useActionState, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  acceptInvitationAction,
  createAccountFromInvitation,
  openInvitation,
  type InviteView,
  type MemberActionState,
} from "./actions";

// The invite page (M6). The token is in the URL fragment ("#..."), which the
// browser never sends to the server; it is read here, kept for this tab only
// (so it survives signing in), removed from the address bar, and sent to the
// server only in POST bodies.

const KEY = "teamhappi.invite";

function readToken(): string | null {
  const fromHash = window.location.hash.replace(/^#/, "");
  try {
    if (fromHash) {
      sessionStorage.setItem(KEY, fromHash);
      window.history.replaceState(null, "", window.location.pathname);
      return fromHash;
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return fromHash || null;
  }
}

/** Tokens go to the server only inside a form body. */
function tokenForm(token: string): FormData {
  const form = new FormData();
  form.set("token", token);
  return form;
}

function forgetToken() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable; nothing to clear.
  }
}

const STATE_MESSAGE: Record<string, string> = {
  used: "This invitation has already been used. If that was you, sign in.",
  revoked:
    "This invitation was cancelled. Ask whoever invited you for a new link.",
  expired:
    "This invitation has expired. Ask whoever invited you for a new link.",
  unavailable: "This organisation isn't available at the moment.",
  invalid:
    "This invitation link isn't valid. Check you copied the whole link, or ask for a new one.",
};

type Loaded =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; token: string; view: InviteView };

export function InviteAccept() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    const load = async () => {
      const token = readToken();
      if (!token) return setLoaded({ kind: "missing" });
      setLoaded({
        kind: "ready",
        token,
        view: await openInvitation(tokenForm(token)),
      });
    };
    void load();
    // Opening another invite link in this tab changes only the "#..." part,
    // which doesn't reload the page.
    const onHash = () => {
      if (window.location.hash.length > 1) void load();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (loaded.kind === "loading")
    return <p className="text-sm text-ink-muted">Checking your invitation…</p>;
  if (loaded.kind === "missing")
    return (
      <Alert tone="warning" title="No invitation found">
        Open the full link you were sent. It ends with a long code after a
        &ldquo;#&rdquo;.
      </Alert>
    );
  const { token, view } = loaded;
  const { preview } = view;
  if (preview.state !== "valid")
    return (
      <div className="flex flex-col gap-4">
        <Alert
          tone="warning"
          title={STATE_MESSAGE[preview.state] ?? STATE_MESSAGE.invalid!}
        />
        <Link
          href="/sign-in"
          className="text-sm font-semibold text-forest underline"
        >
          Go to sign in
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-2 rounded-[10px] bg-surface-muted p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Organisation</dt>
          <dd className="font-semibold">{preview.organisation}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Role</dt>
          <dd className="font-semibold">
            {preview.site ? `${preview.role} (${preview.site})` : preview.role}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-muted">Invited email</dt>
          <dd className="font-semibold break-all">{preview.email}</dd>
        </div>
      </dl>
      {view.signedInAs ? (
        view.signedInAs === preview.email ? (
          <JoinButton token={token} organisation={preview.organisation ?? ""} />
        ) : (
          <WrongAccount signedInAs={view.signedInAs} />
        )
      ) : view.accountExists ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            This address already has a TeamHappi account. Sign in, and
            you&rsquo;ll come back here to accept.
          </p>
          <Button asChild className="w-fit">
            <Link href="/sign-in?next=/invite">Sign in to accept</Link>
          </Button>
        </div>
      ) : (
        <CreateAccount token={token} />
      )}
    </div>
  );
}

function JoinButton({
  token,
  organisation,
}: {
  token: string;
  organisation: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger" title={error} role="alert" /> : null}
      <Button
        className="w-fit"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const r = await acceptInvitationAction(tokenForm(token));
          if (r.ok) {
            forgetToken();
            window.location.assign(r.href);
          } else {
            setError(r.message);
            setPending(false);
          }
        }}
      >
        {pending ? "Joining…" : `Join ${organisation}`}
      </Button>
    </div>
  );
}

function WrongAccount({ signedInAs }: { signedInAs: string }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Alert
        tone="warning"
        title="This invitation is for a different email address"
      >
        You&rsquo;re signed in as{" "}
        <span className="break-all">{signedInAs}</span>. Sign out, then open the
        link again to accept it with the invited address.
      </Alert>
      <Button
        variant="secondary"
        className="w-fit"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await fetch("/api/auth/sign-out", { method: "POST" });
          window.location.reload();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

function CreateAccount({ token }: { token: string }) {
  const [state, action, pending] = useActionState(createAccountFromInvitation, {
    status: "idle",
  } as MemberActionState);
  const [mismatch, setMismatch] = useState(false);
  useEffect(() => {
    if (state.status === "ok" && state.link) {
      forgetToken();
      window.location.assign(state.link);
    }
  }, [state]);
  const errors: Record<string, string> = {
    ...(state.status === "error" ? (state.fieldErrors ?? {}) : {}),
    ...(mismatch ? { confirmPassword: "The passwords don't match" } : {}),
  };
  const describedBy = (name: string, hint = false) =>
    [hint ? `${name}-hint` : "", errors[name] ? `${name}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  // Submitted by hand (not <form action>) so a failed attempt doesn't clear
  // what the person typed. The server checks everything again.
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const differs = form.get("password") !== form.get("confirmPassword");
    setMismatch(differs);
    if (!differs) startTransition(() => action(form));
  };
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
      noValidate
      method="post"
    >
      <p className="text-sm">
        Create your account to join. You&rsquo;ll sign in with the invited email
        address and the password you choose here.
      </p>
      {state.status === "error" || mismatch ? (
        <Alert
          tone="danger"
          title={
            mismatch || state.status !== "error"
              ? "Check the highlighted fields."
              : state.message
          }
          role="alert"
        />
      ) : null}
      <input type="hidden" name="token" value={token} />
      <Field id="name" label="Your name" error={errors.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("name")}
        />
      </Field>
      <Field
        id="password"
        label="Choose a password"
        hint="At least 12 characters. A short phrase is easy to remember."
        error={errors.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={describedBy("password", true)}
        />
      </Field>
      <Field
        id="confirmPassword"
        label="Type the password again"
        error={errors.confirmPassword}
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.confirmPassword ? true : undefined}
          aria-describedby={describedBy("confirmPassword")}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating your account…" : "Create account and join"}
      </Button>
    </form>
  );
}
