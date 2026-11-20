// M15 course files: strict validation, learner views without answers, grading
// (including safety questions) and the server's draw of final questions.

import { describe, expect, it } from "vitest";

import {
  drawFinal,
  forLearner,
  grade,
  parseCourseFile,
  type CourseQuestion as Question,
} from "@/modules/training";

import { q, syntheticCourse } from "../helpers/course-fixture";

const parse = (o: unknown) => parseCourseFile(JSON.stringify(o));

describe("parseCourseFile", () => {
  it("accepts a valid course and keeps only known fields", () => {
    const r = parse({ ...syntheticCourse(), surprise: "<script>" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg?.modules).toHaveLength(2);
    expect(r.finalCount).toBe(4);
    expect(JSON.stringify(r.pkg)).not.toContain("surprise");
  });

  it("rejects answers that point to missing options", () => {
    const c = syntheticCourse();
    c.modules[0]!.quiz[0] = q({ answer: 7 } as Partial<Question>);
    const r = parse(c);
    expect(r.ok).toBe(false);
  });

  it("rejects more safety questions than final questions", () => {
    const r = parse(
      syntheticCourse({
        finalAssessment: {
          pool: [q({ critical: true }), q({ critical: true }), q()],
          questions: 1,
          passPercent: 80,
          modulePassPercent: 75,
        },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects scenarios without exactly one best answer, bad JSON and huge files", () => {
    const c = syntheticCourse();
    (
      c.modules[1]!.pages[0] as { scenario: { options: { ok: boolean }[] } }
    ).scenario.options[1]!.ok = true;
    expect(parse(c).ok).toBe(false);
    expect(parseCourseFile("{not json").ok).toBe(false);
    expect(parseCourseFile(" ".repeat(500_001)).ok).toBe(false);
    expect(parse({ ...syntheticCourse(), format: "scorm" }).ok).toBe(false);
  });

  it("accepts an external course without modules", () => {
    const r = parse({
      format: "hotrock-course",
      formatVersion: 1,
      code: "EXT1",
      name: "First aid at work",
      kind: "external",
      validityMonths: 36,
    });
    expect(r.ok && r.pkg).toBe(null);
  });
});

describe("learners and grading", () => {
  it("never gives learners the answer or explanation", () => {
    const view = forLearner(q({ critical: true }));
    expect(view).toEqual({
      type: "single",
      q: "Which number do you call for a gas leak?",
      options: ["101", "0800 111 999", "111"],
      safety: true,
    });
    expect(
      JSON.stringify(
        forLearner({ type: "tf", q: "x", answer: false, why: "w" }),
      ),
    ).not.toMatch(/answer|why/);
  });

  it("grades single, true/false and select-all answers", () => {
    const qs: Question[] = [
      q(),
      { type: "tf", q: "t", answer: false, why: "w" },
      {
        type: "multi",
        q: "m",
        options: ["a", "b", "c"],
        answer: [0, 2],
        why: "w",
      },
    ];
    const g = grade(qs, [1, false, [2, 0]], 100, false);
    expect(g.correct).toBe(3);
    expect(g.passed).toBe(true);
    const h = grade(qs, [1, "false", [0]], 50, false);
    expect(h.correct).toBe(1);
    expect(h.scorePercent).toBe(33);
    expect(h.passed).toBe(false);
  });

  it("fails a final when any safety question is wrong, whatever the score", () => {
    const qs = [q({ critical: true }), q(), q(), q(), q()];
    const g = grade(qs, [0, 1, 1, 1, 1], 80, true);
    expect(g.scorePercent).toBe(80);
    expect(g.safetyMissed).toBe(1);
    expect(g.passed).toBe(false);
  });

  it("draws every safety question plus random others, without repeats", () => {
    const pool = Array.from({ length: 16 }, (_, i) =>
      q({ critical: i % 5 === 0 }),
    );
    for (let n = 0; n < 20; n++) {
      const ids = drawFinal(pool, 10);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      for (const s of [0, 5, 10, 15]) expect(ids).toContain(s);
    }
  });
});
