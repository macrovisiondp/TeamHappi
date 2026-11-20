// Course files (M15, docs/architecture/m15-training-courses.md). Pure functions:
// strict validation of an imported course file, what a learner may see (never
// the answer key), grading, and the server's draw of final questions.
//
// Format "hotrock-course" v1: modules of pages (text, tables, key points,
// bullet lists, flip cards, sorting exercises, scenarios), a quiz per module,
// and a final-assessment pool with "safety questions" that must all be right.
// Text supports **bold** only; it's always shown as plain text.

import { randomInt } from "node:crypto";

import { z } from "zod";

import { CATEGORIES } from "./policy";

/** Largest course file accepted (bytes of JSON text). */
export const MAX_COURSE_FILE_BYTES = 500_000;

const text = (max: number) => z.string().trim().min(1).max(max);

const base = {
  q: text(600),
  why: text(1000),
  critical: z.boolean().optional(),
};
const options = z.array(text(300)).min(2).max(8);

const questionSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("single"),
      ...base,
      options,
      answer: z.number().int().min(0),
    }),
    z.object({ type: z.literal("tf"), ...base, answer: z.boolean() }),
    z.object({
      type: z.literal("multi"),
      ...base,
      options,
      answer: z.array(z.number().int().min(0)).min(1).max(8),
    }),
  ])
  .superRefine((q, ctx) => {
    const n = q.type === "tf" ? 2 : q.options.length;
    const bad =
      q.type === "single"
        ? q.answer >= n
        : q.type === "multi"
          ? q.answer.some((a) => a >= n) ||
            new Set(q.answer).size !== q.answer.length
          : false;
    if (bad)
      ctx.addIssue({
        code: "custom",
        message: "An answer points to an option that doesn't exist",
      });
  });

const element = z.union([
  text(4000),
  z.object({
    table: z.object({
      head: z.array(text(200)).min(1).max(8),
      rows: z.array(z.array(z.string().trim().max(1000)).max(8)).max(60),
    }),
  }),
  z.object({ key: text(1000) }),
  z.object({ b: z.array(text(1000)).min(1).max(30) }),
]);

const interact = z
  .object({
    title: text(200),
    classify: z
      .object({
        prompt: text(600),
        bins: z.array(text(60)).min(2).max(6),
        items: z
          .array(z.tuple([text(300), z.number().int().min(0)]))
          .min(1)
          .max(30),
      })
      .optional(),
    flip: z
      .object({
        prompt: text(600),
        cards: z
          .array(z.tuple([z.string().max(16), text(120), text(600)]))
          .min(1)
          .max(30),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.classify && !v.flip)
      ctx.addIssue({ code: "custom", message: "An activity needs content" });
    if (v.classify?.items.some(([, bin]) => bin >= v.classify!.bins.length))
      ctx.addIssue({ code: "custom", message: "A sorting item has no box" });
  });

const scenario = z
  .object({
    title: text(200),
    text: text(2000),
    options: z
      .array(z.object({ t: text(600), ok: z.boolean(), fb: text(1000) }))
      .min(2)
      .max(6),
  })
  .refine((s) => s.options.filter((o) => o.ok).length === 1, {
    message: "A scenario needs exactly one best answer",
  });

const page = z.union([
  z.object({ h: text(200), body: z.array(element).min(1).max(60) }),
  z.object({ h: text(200), interact }),
  z.object({ h: text(200), scenario }),
]);

const moduleSchema = z.object({
  title: text(200),
  icon: z.string().max(16).optional(),
  blurb: z.string().trim().max(400).optional(),
  pages: z.array(page).min(1).max(40),
  quiz: z.array(questionSchema).max(30),
});

const requirement = z.object({
  jobTitle: text(120),
  mandatory: z.boolean(),
  dueDays: z.number().int().min(0).max(365),
});

const fileSchema = z
  .object({
    format: z.literal("hotrock-course"),
    formatVersion: z.literal(1),
    code: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,20}$/, "The course code isn't valid"),
    name: text(120),
    kind: z.enum(["internal", "external"]),
    category: z.enum(CATEGORIES).optional(),
    validityMonths: z.number().int().min(1).max(120).nullable(),
    minutes: z.number().int().min(1).max(600).optional(),
    who: z.string().trim().max(400).optional(),
    intro: z.string().trim().max(2000).optional(),
    law: z.string().trim().max(1000).optional(),
    outcomes: z.array(text(300)).max(20).optional(),
    modules: z.array(moduleSchema).max(50).optional(),
    finalAssessment: z
      .object({
        pool: z.array(questionSchema).min(1).max(200),
        questions: z.number().int().min(1).max(100),
        passPercent: z.number().int().min(50).max(100),
        modulePassPercent: z.number().int().min(50).max(100),
      })
      .optional(),
    practical: z.string().trim().max(1000).nullable().optional(),
    requirements: z.array(requirement).max(30).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "external") return;
    if (!c.modules?.length)
      ctx.addIssue({ code: "custom", message: "The course has no modules" });
    const fa = c.finalAssessment;
    if (!fa) {
      ctx.addIssue({
        code: "custom",
        message: "The course has no final assessment",
      });
      return;
    }
    if (fa.questions > fa.pool.length)
      ctx.addIssue({
        code: "custom",
        message: "The final asks more questions than the pool has",
      });
    if (fa.pool.filter((q) => q.critical).length > fa.questions)
      ctx.addIssue({
        code: "custom",
        message: "There are more safety questions than final questions",
      });
  });

export type Question = z.infer<typeof questionSchema>;
export type CourseFile = z.infer<typeof fileSchema>;
export type CourseModule = z.infer<typeof moduleSchema>;
export type Page = z.infer<typeof page>;

/** What's stored for an interactive course (the validated file, internal only). */
export interface CoursePackage {
  code: string;
  name: string;
  minutes: number | null;
  who: string | null;
  intro: string | null;
  law: string | null;
  outcomes: string[];
  modules: CourseModule[];
  pool: Question[];
}

export type ParsedCourse =
  | {
      ok: true;
      file: CourseFile;
      /** Present for internal (interactive) courses. */
      pkg: CoursePackage | null;
      finalCount: number;
      passPercent: number;
      modulePassPercent: number;
      practical: string | null;
    }
  | { ok: false; message: string };

/** Parses and strictly validates a course file's text. Never throws. */
export function parseCourseFile(raw: string): ParsedCourse {
  if (Buffer.byteLength(raw, "utf8") > MAX_COURSE_FILE_BYTES)
    return { ok: false, message: "The file is too large (500 KB at most)." };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: "This isn't a course file (not JSON)." };
  }
  const r = fileSchema.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    const where = i?.path.length ? ` (at ${i.path.join(".")})` : "";
    return {
      ok: false,
      message: `This course file isn't valid: ${i?.message ?? "unknown problem"}${where}.`,
    };
  }
  const f = r.data;
  const fa = f.finalAssessment;
  const pkg: CoursePackage | null =
    f.kind === "internal" && fa
      ? {
          code: f.code,
          name: f.name,
          minutes: f.minutes ?? null,
          who: f.who || null,
          intro: f.intro || null,
          law: f.law || null,
          outcomes: f.outcomes ?? [],
          modules: f.modules ?? [],
          pool: fa.pool,
        }
      : null;
  return {
    ok: true,
    file: f,
    pkg,
    finalCount: fa?.questions ?? 1,
    passPercent: fa?.passPercent ?? 80,
    modulePassPercent: fa?.modulePassPercent ?? 75,
    practical: f.practical || null,
  };
}

// --- What learners see -------------------------------------------------------------

export type LearnerQuestion =
  | { type: "single" | "multi"; q: string; options: string[]; safety: boolean }
  | { type: "tf"; q: string; safety: boolean };

/** A question without its answer or explanation. */
export function forLearner(q: Question): LearnerQuestion {
  return q.type === "tf"
    ? { type: "tf", q: q.q, safety: !!q.critical }
    : { type: q.type, q: q.q, options: q.options, safety: !!q.critical };
}

// --- Grading ------------------------------------------------------------------------

export type Answer = number | boolean | number[] | null;

export function isCorrect(q: Question, a: unknown): boolean {
  if (q.type === "tf") return a === q.answer;
  if (q.type === "single") return a === q.answer;
  if (!Array.isArray(a) || !a.every((x) => Number.isInteger(x))) return false;
  const given = [...new Set(a as number[])].sort((x, y) => x - y);
  const want = [...q.answer].sort((x, y) => x - y);
  return given.length === want.length && given.every((x, i) => x === want[i]);
}

export interface Graded {
  correct: number;
  total: number;
  scorePercent: number;
  safetyMissed: number;
  passed: boolean;
  feedback: { correct: boolean; why: string }[];
}

/**
 * Grades answers (in the order the questions were asked). For finals every
 * safety question must be right as well as reaching the pass mark.
 */
export function grade(
  questions: Question[],
  answers: unknown,
  passPercent: number,
  safetyMustBeRight: boolean,
): Graded {
  const list = Array.isArray(answers) ? answers : [];
  const feedback = questions.map((q, i) => ({
    correct: isCorrect(q, list[i]),
    why: q.why,
  }));
  const correct = feedback.filter((f) => f.correct).length;
  const total = questions.length;
  const scorePercent = total ? Math.floor((correct * 100) / total) : 0;
  const safetyMissed = safetyMustBeRight
    ? questions.filter((q, i) => q.critical && !feedback[i]!.correct).length
    : 0;
  return {
    correct,
    total,
    scorePercent,
    safetyMissed,
    passed: scorePercent >= passPercent && safetyMissed === 0,
    feedback,
  };
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The server's draw for a final: every safety question, the rest at random. */
export function drawFinal(pool: Question[], count: number): number[] {
  const idx = pool.map((_, i) => i);
  const safety = idx.filter((i) => pool[i]!.critical);
  const rest = shuffle(idx.filter((i) => !pool[i]!.critical));
  const n = Math.min(count, pool.length);
  return shuffle([...safety, ...rest.slice(0, Math.max(0, n - safety.length))]);
}

/** Modules whose quiz must be passed before the final unlocks. */
export function quizModules(pkg: CoursePackage): number[] {
  return pkg.modules.flatMap((m, i) => (m.quiz.length ? [i] : []));
}
