"use client";

import {
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  Circle,
  Lock,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type {
  CoursePage,
  LearnerCourse,
  LearnerQuestion,
  QuizResult,
} from "@/modules/training";

import {
  startFinalAction,
  submitFinalAction,
  submitModuleQuizAction,
} from "./course-actions";

// The course player (M15). Pages and practice activities run in the browser;
// quizzes and the final are marked on the server, which also chooses the
// final's questions. Course text is plain text with **bold** only.

/** Plain text with **bold**; never HTML. */
export function Rich({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

type View =
  | { kind: "dash" }
  | { kind: "module"; i: number; page: number }
  | { kind: "quiz"; i: number }
  | { kind: "final" };

export function CourseRunner({ course }: { course: LearnerCourse }) {
  const [view, setView] = useState<View>({ kind: "dash" });
  const [review, setReview] = useState(false);
  const go = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  if (view.kind === "module") {
    const m = course.modules[view.i]!;
    const page = m.pages[view.page]!;
    const last = view.page === m.pages.length - 1;
    return (
      <div className="flex flex-col gap-4">
        <BackToCourse onClick={() => go({ kind: "dash" })} />
        <p className="text-sm font-semibold text-ink-muted">
          Module {view.i + 1} of {course.modules.length} · page {view.page + 1}{" "}
          of {m.pages.length}
        </p>
        <Card className="gap-4">
          <CardTitle>
            <Rich text={page.h} />
          </CardTitle>
          <PageBody page={page} />
        </Card>
        <div className="flex flex-wrap justify-between gap-3">
          <Button
            variant="secondary"
            disabled={view.page === 0}
            onClick={() => go({ ...view, page: view.page - 1 })}
          >
            <ArrowLeft aria-hidden="true" />
            Previous
          </Button>
          {!last ? (
            <Button onClick={() => go({ ...view, page: view.page + 1 })}>
              Next
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : m.quiz.length ? (
            <Button onClick={() => go({ kind: "quiz", i: view.i })}>
              Take the module quiz
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button onClick={() => go({ kind: "dash" })}>
              Back to the course
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (view.kind === "quiz") {
    const m = course.modules[view.i]!;
    return (
      <div className="flex flex-col gap-4">
        <BackToCourse onClick={() => go({ kind: "dash" })} />
        <Card className="gap-1">
          <CardTitle>{m.title}: quiz</CardTitle>
          <CardDescription>
            Pass mark {course.final.modulePassPercent}%. You see the
            explanations after you submit, and you can try again.
          </CardDescription>
        </Card>
        <Quiz
          key={`m${view.i}`}
          questions={m.quiz}
          submit={(answers) =>
            submitModuleQuizAction(course.courseId, view.i, answers)
          }
          onDone={() => go({ kind: "dash" })}
        />
      </div>
    );
  }

  if (view.kind === "final")
    return (
      <div className="flex flex-col gap-4">
        <BackToCourse onClick={() => go({ kind: "dash" })} />
        <FinalAssessment course={course} onDone={() => go({ kind: "dash" })} />
      </div>
    );

  const done = course.modules.filter((m) => m.passed).length;
  const showModules = course.state === "learning" || review;
  return (
    <div className="flex flex-col gap-5">
      {course.state === "complete" ? (
        <Alert tone="success" title="You've completed this course">
          {course.status.expiresOn
            ? `It's valid until ${formatDate(course.status.expiresOn)}.`
            : "It doesn't expire."}{" "}
          {course.certificateRecordId ? (
            <a
              className="font-semibold underline"
              href={`/training/certificate/${course.certificateRecordId}`}
            >
              Download your certificate
            </a>
          ) : null}
        </Alert>
      ) : null}
      {course.state === "awaiting_signoff" ? (
        <Alert tone="info" title="You've passed. Practical sign-off is next">
          <Rich text={course.practical ?? ""} /> Your manager or trainer signs
          it off in TeamHappi, then your course is complete.
        </Alert>
      ) : null}

      {course.intro ? (
        <Card className="gap-3">
          <p className="text-base">
            <Rich text={course.intro} />
          </p>
          <div className="flex flex-wrap gap-2">
            {course.minutes ? (
              <Badge tone="neutral" icon={null}>
                About {course.minutes} minutes
              </Badge>
            ) : null}
            <Badge tone="neutral" icon={null}>
              Final pass mark {course.final.passPercent}%
            </Badge>
          </div>
          {course.outcomes.length ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                What you&rsquo;ll learn
              </summary>
              <ul className="ml-5 list-disc text-base">
                {course.outcomes.map((o) => (
                  <li key={o}>
                    <Rich text={o} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {course.law ? (
            <p className="text-sm text-ink-muted">
              <Rich text={course.law} />
            </p>
          ) : null}
        </Card>
      ) : null}

      {!showModules ? (
        <Button variant="secondary" onClick={() => setReview(true)}>
          Look through the course again
        </Button>
      ) : (
        <>
          <section
            aria-labelledby="modules-heading"
            className="flex flex-col gap-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="modules-heading" className="text-lg font-semibold">
                Modules
              </h2>
              <span className="text-sm text-ink-muted">
                {done} of {course.modules.length} done
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Modules done"
              aria-valuemin={0}
              aria-valuemax={course.modules.length}
              aria-valuenow={done}
            >
              <div
                className="h-full bg-forest"
                style={{
                  width: `${(done / Math.max(1, course.modules.length)) * 100}%`,
                }}
              />
            </div>
            <ol className="flex flex-col gap-3">
              {course.modules.map((m, i) => (
                <li key={i}>
                  <Card className="gap-2">
                    <div className="flex items-start gap-3">
                      <span aria-hidden="true" className="text-2xl">
                        {m.icon || "📘"}
                      </span>
                      <div className="flex flex-1 flex-col gap-1">
                        <span className="font-semibold">
                          {i + 1}. {m.title}
                        </span>
                        {m.blurb ? (
                          <span className="text-sm text-ink-muted">
                            {m.blurb}
                          </span>
                        ) : null}
                        <span className="flex items-center gap-1.5 text-sm">
                          {m.passed && m.quiz.length ? (
                            <>
                              <CheckCircle2
                                aria-hidden="true"
                                className="size-4 text-forest"
                              />
                              Quiz passed
                              {m.bestPercent !== null
                                ? ` (${m.bestPercent}%)`
                                : ""}
                            </>
                          ) : m.quiz.length ? (
                            <>
                              <Circle aria-hidden="true" className="size-4" />
                              {m.bestPercent !== null
                                ? `Quiz not passed yet (best ${m.bestPercent}%)`
                                : "Quiz to do"}
                            </>
                          ) : (
                            "Practice: no quiz"
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => go({ kind: "module", i, page: 0 })}
                      >
                        {m.passed && m.quiz.length ? "Read again" : "Open"}
                      </Button>
                      {m.quiz.length ? (
                        <Button
                          variant="secondary"
                          onClick={() => go({ kind: "quiz", i })}
                        >
                          {m.passed ? "Retake quiz" : "Go to quiz"}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <Card aria-labelledby="final-heading" className="gap-2">
            <CardTitle id="final-heading" className="flex items-center gap-2">
              <Award aria-hidden="true" className="size-5" />
              Final assessment
            </CardTitle>
            <CardDescription>
              {course.final.count} questions from the whole course · pass mark{" "}
              {course.final.passPercent}% · every safety question must be right.
              Each attempt uses a new mix of questions.
            </CardDescription>
            {course.final.attempts ? (
              <p className="text-sm">
                Attempts: {course.final.attempts}
                {course.final.bestPercent !== null
                  ? ` · best ${course.final.bestPercent}%`
                  : ""}
              </p>
            ) : null}
            {course.state === "awaiting_signoff" ? (
              <p className="text-sm font-semibold">Passed.</p>
            ) : course.final.unlocked ? (
              <Button className="w-fit" onClick={() => go({ kind: "final" })}>
                Start the final assessment
              </Button>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <Lock aria-hidden="true" className="size-4" />
                Unlocks when you&rsquo;ve passed every module quiz.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function BackToCourse({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to the course
    </button>
  );
}

// --- Pages ---------------------------------------------------------------------------

function PageBody({ page }: { page: CoursePage }) {
  if ("body" in page)
    return (
      <div className="flex flex-col gap-3 text-base">
        {page.body.map((el, k) =>
          typeof el === "string" ? (
            <p key={k}>
              <Rich text={el} />
            </p>
          ) : "key" in el ? (
            <p
              key={k}
              className="rounded-[10px] border-l-4 border-forest bg-forest/5 p-3 font-semibold"
            >
              <Rich text={el.key} />
            </p>
          ) : "b" in el ? (
            <ul key={k} className="ml-5 list-disc">
              {el.b.map((x, j) => (
                <li key={j}>
                  <Rich text={x} />
                </li>
              ))}
            </ul>
          ) : (
            <div key={k} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {el.table.head.map((h, j) => (
                      <th
                        key={j}
                        className="border-b border-line p-2 text-left"
                      >
                        <Rich text={h} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {el.table.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((cell, c) => (
                        <td
                          key={c}
                          className="border-b border-line p-2 align-top"
                        >
                          <Rich text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        )}
      </div>
    );
  if ("scenario" in page) return <Scenario s={page.scenario} />;
  return (
    <div className="flex flex-col gap-4">
      {page.interact.flip ? <Flip f={page.interact.flip} /> : null}
      {page.interact.classify ? <Classify c={page.interact.classify} /> : null}
    </div>
  );
}

type Interact = Extract<CoursePage, { interact: unknown }>["interact"];

function Flip({ f }: { f: NonNullable<Interact["flip"]> }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base">
        <Rich text={f.prompt} />
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {f.cards.map(([icon, title, back], i) => {
          const shown = open.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                aria-expanded={shown}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
                className="flex min-h-16 w-full flex-col items-start gap-1 rounded-[10px] border border-line p-3 text-left"
              >
                <span className="font-semibold">
                  <span aria-hidden="true">{icon} </span>
                  <Rich text={title} />
                </span>
                {shown ? (
                  <span className="text-sm">
                    <Rich text={back} />
                  </span>
                ) : (
                  <span className="text-sm text-ink-muted">Tap to reveal</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Classify({ c }: { c: NonNullable<Interact["classify"]> }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const right = c.items.filter(([, bin], i) => picked[i] === bin).length;
  const answered = Object.keys(picked).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base">
        <Rich text={c.prompt} />
      </p>
      <ul className="flex flex-col gap-3">
        {c.items.map(([label, bin], i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-[10px] border border-line p-3"
          >
            <span>
              <Rich text={label} />
            </span>
            <div className="flex flex-wrap gap-2">
              {c.bins.map((b, j) => (
                <Button
                  key={j}
                  variant={picked[i] === j ? "primary" : "secondary"}
                  onClick={() => setPicked((p) => ({ ...p, [i]: j }))}
                  aria-pressed={picked[i] === j}
                >
                  {b}
                </Button>
              ))}
            </div>
            {picked[i] !== undefined ? (
              <span className="flex items-center gap-1.5 text-sm">
                {picked[i] === bin ? (
                  <>
                    <CheckCircle2
                      aria-hidden="true"
                      className="size-4 text-forest"
                    />
                    Right
                  </>
                ) : (
                  <>
                    <XCircle
                      aria-hidden="true"
                      className="size-4 text-danger"
                    />
                    Not quite: it&rsquo;s {c.bins[bin]}
                  </>
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {answered === c.items.length ? (
        <p className="font-semibold">
          {right} of {c.items.length} right. This is practice; it isn&rsquo;t
          marked.
        </p>
      ) : null}
    </div>
  );
}

function Scenario({
  s,
}: {
  s: Extract<CoursePage, { scenario: unknown }>["scenario"];
}) {
  const [pick, setPick] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base">
        <Rich text={s.text} />
      </p>
      <p className="font-semibold">What would you do?</p>
      <ul className="flex flex-col gap-2">
        {s.options.map((o, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setPick(i)}
              aria-pressed={pick === i}
              className={`min-h-11 w-full rounded-[10px] border p-3 text-left ${
                pick === i ? "border-forest bg-forest/5" : "border-line"
              }`}
            >
              <Rich text={o.t} />
            </button>
            {pick === i ? (
              <p className="mt-2 flex items-start gap-1.5 text-sm">
                {o.ok ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-forest"
                  />
                ) : (
                  <XCircle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-danger"
                  />
                )}
                <span>
                  <strong>
                    {o.ok ? "Best choice. " : "Not the best choice. "}
                  </strong>
                  <Rich text={o.fb} />
                </span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Quizzes ---------------------------------------------------------------------------

type Ans = number | boolean | number[] | null;

function Quiz({
  questions,
  submit,
  onDone,
  final = false,
  onRetry,
}: {
  questions: LearnerQuestion[];
  submit: (
    answers: Ans[],
  ) => Promise<{ ok: true; data: QuizResult } | { ok: false; message: string }>;
  onDone: () => void;
  final?: boolean;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Ans[]>(() =>
    questions.map(() => null),
  );
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const missing = answers.filter(
    (a) => a === null || (Array.isArray(a) && a.length === 0),
  ).length;
  const set = (i: number, a: Ans) =>
    setAnswers((xs) => xs.map((x, k) => (k === i ? a : x)));

  const onSubmit = () =>
    start(async () => {
      setError(null);
      const r = await submit(answers);
      if (!r.ok) return setError(r.message);
      setResult(r.data);
      window.scrollTo({ top: 0 });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {result ? (
        <Alert
          tone={result.passed ? "success" : "warning"}
          title={
            result.passed
              ? `Passed: ${result.scorePercent}%`
              : `Not passed yet: ${result.scorePercent}%`
          }
        >
          {result.correct} of {result.total} right.
          {result.safetyMissed
            ? ` ${result.safetyMissed} safety question${result.safetyMissed === 1 ? " was" : "s were"} wrong; every safety question must be right.`
            : ""}
          {result.completed ? " Course complete. Well done!" : ""}
          {result.awaitingSignOff ? " Your practical sign-off is next." : ""}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="That didn't work">
          {error}
        </Alert>
      ) : null}
      <ol className="flex flex-col gap-3">
        {questions.map((q, i) => {
          const fb = result?.feedback[i];
          const name = `q${i}`;
          return (
            <li key={i}>
              <Card className="gap-3">
                <fieldset className="flex flex-col gap-2" disabled={!!result}>
                  <legend className="mb-2 text-base font-semibold">
                    {i + 1}. <Rich text={q.q} />
                    {q.type === "multi" ? (
                      <span className="ml-2 text-sm font-normal text-ink-muted">
                        (select all that apply)
                      </span>
                    ) : null}
                    {final && q.safety ? (
                      <Badge tone="danger" icon={null} className="ml-2">
                        Safety question
                      </Badge>
                    ) : null}
                  </legend>
                  {q.type === "tf"
                    ? [true, false].map((v) => (
                        <label
                          key={String(v)}
                          className="flex min-h-11 items-center gap-3"
                        >
                          <input
                            type="radio"
                            name={name}
                            checked={answers[i] === v}
                            onChange={() => set(i, v)}
                            className="size-5 accent-[var(--brand-forest)]"
                          />
                          {v ? "True" : "False"}
                        </label>
                      ))
                    : q.options.map((o, k) => {
                        const multi = q.type === "multi";
                        const cur = answers[i];
                        const checked = multi
                          ? Array.isArray(cur) && cur.includes(k)
                          : cur === k;
                        return (
                          <label
                            key={k}
                            className="flex min-h-11 items-center gap-3"
                          >
                            <input
                              type={multi ? "checkbox" : "radio"}
                              name={name}
                              checked={checked}
                              onChange={() =>
                                set(
                                  i,
                                  multi
                                    ? checked
                                      ? (cur as number[]).filter((x) => x !== k)
                                      : [...(Array.isArray(cur) ? cur : []), k]
                                    : k,
                                )
                              }
                              className="size-5 shrink-0 accent-[var(--brand-forest)]"
                            />
                            <span>
                              <Rich text={o} />
                            </span>
                          </label>
                        );
                      })}
                </fieldset>
                {fb ? (
                  <p className="flex items-start gap-1.5 text-sm">
                    {fb.correct ? (
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-forest"
                      />
                    ) : (
                      <XCircle
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-danger"
                      />
                    )}
                    <span>
                      <strong>
                        {fb.correct ? "Correct. " : "Not quite. "}
                      </strong>
                      <Rich text={fb.why} />
                    </span>
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ol>
      {result ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={onDone}>Back to the course</Button>
          {!result.passed ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (onRetry) return onRetry();
                setResult(null);
                setAnswers(questions.map(() => null));
                window.scrollTo({ top: 0 });
              }}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {missing ? (
            <p className="text-sm text-ink-muted">
              {missing} question{missing === 1 ? "" : "s"} still to answer.
            </p>
          ) : null}
          <Button
            className="w-fit"
            disabled={pending || missing > 0}
            onClick={onSubmit}
          >
            {pending
              ? "Marking…"
              : final
                ? "Submit the final assessment"
                : "Submit quiz"}
          </Button>
        </div>
      )}
    </div>
  );
}

function FinalAssessment({
  course,
  onDone,
}: {
  course: LearnerCourse;
  onDone: () => void;
}) {
  const [attempt, setAttempt] = useState<{
    attemptId: string;
    questions: LearnerQuestion[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const begin = () =>
    start(async () => {
      setError(null);
      const r = await startFinalAction(course.courseId);
      if (!r.ok) return setError(r.message);
      setAttempt(r.data);
      window.scrollTo({ top: 0 });
    });

  if (!attempt)
    return (
      <Card className="gap-3">
        <CardTitle>Final assessment</CardTitle>
        <CardDescription>
          {course.final.count} questions from the whole course. You need{" "}
          {course.final.passPercent}%, and every question marked{" "}
          <strong>safety question</strong> must be right. Answer within 3 hours
          of starting.
        </CardDescription>
        {error ? (
          <Alert tone="danger" title="That didn't work">
            {error}
          </Alert>
        ) : null}
        <Button className="w-fit" disabled={pending} onClick={begin}>
          {pending ? "Preparing…" : "Start"}
        </Button>
      </Card>
    );
  return (
    <Quiz
      key={attempt.attemptId}
      final
      questions={attempt.questions}
      submit={(answers) =>
        submitFinalAction(course.courseId, attempt.attemptId, answers)
      }
      onDone={onDone}
      onRetry={() => {
        setAttempt(null);
        window.scrollTo({ top: 0 });
      }}
    />
  );
}
