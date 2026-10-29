"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  applyOnlineAction,
  type PublicApplyState,
} from "./public-apply-actions";

// The online application form on a shared vacancy (M9.3). It only collects
// input; the server checks every value and the file again.

const IDLE: PublicApplyState = { status: "idle" };

function Send() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? "Sending…" : "Send application"}
    </Button>
  );
}

const describedBy = (id: string, hint: boolean, error?: string) =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;

export function PublicApplyForm({
  code,
  organisation,
  retentionMonths,
  cvUploads,
}: {
  code: string;
  organisation: string;
  retentionMonths: number;
  cvUploads: boolean;
}) {
  const [state, action] = useActionState(applyOnlineAction, IDLE);
  const summary = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error") summary.current?.focus();
    if (state.status === "received") done.current?.focus();
  }, [state]);

  if (state.status === "received")
    return (
      <div ref={done} tabIndex={-1} className="outline-none">
        <Alert
          tone="success"
          title={`Thank you. ${organisation} has your application.`}
          role="status"
        >
          <p>
            They&rsquo;ll contact you if they&rsquo;d like to take it further.
          </p>
          {state.cv === "failed" ? (
            <p className="mt-2">
              We couldn&rsquo;t attach your CV. Your application was still sent:
              you can bring your CV along or give it to them directly.
            </p>
          ) : null}
        </Alert>
      </div>
    );

  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="code" value={code} />
      <div ref={summary} tabIndex={-1} className="outline-none">
        {state.status === "error" ? (
          <Alert tone="danger" title="There's a problem" role="alert">
            <p>{state.message}</p>
          </Alert>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="apply-givenName" label="First name" error={e.givenName}>
          <Input
            id="apply-givenName"
            name="givenName"
            autoComplete="given-name"
            required
            maxLength={100}
            aria-invalid={!!e.givenName}
            aria-describedby={describedBy(
              "apply-givenName",
              false,
              e.givenName,
            )}
          />
        </Field>
        <Field id="apply-familyName" label="Last name" error={e.familyName}>
          <Input
            id="apply-familyName"
            name="familyName"
            autoComplete="family-name"
            required
            maxLength={100}
            aria-invalid={!!e.familyName}
            aria-describedby={describedBy(
              "apply-familyName",
              false,
              e.familyName,
            )}
          />
        </Field>
        <Field id="apply-email" label="Email address" error={e.email}>
          <Input
            id="apply-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            aria-invalid={!!e.email}
            aria-describedby={describedBy("apply-email", false, e.email)}
          />
        </Field>
        <Field id="apply-phone" label="Phone number (optional)" error={e.phone}>
          <Input
            id="apply-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            aria-invalid={!!e.phone}
            aria-describedby={describedBy("apply-phone", false, e.phone)}
          />
        </Field>
      </div>
      {cvUploads ? (
        <Field
          id="apply-cv"
          label="CV (optional)"
          hint="PDF or Word (.docx), up to 4 MB."
          error={e.cv}
        >
          <input
            id="apply-cv"
            name="cv"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-invalid={!!e.cv}
            aria-describedby={describedBy("apply-cv", true, e.cv)}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-[10px] file:border file:border-line-strong file:bg-surface file:px-4 file:font-semibold"
          />
        </Field>
      ) : null}
      {/* Trap for bots: hidden from people and from screen readers. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor="apply-website">Website</label>
        <input
          id="apply-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <details className="rounded-[10px] border border-line p-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Privacy notice: how {organisation} uses your details
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p>
            {organisation} is responsible for the details you send here (the
            data controller). They use them only to consider you for this role
            and to contact you about it. TeamHappi stores them securely on their
            behalf.
          </p>
          <p>
            Only people at {organisation} who handle recruitment for this role
            can see your application and CV. Your details aren&rsquo;t sold or
            shared for marketing.
          </p>
          <p>
            If you aren&rsquo;t hired, your details are kept for about{" "}
            {retentionMonths} months after the application closes and then
            removed. If you are hired, they become part of your employee record.
          </p>
          <p>
            You can ask {organisation} to see, correct or delete your details at
            any time. You can also complain to the Information
            Commissioner&rsquo;s Office (ico.org.uk).
          </p>
        </div>
      </details>
      <div className="flex flex-col gap-1.5">
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            id="apply-consent"
            required
            aria-invalid={!!e.consent}
            aria-describedby={e.consent ? "apply-consent-error" : undefined}
            className="mt-0.5 size-5 shrink-0 accent-[var(--brand-forest)]"
          />
          <span className="text-sm font-semibold">
            I&rsquo;ve read the privacy notice and want {organisation} to
            consider my application.
          </span>
        </label>
        {e.consent ? (
          <p
            id="apply-consent-error"
            role="alert"
            className="text-sm font-medium text-danger"
          >
            {e.consent}
          </p>
        ) : null}
      </div>
      <div>
        <Send />
      </div>
    </form>
  );
}
