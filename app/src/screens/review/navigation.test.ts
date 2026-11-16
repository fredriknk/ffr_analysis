import { describe, expect, it } from "vitest";
import { nextQueueId } from "./navigation";
describe("review selection across refetches", () => {
  it("moves relative to the displayed flux after filtering, undo and re-sort", () => {
    const original = [12, 27, 43, 81];
    expect(nextQueueId(27, 1, original, original)).toBe(43);
    expect(nextQueueId(27, 1, [81, 43, 12], original)).toBe(43);
    expect(nextQueueId(27, -1, [81, 43, 12], original)).toBe(12);
    expect(nextQueueId(27, 1, [43, 27, 12], original)).toBe(12);
  });
});
