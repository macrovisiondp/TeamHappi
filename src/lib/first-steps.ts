// "Your first steps" (M19): a new starter's guided start, in order:
//   1. About you (address, date of birth, emergency contact);
//   2. Documents (policies to read and sign, and their contract);
//   3. Training (their mandatory courses).
// Each step is done when its facts are complete; the page celebrates when all
// three are. Steps are guided, not locked: shifts are always available.

import type { MyCourse } from "@/modules/training";

export interface StepFacts {
  about: { done: boolean; missing: string[] };
  documents: {
    done: boolean;
    toSign: number;
    signed: number;
    contractWaiting: boolean;
  };
  training: {
    done: boolean;
    total: number;
    complete: number;
    courses: {
      id: string;
      name: string;
      complete: boolean;
      interactive: boolean;
      mandatory: boolean;
    }[];
  };
  completed: number;
  allDone: boolean;
}

export function stepFacts(input: {
  details: {
    address?: { line1: string | null; postcode: string | null };
    dateOfBirth?: string | null;
    emergency: { name: string | null; phone: string | null };
  } | null;
  requests: { status: string; kind: "policy" | "contract" }[];
  training: MyCourse[];
}): StepFacts {
  const d = input.details;
  const missing = [
    !d?.address?.line1 || !d.address.postcode ? "home address" : null,
    !d?.dateOfBirth ? "date of birth" : null,
    !d?.emergency.name || !d.emergency.phone ? "emergency contact" : null,
  ].filter((x): x is string => !!x);
  const live = input.requests.filter((r) => r.status !== "withdrawn");
  const toSign = live.filter((r) => r.status === "awaiting_employee").length;
  const courses = input.training
    .filter((c) => c.mandatory)
    .map((c) => ({
      id: c.courseId,
      name: c.name,
      complete: c.status === "up_to_date" || c.status === "expiring",
      interactive: c.completionMethod === "interactive",
      mandatory: c.mandatory,
    }));
  const complete = courses.filter((c) => c.complete).length;
  const about = { done: missing.length === 0, missing };
  const documents = {
    done: toSign === 0,
    toSign,
    signed: live.length - toSign,
    contractWaiting: live.some(
      (r) => r.kind === "contract" && r.status === "awaiting_employee",
    ),
  };
  const training = {
    done: complete === courses.length,
    total: courses.length,
    complete,
    courses,
  };
  const completed = [about.done, documents.done, training.done].filter(
    Boolean,
  ).length;
  return { about, documents, training, completed, allDone: completed === 3 };
}
