"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  confirmMfaSetup,
  regenerateRecoveryCodes,
  startMfaSetup,
  verifyMfa,
  type ActionState,
} from "./actions";

const IDLE: ActionState = { status: "idle" };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Checking…" : label}
    </Button>
  );
}

function CodeField({
  label,
  hint,
  recovery = false,
}: {
  label: string;
  hint: string;
  recovery?: boolean;
}) {
  return (
    <Field id="mfa-code" label={label} hint={hint}>
      <Input
        id="mfa-code"
        name="code"
        required
        autoComplete="one-time-code"
        inputMode={recovery ? "text" : "numeric"}
        pattern={recovery ? undefined : "[0-9]{6}"}
        maxLength={recovery ? 11 : 6}
        aria-describedby="mfa-code-hint"
        className="max-w-xs font-mono tracking-widest"
      />
    </Field>
  );
}

/** Shows recovery codes once, then continues with a full page load. */
export function RecoveryCodes({
  codes,
  href,
}: {
  codes: string[];
  href?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div className="flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        Save your recovery codes
      </h2>
      <Alert tone="warning" title="You'll only see these once">
        Store them somewhere safe, such as a password manager. Each code works
        once, if you lose access to your authenticator app.
      </Alert>
      <ul
        aria-label="Recovery codes"
        className="grid max-w-md grid-cols-2 gap-2 font-mono text-base"
      >
        {codes.map((c) => (
          <li
            key={c}
            className="rounded-[10px] border border-line bg-surface-muted px-3 py-2 text-center"
          >
            {c}
          </li>
        ))}
      </ul>
      {href ? (
        <Button className="w-fit" onClick={() => window.location.assign(href)}>
          I&apos;ve saved them – continue
        </Button>
      ) : null}
    </div>
  );
}

export function MfaSetup() {
  const [setup, setSetup] = useState<{ qr: string; manualKey: string } | null>(
    null,
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [state, action] = useActionState(confirmMfaSetup, IDLE);

  if (state.status === "ok" && state.codes)
    return <RecoveryCodes codes={state.codes} href={state.href} />;

  if (!setup)
    return (
      <div className="flex flex-col gap-4">
        {startError ? (
          <Alert tone="danger" title={startError} role="alert" />
        ) : null}
        <Button
          className="w-fit"
          onClick={async () => {
            const r = await startMfaSetup();
            if (r.ok) setSetup({ qr: r.qr, manualKey: r.manualKey });
            else setStartError(r.message);
          }}
        >
          <ShieldCheck aria-hidden="true" />
          Set up authenticator app
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <ol className="list-decimal pl-5 text-sm">
        <li>
          Open an authenticator app (for example Microsoft Authenticator, Google
          Authenticator or 1Password).
        </li>
        <li>Scan the QR code, or enter the set-up key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-wrap items-start gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated on the server */}
        <img
          src={setup.qr}
          alt="QR code for adding TeamHappi to your authenticator app"
          width={200}
          height={200}
          className="rounded-[10px] border border-line bg-white p-2"
        />
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound aria-hidden="true" className="size-4" />
            Set-up key
          </p>
          <p
            data-testid="mfa-manual-key"
            className="font-mono text-base break-all"
          >
            {setup.manualKey}
          </p>
        </div>
      </div>
      <form action={action} className="flex flex-col gap-4" noValidate>
        {state.status === "error" ? (
          <Alert tone="danger" title={state.message} role="alert" />
        ) : null}
        <CodeField label="6-digit code" hint="From your authenticator app." />
        <div>
          <Submit label="Turn on MFA" />
        </div>
      </form>
    </div>
  );
}

export function MfaVerify({ next }: { next?: string }) {
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [state, action] = useActionState(verifyMfa, IDLE);
  useEffect(() => {
    if (state.status === "ok" && state.href) window.location.assign(state.href);
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="next" value={next ?? ""} />
      {state.status === "error" ? (
        <Alert tone="danger" title={state.message} role="alert" />
      ) : null}
      {state.status === "ok" ? (
        <Alert
          tone="success"
          title={state.message ?? "Verified."}
          role="status"
        />
      ) : null}
      {method === "totp" ? (
        <CodeField label="6-digit code" hint="From your authenticator app." />
      ) : (
        <CodeField
          label="Recovery code"
          hint="One of the codes you saved when you set up MFA. Each works once."
          recovery
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Verify" />
        <Button
          type="button"
          variant="link"
          onClick={() => setMethod(method === "totp" ? "recovery" : "totp")}
        >
          {method === "totp"
            ? "Use a recovery code instead"
            : "Use my authenticator app"}
        </Button>
      </div>
    </form>
  );
}

export function RegenerateRecoveryCodes() {
  const [state, setState] = useState<ActionState>(IDLE);
  if (state.status === "ok" && state.codes)
    return <RecoveryCodes codes={state.codes} />;
  return (
    <div className="flex flex-col gap-3">
      {state.status === "error" ? (
        <Alert tone="warning" title={state.message} role="alert">
          {state.stepUp ? (
            <a
              href="/platform/mfa/verify?next=/platform/security"
              className="font-semibold underline"
            >
              Verify now
            </a>
          ) : null}
        </Alert>
      ) : null}
      <Button
        variant="secondary"
        className="w-fit"
        onClick={async () => setState(await regenerateRecoveryCodes())}
      >
        Create new recovery codes
      </Button>
    </div>
  );
}
