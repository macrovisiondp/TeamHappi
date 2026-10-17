"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { safeNext } from "@/lib/navigation/next";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

import { FormField } from "./form-field";

type Notice = { kind: "error" | "info"; text: string } | null;

// Messages never say whether an email address is registered.
function noticeFor(status: number, code: string | undefined): Notice {
  if (status === 403 && code === "EMAIL_NOT_VERIFIED") {
    return {
      kind: "info",
      text: "Please verify your email address first. We've sent you a new link.",
    };
  }
  if (status === 429) {
    return {
      kind: "error",
      text: "Too many attempts. Please wait a minute and try again.",
    };
  }
  if (status === 400 || status === 401) {
    return { kind: "error", text: "Email or password is incorrect." };
  }
  return {
    kind: "error",
    text: "Sign-in isn't available right now. Please try again later.",
  };
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(
    params.get("verified") === "1"
      ? { kind: "info", text: "Email verified. You can now sign in." }
      : null,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
          callbackURL: "/sign-in?verified=1",
        }),
      });
      if (res.ok) {
        const next = safeNext(params.get("next"));
        router.replace(
          (next
            ? `/continue?next=${encodeURIComponent(next)}`
            : "/continue") as never,
        );
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      setNotice(noticeFor(res.status, body.code));
    } catch {
      setNotice(noticeFor(0, undefined));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      // POST, never GET: if submitted before JavaScript loads, credentials must
      // not end up in the URL, browser history or server logs.
      method="post"
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField
        id="email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="username"
        required
      />
      <FormField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <div aria-live="polite" className="min-h-6 text-sm">
        {notice ? (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={
              notice.kind === "error" ? "text-destructive" : "text-foreground"
            }
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Haven&apos;t verified your email?{" "}
        <Link
          href="/verify-email"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Send a new link
        </Link>
      </p>
    </form>
  );
}
