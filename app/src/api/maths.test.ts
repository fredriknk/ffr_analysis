import { afterEach, describe, expect, it, vi } from "vitest";
import { fluxConversion, regression, summarize } from "./maths";
import { createMock } from "./mock";
import type { FluxRow, Plot, Treatment } from "./types";
describe("scientific calculations", () => {
  afterEach(() => vi.unstubAllGlobals());
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
  it("keeps failed fits out of summaries without excluding the flux", () => {
    const rows = [
      {
        id: 1,
        source: "robot",
        plotId: 1,
        time: 0,
        excluded: false,
        N2O_flux: null,
      },
      {
        id: 2,
        source: "robot",
        plotId: 1,
        time: 0,
        excluded: false,
        N2O_flux: 20,
      },
      {
        id: 3,
        source: "robot",
        plotId: 1,
        time: 1,
        excluded: false,
        N2O_flux: 40,
      },
    ] as unknown as FluxRow[];
    const s = summarize(
      rows,
      [{ id: 1, label: "P1", treatmentId: 1 }] as Plot[],
      [{ id: 1, name: "Control", colour: "#123" }] as Treatment[],
      { gas: "N2O", sources: ["robot"], from: 0, to: 0 },
    );
    expect(s.plots[0].points.map((p) => p.fluxId)).toEqual([2]);
    expect(s.plots[0].daily[0].mean).toBe(20);
    expect(rows[0].excluded).toBe(false);
  });
  it("preserves preview, commits half-open windows and supports undo/redo", async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    });
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
    const lagged = await api.getFluxDetail(1009);
    expect(lagged.valveLagS).toBeGreaterThanOrEqual(3);
    expect(lagged.valveLagS).toBeLessThanOrEqual(6);
    expect(lagged.diagnostics.some((d) => d.code === "valve_timing")).toBe(
      true,
    );
    expect(lagged.robust?.map((r) => r.gas)).toEqual(["N2O", "CO2"]);
    expect(lagged.flux.N2O_robustFlux).toBeTypeOf("number");
    expect(lagged.flux.N2O_impact).toBeGreaterThanOrEqual(0);
    expect(lagged.flux.N2O_lagS).toBeGreaterThan(lagged.valveLagS);
    expect(lagged.flux.CO2_impact).toBeGreaterThan(0);
    const robustOptions = { ...lagged.options, fit: "robust" as const };
    const robustPreview = await api.previewFlux(1009, robustOptions);
    expect(robustPreview.flux.CO2_impact).toBe(lagged.flux.CO2_impact);
    expect(robustPreview.regressions.find((r) => r.gas === "CO2")?.flux).toBe(
      lagged.flux.CO2_robustFlux,
    );
    const [robustRow] = await api.setFluxOptions([1009], robustOptions);
    expect(robustRow.CO2_impact).toBe(lagged.flux.CO2_impact);
    expect(robustRow.CO2_flux).toBe(lagged.flux.CO2_robustFlux);
    await api.undo();
    const original = (await api.getFluxDetail(1010)).options;
    await api.setFluxOptions([1009], {
      ...lagged.options,
      start: 30,
      stop: 150,
      perGas: { N2O: { start: 40 } },
    });
    await api.patchFluxOptions([1009, 1010], { valveOffset: lagged.valveLagS });
    const aligned = await api.getFluxDetail(1009);
    expect(aligned.options.start).toBe(30);
    expect(aligned.options.perGas?.N2O?.start).toBe(40);
    expect((await api.getFluxDetail(1010)).options.start).toBe(original.start);
    expect(aligned.traces[0].side).not.toEqual(lagged.traces[0].side);
    expect(
      aligned.traces.every((t) =>
        t.fit.every((v, i) => (v !== null) === t.used[i]),
      ),
    ).toBe(true);
    expect(aligned.diagnostics.some((d) => d.code === "valve_timing")).toBe(
      false,
    );
    await api.undo();
    expect((await api.getFluxDetail(1009)).options.valveOffset).toBe(0);
    expect((await api.getFluxDetail(1010)).options.valveOffset).toBe(0);
    await api.redo();
    expect((await api.getFluxDetail(1010)).options.valveOffset).toBe(
      lagged.valveLagS,
    );
    const thumbs = await api.getFluxThumbs([1009, 1010, 211], "N2O", 30);
    expect(thumbs[0].t.length).toBeLessThanOrEqual(30);
    expect(thumbs[0].t.length).toBe(thumbs[0].used.length);
    const failed = await api.getFluxDetail(211);
    expect(failed.regressions).toHaveLength(0);
    expect(failed.diagnostics.some((d) => d.code === "error")).toBe(true);
    const manual = await api.getFluxDetail(7489),
      table = await api.listFluxes(),
      manualIndex = table.data.id.indexOf(7489);
    expect(manual.traces).toHaveLength(0);
    expect(manual.regressions.find((r) => r.gas === "N2O")?.flux).toBe(
      table.data.N2O_flux[manualIndex],
    );
    expect((await api.getFluxThumbs([7489], "N2O"))[0].t).toHaveLength(0);
    const reloaded = createMock(72);
    expect((await reloaded.getFluxDetail(1009)).options.valveOffset).toBe(
      lagged.valveLagS,
    );
    expect(
      (await reloaded.diagnosticsSummary()).find(
        (d) => d.code === "neighbour_outlier",
      )?.count,
    ).toBeGreaterThan(0);
    const counts = await api.diagnosticsSummary();
    for (const code of [
      "valve_timing",
      "curvature",
      "spike",
      "neighbour_outlier",
      "error",
      "n2o_negative",
      "co2_not_rising",
      "chamber_leak",
      "noisy",
    ])
      expect(counts.find((d) => d.code === code)?.count, code).toBeGreaterThan(
        0,
      );
  }, 20000);
});
