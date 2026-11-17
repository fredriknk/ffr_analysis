import { describe, expect, it } from "vitest";
import {
  clamp,
  inverse,
  quantile,
  robustBounds,
  transformed,
} from "../screens/outliers/axes";
import { useStore } from "../store";
import { attention, columnMeta, dateTime, seriesDisplay, unit } from "./format";
describe("scientific display", () => {
  it("formats native ASCII units and legacy column labels", () => {
    expect(unit("ug CO2-C m^-2 h^-1")).toBe("µg CO2-C m⁻² h⁻¹");
    expect(unit("kg ha^-1")).toBe("kg ha⁻¹");
    expect(
      columnMeta({
        key: "N2O_flux",
        label: "N2O_flux",
        type: "number",
        group: "N2O",
      }).label,
    ).toBe("N2O flux");
    expect(
      columnMeta({
        key: "plotLabel",
        label: "plotLabel",
        type: "category",
        group: "Field",
      }).label,
    ).toBe("Plot");
    expect(attention(98.0220901269475)).toBe("98");
    expect(
      seriesDisplay({
        id: 1,
        name: "max(air_temperature PT1H)",
        unit: "",
        source: "weather",
        count: 12,
        timeRange: [0, 1],
      }).name,
    ).toBe("Maximum air temperature");
  });
  it("retains minutes and uses the project time zone", () => {
    useStore.setState({ timeZone: "Europe/Oslo" });
    expect(dateTime(Date.UTC(2023, 0, 3, 12, 26))).toBe("03 Jan 2023 13:26");
  });
  it("keeps extreme and negative fluxes clickable at robust asinh bounds", () => {
    const values = Array.from({ length: 101 }, (_, i) => i - 50).concat(23000);
    const bounds = robustBounds(values);
    expect(bounds[1]).toBeLessThan(23000);
    expect(clamp(23000, bounds)).toBe(bounds[1]);
    expect(inverse(transformed(-123, "asinh"), "asinh")).toBeCloseTo(-123);
    expect(quantile([0, 10, 20, 30, 40], 0.05)).toBe(2);
  });
});
