import { describe, expect, it } from "vitest";
import { findingLevels, hasFinding } from "./findingLevels";
import type { FluxRow } from "./types";
describe("per-code severity", () => {
  it("does not promote info on an otherwise bad flux", () => {
    const row = {
      diag: "valve_timing,chamber_leak",
      attention: 90,
      diagSeverity: { valve_timing: "info", chamber_leak: "bad" },
    } as unknown as FluxRow;
    expect(hasFinding(row, "valve_timing")).toBe(false);
    expect(hasFinding(row, "valve_timing", true)).toBe(true);
    expect(hasFinding(row, "chamber_leak")).toBe(true);
  });
  it("deduplicates gases at the worst severity per code", () => {
    expect(
      findingLevels([
        { code: "spike", severity: "info", message: "" },
        { code: "spike", severity: "warn", message: "" },
      ]),
    ).toEqual({ spike: "warn" });
  });
});
