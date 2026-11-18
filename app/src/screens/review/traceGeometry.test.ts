import { describe, expect, it } from "vitest";
import { anchorSwitch, usedRuns, validReading } from "./traceGeometry";

describe("usedRuns", () => {
  it("shades each run of fitted points, so cuts shrink the window", () => {
    const t = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(
      usedRuns(t, [false, true, true, false, false, true, true, true]),
    ).toEqual([
      [1, 2],
      [5, 7],
    ]);
    expect(
      usedRuns(
        t,
        t.map(() => false),
      ),
    ).toEqual([]);
  });
});

describe("anchorSwitch", () => {
  it("does not depend on the valve offset", () => {
    // Switches at 79 s and 106 s are equally far from the middle (92.5 s).
    // The handle is chosen from the logged times only, so a -1 s offset
    // moves it to 78 s instead of hopping to the 106 s switch.
    expect(anchorSwitch([59, 79, 106, 126], 92.5)).toBe(1);
  });
  it("picks the switch nearest the middle of the view", () => {
    expect(anchorSwitch([0, 20, 40, 60], 45)).toBe(2);
  });
});

describe("validReading", () => {
  it("drops dropouts and analyser error codes, keeps negatives", () => {
    expect([0.33, -14.7, 0, 1.7976931e304, NaN].map(validReading)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
