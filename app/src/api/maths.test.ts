import { describe, expect, it } from "vitest";
import { fluxConversion, regression, summarize } from "./maths";
import { createMock } from "./mock";
import type { FluxRow, Plot, Treatment } from "./types";
describe("scientific calculations", () => {
  it("fits a line with proper errors and Pearson p", () => {
    const r = regression([0, 1, 2, 3, 4], [1, 3, 5, 7, 9]);
    expect(r.slope).toBe(2);
    expect(r.intercept).toBe(1);
    expect(r.rsq).toBe(1);
    expect(r.pval).toBe(0);
    expect(r.seSlope).toBe(0);
    const noisy = regression([0, 1, 2, 3, 4], [1, 2, 1.5, 4, 3.5]);
    expect(noisy.slope).toBeCloseTo(0.7);
    expect(noisy.pval).toBeCloseTo(0.0646968422, 3);
  });
  it("converts ppm/s to N and C mass using ideal gas law", () => {
    const mol = (0.0001 * 1e-6 * 101000 * 0.5) / (8.314 * 283.15);
    expect(fluxConversion(0.0001)).toBeCloseTo(mol * 28 * 1e6 * 3600, 10);
    expect(
      fluxConversion(0.0001, 10, "CO2") / fluxConversion(0.0001),
    ).toBeCloseTo(12 / 28);
  });
  it("averages daily observations, integrates gaps, excludes and uses population SD", () => {
    const rows = [
      { id: 1, plotId: 1, time: 0, N2O_flux: 10 },
      { id: 2, plotId: 1, time: 0, N2O_flux: 30 },
      { id: 3, plotId: 1, time: 2 * 86400000, N2O_flux: 40 },
      { id: 4, plotId: 2, time: 0, N2O_flux: 10 },
      { id: 5, plotId: 2, time: 2 * 86400000, N2O_flux: 10 },
      { id: 6, plotId: 1, time: 86400000, N2O_flux: 999, excluded: true },
    ].map((r) => ({
      source: "robot",
      excluded: false,
      ...r,
    })) as unknown as FluxRow[];
    const plots = [
      { id: 1, label: "A", treatmentId: 1 },
      { id: 2, label: "B", treatmentId: 1 },
    ] as Plot[];
    const t = [{ id: 1, name: "Control", colour: "#abc" }] as Treatment[];
    const s = summarize(rows, plots, t, { gas: "N2O", sources: ["robot"] });
    expect(s.plots[0].daily[0].mean).toBe(20);
    expect(s.plots[0].total).toBeCloseTo(0.0144);
    expect(s.treatments[0].mean).toBeCloseTo(0.0096);
    expect(s.treatments[0].sd).toBeCloseTo(0.0048);
    expect(
      summarize(rows, plots, t, { gas: "N2O", sources: ["manual"] }).plots[0]
        .points,
    ).toHaveLength(0);
  });
  it("preserves preview, commits half-open windows and supports undo/redo", async () => {
    const api = createMock(72),
      before = await api.getFluxDetail(4);
    const options = { ...before.options, start: 40, stop: 120 };
    const preview = await api.previewFlux(4, options);
    expect(
      preview.traces[0].used.every((v, i) => !v || (i >= 40 && i < 120)),
    ).toBe(true);
    expect((await api.getFluxDetail(4)).isOverridden).toBe(false);
    await api.setFluxOptions([4], options);
    expect((await api.getFluxDetail(4)).isOverridden).toBe(true);
    await api.setFluxFlags([4], { excluded: true });
    expect((await api.getFluxDetail(4)).flux.excluded).toBe(true);
    await api.undo();
    expect((await api.getFluxDetail(4)).flux.excluded).toBe(false);
    await api.undo();
    expect((await api.getFluxDetail(4)).isOverridden).toBe(false);
    await api.redo();
    expect((await api.getFluxDetail(4)).options.start).toBe(40);
  }, 20000);
});
