// Synthetic course files for M15 tests (no customer content).

import type { CourseQuestion as Question } from "@/modules/training";

export const q = (over: Partial<Question> = {}): Question =>
  ({
    type: "single",
    q: "Which number do you call for a gas leak?",
    options: ["101", "0800 111 999", "111"],
    answer: 1,
    why: "The national gas emergency number.",
    ...over,
  }) as Question;

export function syntheticCourse(over: Record<string, unknown> = {}) {
  const pool = Array.from({ length: 6 }, (_, i) =>
    q({ q: `Pool question ${i + 1}`, critical: i < 2 }),
  );
  return {
    format: "hotrock-course",
    formatVersion: 1,
    code: "SYN1",
    name: "Synthetic safety course",
    kind: "internal",
    validityMonths: 12,
    minutes: 20,
    who: "Everyone",
    intro: "A **synthetic** course for tests.",
    outcomes: ["Know the gas number"],
    modules: [
      {
        title: "Basics",
        pages: [
          {
            h: "Basics",
            body: [
              "Text",
              { key: "Key point" },
              { b: ["a", "b"] },
              { table: { head: ["A"], rows: [["1"]] } },
            ],
          },
          {
            h: "Sort",
            interact: {
              title: "Sort",
              classify: {
                prompt: "Sort",
                bins: ["Safe", "Unsafe"],
                items: [["Wet floor sign", 0]],
              },
            },
          },
        ],
        quiz: [q(), { type: "tf", q: "True?", answer: true, why: "Yes." }],
      },
      {
        title: "Scenarios",
        pages: [
          {
            h: "Spill",
            scenario: {
              title: "Spill",
              text: "A spill.",
              options: [
                { t: "Clean it", ok: true, fb: "Good" },
                { t: "Ignore", ok: false, fb: "No" },
              ],
            },
          },
        ],
        quiz: [],
      },
    ],
    finalAssessment: {
      pool,
      questions: 4,
      passPercent: 75,
      modulePassPercent: 50,
    },
    practical: null,
    ...over,
  };
}
