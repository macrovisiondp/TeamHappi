"use client";

import { FileText } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

import {
  lookupOfferAction,
  respondOfferAction,
  type PublicOfferState,
} from "./actions";

// The applicant's offer page (M14.3). The token is in the URL fragment, which
// browsers never send to servers; it's read here and passed only in POST
// bodies. Nothing here decides anything: the database does.

type Offer = Awaited<ReturnType<typeof lookupOfferAction>>;

function Submit({
  label,
  variant,
}: {
  label: string;
  variant?: "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant ?? "primary"} disabled={pending}>
      {pending ? "Sending…" : label}
    </Button>
  );
}

const ukDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso));

export function PublicOffer() {
  const id = useId();
  const [token, setToken] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [declining, setDeclining] = useState(false);
  const [state, action] = useActionState(respondOfferAction, {
    status: "idle",
  } as PublicOfferState);

  useEffect(() => {
    const t = window.location.hash.slice(1);
    void lookupOfferAction(t).then((o) => {
      setToken(t);
      setOffer(o);
    });
  }, []);
  useEffect(() => {
    if (state.status === "done" && token)
      void lookupOfferAction(token).then(setOffer);
  }, [state, token]);

  if (!offer)
    return <p className="text-sm text-ink-muted">Opening your offer…</p>;
  if (offer.state === "missing")
    return (
      <Alert tone="danger" title="This offer link isn't valid">
        Check you used the whole link from the email, or contact the employer.
      </Alert>
    );

  const e = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const fileForm = (label: string) => (
    <form method="post" action="/offer/file" target="_blank">
      <input type="hidden" name="token" value={token ?? ""} />
      <Button type="submit" variant="secondary">
        <FileText aria-hidden="true" />
        {label}
      </Button>
    </form>
  );

  return (
    <Card aria-labelledby={`offer-${id}`} className="gap-4">
      <CardTitle id={`offer-${id}`}>
        {offer.organisation}: {offer.title}
      </CardTitle>
      {offer.state === "open" ? (
        <>
          <CardDescription>
            Hello {offer.firstName}. Please read your offer letter, then accept
            or decline it. This link works until {ukDate(offer.expiresAt)}.
          </CardDescription>
          {fileForm("Read the offer letter")}
          {state.status === "error" ? (
            <Alert tone="danger" title={state.message} role="alert" />
          ) : null}
          {!declining ? (
            <form action={action} className="flex flex-col gap-3">
              <input type="hidden" name="token" value={token ?? ""} />
              <input type="hidden" name="decision" value="accept" />
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="agree"
                  required
                  className="mt-0.5 size-5"
                />
                <span>
                  I have read this offer and I accept it. I agree to sign it
                  electronically.
                </span>
              </label>
              {e.agree ? (
                <p className="text-sm text-danger">{e.agree}</p>
              ) : null}
              <Field
                id={`name-${id}`}
                label="Type your full name to accept"
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
              <div className="flex flex-wrap gap-3">
                <Submit label="Accept the offer" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeclining(true)}
                >
                  Decline
                </Button>
              </div>
            </form>
          ) : (
            <form action={action} className="flex flex-col gap-3">
              <input type="hidden" name="token" value={token ?? ""} />
              <input type="hidden" name="decision" value="decline" />
              <p className="text-sm">
                Are you sure you want to decline this offer? You can&rsquo;t
                undo this here.
              </p>
              <div className="flex flex-wrap gap-3">
                <Submit label="Yes, decline" variant="danger" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeclining(false)}
                >
                  Go back
                </Button>
              </div>
            </form>
          )}
        </>
      ) : offer.state === "accepted" ? (
        <>
          <Alert
            tone="success"
            title="You've accepted this offer"
            role="status"
          >
            Thank you, {offer.firstName}. {offer.organisation} will be in touch
            about your start. Keep a copy of your signed offer.
          </Alert>
          {offer.hasSignedCopy ? fileForm("Download your signed offer") : null}
        </>
      ) : offer.state === "declined" ? (
        <Alert tone="info" title="You've declined this offer" role="status">
          {offer.organisation} has been told. Thank you for letting them know.
        </Alert>
      ) : offer.state === "expired" ? (
        <Alert tone="warning" title="This offer has expired">
          Contact {offer.organisation} if you&rsquo;re still interested.
        </Alert>
      ) : (
        <Alert tone="warning" title="This offer has been withdrawn">
          Contact {offer.organisation} if you have questions.
        </Alert>
      )}
    </Card>
  );
}
