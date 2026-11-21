// M19: when each of a new starter's first steps counts as done.

import { describe, expect, it } from "vitest";

import { stepFacts } from "@/lib/first-steps";
import type { MyCourse } from "@/modules/training";

const course = (over: Partial<MyCourse>): MyCourse =>
  ({
    courseId: "c1",
    name: "Induction",
    description: null,
    kind: "internal",
    completionMethod: "interactive",
    content: null,
    contentVersion: 1,
    confirmedVersion: null,
    canConfirm: false,
    status: "due",
    mandatory: true,
    dueOn: "2026-11-30",
    completedOn: null,
    expiresOn: null,
    recordId: null,
    ...over,
  }) as MyCourse;

const details = {
  address: { line1: "1 High St", postcode: "BN3 2AE" },
  dateOfBirth: "2000-01-01",
  emergency: { name: "Sam", phone: "07700 900000" },
};

describe("stepFacts", () => {
  it("starts with nothing done and says what's missing", () => {
    const f = stepFacts({
      details: { emergency: { name: null, phone: null } },
      requests: [{ status: "awaiting_employee", kind: "contract" }],
      training: [course({})],
    });
    expect(f.about.missing).toEqual([
      "home address",
      "date of birth",
      "emergency contact",
    ]);
    expect(f.documents).toMatchObject({
      done: false,
      toSign: 1,
      contractWaiting: true,
    });
    expect(f.completed).toBe(0);
    expect(f.allDone).toBe(false);
  });

  it("is all done when details, signatures and mandatory training are complete", () => {
    const f = stepFacts({
      details,
      requests: [
        { status: "completed", kind: "policy" },
        { status: "awaiting_countersign", kind: "contract" },
        { status: "withdrawn", kind: "policy" },
      ],
      training: [
        course({ status: "up_to_date" }),
        course({ courseId: "c2", mandatory: false, status: "due" }),
      ],
    });
    expect(f.documents).toMatchObject({ done: true, toSign: 0, signed: 2 });
    expect(f.training).toMatchObject({ done: true, total: 1, complete: 1 });
    expect(f.allDone).toBe(true);
  });

  it("counts no documents and no training as done", () => {
    const f = stepFacts({ details, requests: [], training: [] });
    expect(f.allDone).toBe(true);
  });
});
