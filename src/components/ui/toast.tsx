"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

// Small notes that confirm an action ("Saved", "Invitation sent") and fade
// away, instead of a box on the page. One <Toaster /> sits in the root layout.
// A note can also be carried over a full page reload (reloadWithNote).

type Tone = "success" | "error" | "info";
interface Note {
  id: number;
  message: string;
  tone: Tone;
}

const EVENT = "teamhappi:note";
const CARRY = "teamhappi:note";

/** Shows a short note at the bottom of the screen. */
export function notify(message: string, tone: Tone = "success") {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(
    new CustomEvent<Omit<Note, "id">>(EVENT, { detail: { message, tone } }),
  );
}

/** Reloads the page and shows the note once it has loaded again. */
export function reloadWithNote(message?: string) {
  try {
    if (message) sessionStorage.setItem(CARRY, message);
  } catch {
    // Private browsing: the note is skipped; the reload still happens.
  }
  window.location.reload();
}

let next = 1;

export function Toaster() {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    const add = (message: string, tone: Tone) => {
      const id = next++;
      setNotes((n) => [...n.slice(-2), { id, message, tone }]);
      window.setTimeout(
        () => setNotes((n) => n.filter((x) => x.id !== id)),
        tone === "error" ? 7000 : 4500,
      );
    };
    const onNote = (e: Event) => {
      const d = (e as CustomEvent<Omit<Note, "id">>).detail;
      add(d.message, d.tone);
    };
    window.addEventListener(EVENT, onNote);
    try {
      const carried = sessionStorage.getItem(CARRY);
      if (carried) {
        sessionStorage.removeItem(CARRY);
        add(carried, "success");
      }
    } catch {
      // Ignore: storage unavailable.
    }
    return () => window.removeEventListener(EVENT, onNote);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-start sm:pl-6"
    >
      {notes.map((n) => {
        const Icon =
          n.tone === "error"
            ? XCircle
            : n.tone === "info"
              ? Info
              : CheckCircle2;
        return (
          <div
            key={n.id}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg bg-[#2b2f2d] px-4 py-3 text-sm text-white shadow-lg"
          >
            <Icon
              aria-hidden="true"
              className={
                n.tone === "error"
                  ? "size-4 shrink-0 text-red-300"
                  : "size-4 shrink-0 text-emerald-300"
              }
            />
            <span className="flex-1">{n.message}</span>
            <button
              type="button"
              onClick={() => setNotes((x) => x.filter((y) => y.id !== n.id))}
              className="-mr-1 flex size-8 items-center justify-center rounded-md text-white/70 hover:text-white"
              aria-label="Dismiss"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
