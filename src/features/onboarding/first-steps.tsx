"use client";

import {
  ArrowRight,
  Check,
  FileSignature,
  GraduationCap,
  Lock,
  PartyPopper,
  PlayCircle,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/ui/confetti";
import type { StepFacts } from "@/lib/first-steps";
import { cn } from "@/lib/utils";

// "Your first steps" (M19): one step at a time, a progress bar that fills as
// each is done, and confetti when everything is complete. Each step's work
// happens right here (the forms are passed in), so the page moves on by
// itself after a save.

type StepKey = "about" | "documents" | "training";

const STEPS: { key: StepKey; title: string; icon: typeof UserRound }[] = [
  { key: "about", title: "About you", icon: UserRound },
  { key: "documents", title: "Sign your documents", icon: FileSignature },
  { key: "training", title: "Start your training", icon: GraduationCap },
];

export function FirstSteps({
  employeeId,
  firstName,
  organisation,
  facts,
  about,
  documents,
}: {
  employeeId: string;
  firstName: string;
  organisation: string;
  facts: StepFacts;
  /** The details form (step 1). */
  about: ReactNode;
  /** The documents list, to open and sign (step 2). */
  documents: ReactNode;
}) {
  const done: Record<StepKey, boolean> = {
    about: facts.about.done,
    documents: facts.documents.done,
    training: facts.training.done,
  };
  const firstOpen = STEPS.find((s) => !done[s.key])?.key ?? "training";
  const [open, setOpen] = useState<StepKey>(firstOpen);
  const [celebrate, setCelebrate] = useState(false);
  const pct = Math.round((facts.completed / 3) * 100);

  useEffect(() => {
    if (!facts.allDone) return;
    const key = `teamhappi:first-steps-done:${employeeId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: celebrate anyway.
    }
    const t = window.setTimeout(() => setCelebrate(true), 300);
    return () => window.clearTimeout(t);
  }, [facts.allDone, employeeId]);

  if (facts.allDone)
    return (
      <div className="flex flex-col items-center gap-5 py-10 text-center">
        <Confetti run={celebrate} />
        <span className="grid size-20 place-items-center rounded-full bg-forest text-white shadow-lg motion-safe:animate-[pop_0.5s_ease-out]">
          <PartyPopper aria-hidden="true" className="size-10" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">
            You&rsquo;re all set, {firstName}!
          </h1>
          <p className="max-w-md text-base text-ink-muted">
            Your details are in, your documents are signed and your training is
            done. Welcome to the team at {organisation}.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/rota/me">
              See my shifts
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/dashboard?welcome=done">Go to my dashboard</Link>
          </Button>
        </div>
        <button
          type="button"
          onClick={() => {
            setCelebrate(false);
            window.setTimeout(() => setCelebrate(true), 50);
          }}
          className="text-sm text-ink-muted underline-offset-4 hover:underline"
        >
          Celebrate again
        </button>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-forest">
          Welcome to {organisation}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Hi {firstName}, let&rsquo;s get you ready
        </h1>
        <p className="text-base text-ink-muted">
          Three short steps before your first shift. You can come back to them
          any time.
        </p>
        <div className="flex items-center gap-3">
          <div
            className="h-3 flex-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Your first steps"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={facts.completed}
          >
            <div
              className="h-full rounded-full bg-forest transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
          <span className="text-sm font-semibold tabular-nums">
            {facts.completed} of 3 done
          </span>
        </div>
      </header>

      <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => {
          const isOpen = open === s.key;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setOpen(s.key)}
                aria-current={isOpen ? "step" : undefined}
                className={cn(
                  "flex w-full flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all duration-300",
                  isOpen
                    ? "border-forest bg-sage shadow-sm"
                    : "border-line bg-surface hover:border-forest/40",
                )}
              >
                <span
                  className={cn(
                    "grid size-9 place-items-center rounded-full text-sm font-bold transition-all duration-500",
                    done[s.key]
                      ? "bg-forest text-white motion-safe:animate-[pop_0.4s_ease-out]"
                      : isOpen
                        ? "bg-forest/15 text-forest"
                        : "bg-line text-ink-muted",
                  )}
                >
                  {done[s.key] ? (
                    <Check aria-hidden="true" className="size-5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="text-xs font-semibold sm:text-sm">
                  {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <section
        key={open}
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm motion-safe:animate-[rise_0.35s_ease-out]"
      >
        {open === "about" ? (
          <StepBody
            done={done.about}
            title="Tell us about you"
            text={
              done.about
                ? "Thanks, your details are saved. You can change them here any time."
                : `We need your ${facts.about.missing.join(", ")}. Only you and HR can see them.`
            }
            next={done.about ? () => setOpen("documents") : undefined}
          >
            {about}
          </StepBody>
        ) : null}
        {open === "documents" ? (
          <StepBody
            done={done.documents}
            title="Read and sign your documents"
            text={
              done.documents
                ? facts.documents.signed
                  ? `All ${facts.documents.signed} signed. Thank you.`
                  : "Nothing to sign right now. Your manager will send anything you need."
                : `${facts.documents.toSign} to sign${facts.documents.contractWaiting ? ", including your contract" : ""}. Open each one, read it, then sign by typing your name.`
            }
            next={done.documents ? () => setOpen("training") : undefined}
          >
            {documents}
          </StepBody>
        ) : null}
        {open === "training" ? (
          <StepBody
            done={done.training}
            title="Start your training"
            text={
              facts.training.total === 0
                ? "No training is required for you yet."
                : `${facts.training.complete} of ${facts.training.total} required courses done.`
            }
          >
            {!done.about || !done.documents ? (
              <p className="flex items-center gap-2 rounded-lg bg-sage/60 p-3 text-sm">
                <Lock aria-hidden="true" className="size-4 shrink-0" />
                Finish steps 1 and 2 first, then your training opens here.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {facts.training.courses.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {c.complete ? (
                        <Check
                          aria-hidden="true"
                          className="size-4 text-forest"
                        />
                      ) : null}
                      {c.name}
                    </span>
                    {c.complete ? (
                      <span className="text-sm text-forest">Done</span>
                    ) : c.interactive ? (
                      <Button asChild size="sm">
                        <Link href={`/training/me/${c.id}`}>
                          <PlayCircle aria-hidden="true" />
                          Start
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="secondary">
                        <Link href="/training/me">Open</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </StepBody>
        ) : null}
      </section>

      <p className="text-center text-sm text-ink-muted">
        Need to check your shifts first?{" "}
        <Link
          href="/rota/me"
          className="font-semibold text-forest underline-offset-4 hover:underline"
        >
          See my shifts
        </Link>{" "}
        ·{" "}
        <Link
          href="/dashboard?welcome=later"
          className="font-semibold text-forest underline-offset-4 hover:underline"
        >
          Do this later
        </Link>
      </p>
    </div>
  );
}

function StepBody({
  done,
  title,
  text,
  next,
  children,
}: {
  done: boolean;
  title: string;
  text: string;
  next?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-ink-muted">{text}</p>
        </div>
        {done ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-forest px-3 py-1 text-xs font-semibold text-white">
            <Check aria-hidden="true" className="size-3.5" />
            Done
          </span>
        ) : null}
      </div>
      {children}
      {next ? (
        <Button className="w-fit self-end" onClick={next}>
          Next step
          <ArrowRight aria-hidden="true" />
        </Button>
      ) : null}
    </>
  );
}
