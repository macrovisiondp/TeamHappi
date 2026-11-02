// M10.1 rota rules: weeks, wall-clock times in the site's time zone
// (overnight shifts, clocks changing), hours, and the working-time checks.

import { describe, expect, it } from "vitest";

import {
  formatMinutes,
  mondayOf,
  shiftTimes,
  utcToZoned,
  weekDays,
  workedMinutes,
  workingTimeWarnings,
  zonedToUtc,
  type TimedShift,
} from "@/modules/rota";

const TZ = "Europe/London";
const at = (local: string) => zonedToUtc(local, TZ)!;
const shift = (
  id: string,
  start: string,
  end: string,
  breakMinutes = 30,
): TimedShift => ({ id, startsAt: at(start), endsAt: at(end), breakMinutes });

describe("weeks", () => {
  it("start on Monday", () => {
    expect(mondayOf("2026-11-04")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(weekDays("2026-11-02")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });
});

describe("shift times", () => {
  it("are wall-clock times in the site's time zone, stored as instants", () => {
    const r = shiftTimes("2026-07-01", "09:00", "17:30", "30", TZ);
    expect(r.ok && r.startsAt.toISOString()).toBe("2026-07-01T08:00:00.000Z"); // BST
    expect(r.ok && workedMinutes(r)).toBe(8 * 60);
    const w = shiftTimes("2026-12-01", "09:00", "17:00", 0, TZ);
    expect(w.ok && w.startsAt.toISOString()).toBe("2026-12-01T09:00:00.000Z"); // GMT
  });

  it("an end at or before the start finishes the next day", () => {
    const r = shiftTimes("2026-11-06", "18:00", "02:00", "15", TZ);
    expect(r.ok && utcToZoned(r.endsAt, TZ)).toBe("2026-11-07T02:00");
    expect(r.ok && workedMinutes(r)).toBe(8 * 60 - 15);
  });

  it("handles the clocks changing: the skipped hour is refused, the long night counts", () => {
    // 29 March 2026: 01:00 to 02:00 doesn't exist in London.
    expect(shiftTimes("2026-03-29", "01:30", "06:00", 0, TZ)).toMatchObject({
      ok: false,
      fieldErrors: { start: expect.any(String) },
    });
    // 25 October 2026: clocks go back, so 22:00 to 06:00 is 9 hours.
    const r = shiftTimes("2026-10-24", "22:00", "06:00", 0, TZ);
    expect(r.ok && workedMinutes(r)).toBe(9 * 60);
  });

  it("refuses bad input, over 16 hours, and breaks as long as the shift", () => {
    expect(shiftTimes("not-a-day", "9", "25:00", -1, TZ)).toMatchObject({
      ok: false,
      fieldErrors: {
        day: expect.any(String),
        start: expect.any(String),
        end: expect.any(String),
        breakMinutes: expect.any(String),
      },
    });
    expect(shiftTimes("2026-11-02", "06:00", "23:00", 0, TZ)).toMatchObject({
      ok: false,
      fieldErrors: { end: expect.any(String) },
    });
    expect(shiftTimes("2026-11-02", "09:00", "10:00", 60, TZ)).toMatchObject({
      ok: false,
      fieldErrors: { breakMinutes: expect.any(String) },
    });
  });

  it("formats hours", () => {
    expect(formatMinutes(450)).toBe("7h 30m");
    expect(formatMinutes(480)).toBe("8h");
  });
});

describe("working-time checks (warnings, except overlaps)", () => {
  const s = shift("s", "2026-11-03T09:00", "2026-11-03T17:00");
  const codes = (others: TimedShift[], week = others, x = s) =>
    workingTimeWarnings(x, others, week).map((w) => `${w.code}:${w.blocking}`);

  it("blocks overlapping shifts for the same person", () => {
    expect(
      codes([shift("o", "2026-11-03T16:00", "2026-11-03T22:00")]),
    ).toContain("overlap:true");
  });

  it("warns about under 11 hours' rest, before or after", () => {
    expect(codes([shift("o", "2026-11-02T18:00", "2026-11-03T01:00")])).toEqual(
      ["short_rest:false"],
    );
    expect(codes([shift("o", "2026-11-04T03:00", "2026-11-04T08:00")])).toEqual(
      ["short_rest:false"],
    );
    expect(codes([shift("o", "2026-11-04T04:00", "2026-11-04T08:00")])).toEqual(
      [],
    );
  });

  it("warns about a shift over 6 hours with under 20 minutes' break", () => {
    expect(
      codes([], [], shift("x", "2026-11-03T09:00", "2026-11-03T16:00", 15)),
    ).toEqual(["no_break:false"]);
    expect(
      codes([], [], shift("x", "2026-11-03T09:00", "2026-11-03T15:00", 0)),
    ).toEqual([]);
  });

  it("warns above 48 hours in the week, counting worked time only", () => {
    const week = [1, 3, 4, 5, 6].map((d) =>
      shift(`d${d}`, `2026-11-0${d + 1}T08:00`, `2026-11-0${d + 1}T18:00`, 30),
    ); // 5 x 9.5h = 47.5h, plus this 7.5h = 55h
    const out = workingTimeWarnings(s, week, week);
    expect(out.map((w) => w.code)).toEqual(["over_48"]);
    expect(out.find((w) => w.code === "over_48")!.message).toMatch(/55h/);
  });

  it("ignores the shift itself (editing)", () => {
    expect(codes([s])).toEqual([]);
  });
});
