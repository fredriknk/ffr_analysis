import { describe, expect, it } from "vitest";
import { manualImportMapping, suggestedColumns } from "./columnMapping";

describe("external data column mapping", () => {
  it("suggests the legacy manual columns when present", () => {
    expect(
      suggestedColumns(["nr", "date", "N2O_N_mug_m2h", "CO2_C_mug_m2h"]),
    ).toEqual({
      time: "date",
      plot: "nr",
      N2O: "N2O_N_mug_m2h",
      CO2: "CO2_C_mug_m2h",
    });
  });

  it("sends custom names and a fractional offset with either gas by itself", () => {
    const columns = [
      "Collected",
      "Plot label",
      "Nitrous oxide",
      "Carbon dioxide",
    ];
    const first = {
      time: "Collected",
      plot: "Plot label",
      N2O: "Nitrous oxide",
      CO2: "",
    };
    expect(manualImportMapping(columns, first, "-1.5")).toEqual({
      dateColumn: "Collected",
      plotColumn: "Plot label",
      gasColumns: { N2O: "Nitrous oxide" },
      offsetHours: -1.5,
    });
    const second = { ...first, N2O: "", CO2: "Carbon dioxide" };
    expect(manualImportMapping(columns, second, "0")?.gasColumns).toEqual({
      CO2: "Carbon dioxide",
    });
  });

  it("requires time, plot, at least one gas and a numeric offset from the current mapping", () => {
    const columns = ["date", "plot", "N2O"];
    const mapping = suggestedColumns(columns);
    expect(
      manualImportMapping(columns, { ...mapping, N2O: "" }, "12"),
    ).toBeUndefined();
    expect(
      manualImportMapping(columns, { ...mapping, plot: "" }, "12"),
    ).toBeUndefined();
    expect(
      manualImportMapping(columns, { ...mapping, time: "old header" }, "12"),
    ).toBeUndefined();
    expect(manualImportMapping(columns, mapping, "")).toBeUndefined();
  });
});
