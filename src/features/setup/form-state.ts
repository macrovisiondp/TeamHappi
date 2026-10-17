import type { FieldErrors } from "@/lib/validation/organisation";

/** Result of a setup server action, rendered by the form. */
export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string; href?: string }
  | { status: "error"; message: string; fieldErrors?: FieldErrors };

export const IDLE: FormState = { status: "idle" };
