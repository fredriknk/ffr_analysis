import { describe, expect, it } from "vitest";
import { combineSelections } from "./combine";

describe("combineSelections", () => {
  it("unions or intersects the charts that have a selection", () => {
    const sets = [
      [1, 2, 3],
      [2, 3, 4],
    ];
    expect(combineSelections(sets, "union").sort()).toEqual([1, 2, 3, 4]);
    expect(combineSelections(sets, "intersection")).toEqual([2, 3]);
    expect(combineSelections([[5, 5, 6]], "intersection")).toEqual([5, 6]);
    expect(combineSelections([], "union")).toEqual([]);
  });
});
