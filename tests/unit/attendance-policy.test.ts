// M11.1 attendance rules: matching a clock-in to a shift, flags, worked time
// and the Who's in status. Times are never rounded or changed.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMITS,
  breakMinutes,
  entryFlags,
  matchShift,
  personStatus,
  workedMinutes,
} from "@/modules/attendance";

const at = (hhmm: string, day = "2026-11-20") => new Date(`${day}T${hhmm}:00Z`);
const shift = (id: string, start: string, end: string) => ({
  id,
  startsAt: at(start),
  endsAt: at(end),
});

describe("matchShift", () => {
  const shifts = [
    shift("lunch", "11:00", "15:00"),
    shift("eve", "17:00", "23:00"),
  ];

  it("matches up to two hours early and while running, nearest start first", () => {
    expect(matchShift(shifts, at("09:00"))?.id).toBe("lunch");
    expect(matchShift(shifts, at("08:59"))).toBeNull();
    expect(matchShift(shifts, at("14:59"))?.id).toBe("lunch");
    // 15:30: lunch has ended; evening starts within two hours.
    expect(matchShift(shifts, at("15:30"))?.id).toBe("eve");
    expect(matchShift(shifts, at("23:00"))).toBeNull();
  });

  it("prefers the nearer start when two shifts qualify", () => {
    const close = [shift("a", "10:00", "16:00"), shift("b", "15:00", "20:00")];
    expect(matchShift(close, at("14:50"))?.id).toBe("b");
    expect(matchShift(close, at("12:00"))?.id).toBe("a");
  });
});

describe("entryFlags", () => {
  const s = shift("s", "10:00", "16:00");
  const now = at("23:59");
  const e = (inAt: string, outAt: string | null, corrected = false) => ({
    clockInAt: at(inAt),
    clockOutAt: outAt ? at(outAt) : null,
    corrected,
  });

  it("flags nothing within the tolerance", () => {
    expect(entryFlags(e("09:50", "16:10"), s, DEFAULT_LIMITS, now)).toEqual([]);
  });

  it("flags early, late, left early and stayed late beyond it", () => {
    expect(entryFlags(e("09:49", "16:11"), s, DEFAULT_LIMITS, now)).toEqual([
      "early_in",
      "stayed_late",
    ]);
    expect(entryFlags(e("10:11", "15:49"), s, DEFAULT_LIMITS, now)).toEqual([
      "late_in",
      "left_early",
    ]);
  });

  it("uses the organisation's tolerance", () => {
    expect(
      entryFlags(
        e("10:20", "16:00"),
        s,
        { ...DEFAULT_LIMITS, toleranceMinutes: 30 },
        now,
      ),
    ).toEqual([]);
  });

  it("flags no shift, corrections and missed clock-outs", () => {
    expect(
      entryFlags(e("10:00", "12:00", true), null, DEFAULT_LIMITS, now),
    ).toEqual(["no_shift", "corrected"]);
    // Open two hours after the shift ends: not yet missed; just after: missed.
    expect(
      entryFlags(e("10:00", null), s, DEFAULT_LIMITS, at("18:00")),
    ).toEqual([]);
    expect(
      entryFlags(e("10:00", null), s, DEFAULT_LIMITS, at("18:01")),
    ).toEqual(["missed_clock_out"]);
    // No shift: missed after 12 hours.
    expect(
      entryFlags(e("10:00", null), null, DEFAULT_LIMITS, at("22:01")),
    ).toEqual(["no_shift", "missed_clock_out"]);
  });
});

describe("worked time", () => {
  it("subtracts recorded breaks only, and counts an open entry up to now", () => {
    const breaks = [{ startsAt: at("12:00"), endsAt: at("12:30") }];
    expect(breakMinutes(breaks, at("16:00"))).toBe(30);
    expect(
      workedMinutes(
        { clockInAt: at("10:00"), clockOutAt: at("16:00") },
        breaks,
        at("23:00"),
      ),
    ).toBe(330);
    expect(
      workedMinutes(
        { clockInAt: at("10:00"), clockOutAt: null },
        [{ startsAt: at("12:00"), endsAt: null }],
        at("12:15"),
      ),
    ).toBe(120);
    // No break recorded: nothing is deducted automatically (D6).
    expect(
      workedMinutes(
        { clockInAt: at("10:00"), clockOutAt: at("16:00") },
        [],
        at("23:00"),
      ),
    ).toBe(360);
  });
});

describe("personStatus", () => {
  const s = [shift("s", "10:00", "16:00")];
  const entry = (inAt: string, outAt: string | null, extra = {}) => ({
    clockInAt: at(inAt),
    clockOutAt: outAt ? at(outAt) : null,
    onBreak: false,
    missed: false,
    ...extra,
  });

  it("is due, then late, then no clock-in when nobody clocks in", () => {
    expect(personStatus(s, [], DEFAULT_LIMITS, at("09:00"))).toBe("due");
    expect(personStatus(s, [], DEFAULT_LIMITS, at("10:10"))).toBe("due");
    expect(personStatus(s, [], DEFAULT_LIMITS, at("10:11"))).toBe("late");
    expect(personStatus(s, [], DEFAULT_LIMITS, at("16:00"))).toBe(
      "no_clock_in",
    );
  });

  it("follows the open entry, then done", () => {
    expect(
      personStatus(s, [entry("09:55", null)], DEFAULT_LIMITS, at("11:00")),
    ).toBe("in");
    expect(
      personStatus(
        s,
        [entry("09:55", null, { onBreak: true })],
        DEFAULT_LIMITS,
        at("12:00"),
      ),
    ).toBe("on_break");
    expect(
      personStatus(
        s,
        [entry("09:55", null, { missed: true })],
        DEFAULT_LIMITS,
        at("20:00"),
      ),
    ).toBe("missed_clock_out");
    expect(
      personStatus(s, [entry("09:55", "16:00")], DEFAULT_LIMITS, at("17:00")),
    ).toBe("done");
    // Clocked in without a shift.
    expect(
      personStatus([], [entry("09:55", "12:00")], DEFAULT_LIMITS, at("17:00")),
    ).toBe("done");
  });
});
