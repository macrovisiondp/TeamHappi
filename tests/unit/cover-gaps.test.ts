// M16: the stretches of time when people are working but nobody covers.

import { describe, expect, it } from "vitest";

import { coverGaps } from "@/modules/rota";

const h = (n: number) => n * 3_600_000;

describe("coverGaps", () => {
  it("finds the uncovered part of overlapping shifts", () => {
    expect(
      coverGaps([
        { start: h(10), end: h(14), covers: true },
        { start: h(12), end: h(18), covers: false },
      ]),
    ).toEqual([[h(14), h(18)]]);
  });

  it("is empty when the cover lasts all day, and whole when nobody covers", () => {
    expect(
      coverGaps([
        { start: h(9), end: h(22), covers: true },
        { start: h(12), end: h(18), covers: false },
      ]),
    ).toEqual([]);
    expect(
      coverGaps([
        { start: h(9), end: h(12), covers: false },
        { start: h(15), end: h(18), covers: false },
      ]),
    ).toEqual([
      [h(9), h(12)],
      [h(15), h(18)],
    ]);
  });

  it("joins back-to-back cover and ignores gaps under a minute", () => {
    expect(
      coverGaps([
        { start: h(9), end: h(13), covers: true },
        { start: h(13), end: h(17), covers: true },
        { start: h(9), end: h(17), covers: false },
        { start: h(17), end: h(17) + 30_000, covers: false },
      ]),
    ).toEqual([]);
  });

  it("finds a gap in the middle", () => {
    expect(
      coverGaps([
        { start: h(10), end: h(12), covers: true },
        { start: h(14), end: h(16), covers: true },
        { start: h(10), end: h(16), covers: false },
      ]),
    ).toEqual([[h(12), h(14)]]);
  });
});
