"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

import { FormField } from "./form-field";

export function ResendVerificationForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const res = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          callbackURL: "/sign-in?verified=1",
        }),
      });
      // The same message whether or not the address is registered.
      setMessage(
        res.status === 429
          ? "Too many requests. Please wait a few minutes and try again."
          : "If that address has an account waiting for verification, we've sent a new link.",
      );
    } catch {
      setMessage("Something went wrong. Please try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4">
      <FormField
        id="email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
      />
      <div aria-live="polite" className="min-h-6 text-sm">
        {message ? <p role="status">{message}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send a new link"}
      </Button>
      <Link
        href="/sign-in"
        className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Back to sign in
      </Link>
    </form>
  );
}
