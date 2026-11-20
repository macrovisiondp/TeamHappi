"use server";

import { getWorkspace, trainingApi } from "@/lib/workspace";
import type {
  ImportOutcome,
  LearnerQuestion,
  QuizResult,
} from "@/modules/training";

// Server actions for interactive courses (M15). The organisation and the
// person always come from the server session. Answers are graded by the
// training module; nothing the browser sends is trusted.

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const SIGNED_OUT =
  "Your session or access has changed. Sign in again and retry.";

export type ImportState =
  | { status: "idle" }
  | { status: "done"; outcomes: ImportOutcome[] }
  | { status: "error"; message: string };

export async function importTrainingCourses(
  _prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  const ws = await ready();
  if (!ws) return { status: "error", message: SIGNED_OUT };
  const files = form
    .getAll("files")
    .filter(
      (f): f is File => typeof f === "object" && f !== null && "text" in f,
    )
    .filter((f) => f.size > 0);
  if (!files.length)
    return { status: "error", message: "Choose one or more course files." };
  if (files.length > 40)
    return { status: "error", message: "Import at most 40 files at a time." };
  const read = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      // Oversized files are rejected by the parser without being read in full.
      text: f.size > 600_000 ? " ".repeat(600_001) : await f.text(),
    })),
  );
  const r = await trainingApi.importCourses(
    ws,
    read,
    form.get("addRules") === "on",
  );
  return r.ok
    ? { status: "done", outcomes: r.data.outcomes }
    : { status: "error", message: r.message };
}

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; message: string };

const plain = <T>(
  r: { ok: true; data: T } | { ok: false; message: string },
): ActionResult<T> =>
  r.ok ? { ok: true, data: r.data } : { ok: false, message: r.message };

export async function submitModuleQuizAction(
  courseId: string,
  moduleIndex: number,
  answers: unknown[],
): Promise<ActionResult<QuizResult>> {
  const ws = await ready();
  if (!ws) return { ok: false, message: SIGNED_OUT };
  return plain(
    await trainingApi.submitModule(ws, courseId, moduleIndex, answers),
  );
}

export async function startFinalAction(
  courseId: string,
): Promise<ActionResult<{ attemptId: string; questions: LearnerQuestion[] }>> {
  const ws = await ready();
  if (!ws) return { ok: false, message: SIGNED_OUT };
  return plain(await trainingApi.startFinal(ws, courseId));
}

export async function submitFinalAction(
  courseId: string,
  attemptId: string,
  answers: unknown[],
): Promise<ActionResult<QuizResult>> {
  const ws = await ready();
  if (!ws) return { ok: false, message: SIGNED_OUT };
  return plain(await trainingApi.submitFinal(ws, courseId, attemptId, answers));
}
