import { describe, expect, it } from "vitest";
import { parseIdSpec } from "./idSpec";

describe("parseIdSpec", () => {
  const pick = (text: string) => {
    const test = parseIdSpec(text);
    return test ? [1, 59, 60, 61, 65, 70, 71, 200].filter(test) : null;
  };
  it("takes single IDs and inclusive ranges", () => {
    expect(pick("59, 61-70")).toEqual([59, 61, 65, 70]);
    expect(pick("70 - 61")).toEqual([61, 65, 70]);
    expect(pick("71-")).toEqual([71, 200]);
    expect(pick("-59")).toEqual([1, 59]);
  });
  it("keeps older from..to filters working", () => {
    expect(pick("60..65")).toEqual([60, 61, 65]);
  });
  it("selects everything when empty or unreadable", () => {
    expect(pick("")).toBeNull();
    expect(pick("abc")).toBeNull();
  });
});
