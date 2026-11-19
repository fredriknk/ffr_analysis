import { describe, expect, it } from "vitest";
import { valveLagEstimate } from "./valveLag";

describe("valveLagEstimate", () => {
  it("uses the same estimate for one gas and all gases", () => {
    const detail = { CO2_lagS: -2.5, N2O_lagS: 0 };
    expect(valveLagEstimate(detail, "CO2")).toBe(-2.5);
    expect(valveLagEstimate(detail, "all")).toBe(-2.5);
    expect(valveLagEstimate(detail, "N2O")).toBe(0);
    expect(valveLagEstimate(detail, "N2Oall")).toBe(0);
  });

  it("rejects missing or non-finite estimates for either gas", () => {
    for (const value of [null, NaN, Infinity]) {
      const detail = { CO2_lagS: value, N2O_lagS: value };
      for (const target of ["all", "N2Oall", "CO2", "N2O"] as const) {
        expect(valveLagEstimate(detail, target)).toBeNull();
      }
    }
    expect(valveLagEstimate(undefined, "all")).toBeNull();
  });
});
