import { diagnosticLabels, score } from "./diagnosticMeta";
import { estimateLag, findings, median, thresholds } from "./diagnostics";
import { findingLevels } from "./findingLevels";
import {
  defaults,
  fluxConversion,
  gases,
  random,
  regression,
  summarize,
} from "./maths";
import { demoPlotGeometry, demoRoute, plotCentre } from "./mockRoute";
import type * as T from "./types";
import { mockWaypointPlots, waypointNumber } from "./mockWaypointPlots";
const colours = [
  "#217a70",
  "#b46c28",
  "#677bba",
  "#a35e85",
  "#558442",
  "#b4544e",
  "#387fa3",
  "#907539",
  "#795da7",
  "#648781",
  "#b15c69",
  "#668142",
];
const names = [
  "Control",
  "Mineral N",
  "Slurry",
  "Digestate",
  "Compost",
  "Biochar",
  "Clover",
  "Reduced N",
  "Split N",
  "Inhibitor",
  "Cover crop",
  "No till",
];
const start = Date.UTC(2023, 0, 4, 11),
  end = start + 728 * 86400000;
/** The user's per-gas exclusion choices. */
const gasChoices = new Map<number, Record<string, boolean>>();
/** `<gas>_excluded` from the user's choice (default included). */
function applyGasExclusion(r: T.FluxRow) {
  const choice = gasChoices.get(r.id) ?? {};
  for (const g of ["CO2", "N2O", "CO", "H2O", "licor_H2O"])
    r[g + "_excluded"] = choice[g] ?? false;
}
export function createMock(seed = 42): T.FfrApi {
  let config: T.ProjectConfig = {
    name: "Ås field trial · 2023–24",
    timeZone: "Europe/Oslo",
    defaults: { ...defaults },
    gases: [...gases],
    fallbackTemperature: 10,
    chamberHeight: 0.5,
    pressure: 101000,
    qcThreshold: 0.8,
    diagnostics: { ...thresholds },
    plotAssignment: "polygons",
    crs: "EPSG:32632",
  };
  let layout: T.Layout = {
    treatments: names.map((name, i) => ({
      id: i + 1,
      name,
      shortName: name,
      colour: colours[i],
      sortOrder: i,
    })),
    plots: demoPlotGeometry(
      Array.from({ length: 36 }, (_, i) => ({
        id: i + 1,
        label: "P" + String(i + 1).padStart(2, "0"),
        treatmentId: Math.floor(i / 3) + 1,
        block: (i % 3) + 1,
        polygon: null,
      })),
    ),
  };
  const demoRouteStored = (): T.StoredRoute => ({
    points: demoRoute(),
    sourcePath: "demo_route.csv",
    savedAt: start,
  });
  let route: T.StoredRoute | null = demoRouteStored();
  let rawFolder: T.RawFolder | null = null;
  let open = false,
    path = "demo.ffr",
    clientId: string | null = null;
  const opts = new Map<number, T.AnalysisOptions>(),
    listeners = new Set<(p: T.Progress) => void>();
  const rows: T.FluxRow[] = [];
  function trace(
    row: T.FluxRow,
    gas: T.Gas,
    options: T.AnalysisOptions,
  ): T.Trace {
    const rng = random(
        seed + (row.measurementId ?? row.id) * 313 + gases.indexOf(gas) * 7919,
      ),
      base =
        gas === "N2O" ? 0.33 : gas === "CO2" ? 420 : gas === "CO" ? 0.12 : 9000;
    const growth =
      gas === "N2O" ? 0.02 : gas === "CO2" ? 80 : gas === "CO" ? 0.01 : 300;
    const k = (row.measurementId ?? row.id) % 29;
    const campaign = Math.floor((row.time - start) / 86400000 / 7),
      trueLag =
        (campaign >= 14 && campaign <= 18 ? 3 + (campaign % 3) : 0) +
        (gas === "N2O" ? 2 : 0);
    const rate =
      (growth * (0.08 + (row.treatmentId / 12) * 0.7 + rng() * 0.22)) / 185;
    const t = Array.from({ length: 186 }, (_, i) => i);
    const side = t.map((v) => {
      const shifted = v - options.valveOffset,
        phase = ((shifted % 20) + 20) % 20;
      return shifted < 0 ||
        phase < options.cutBeginnings ||
        phase >= 20 - options.cutEnds
        ? 0
        : Math.floor((shifted + 200) / 20) % 2
          ? 2
          : 1;
    }) as (0 | 1 | 2)[];
    const y = t.map((v) => {
      const physical = v - trueLag,
        phase = ((physical % 20) + 20) % 20,
        chamber = Math.floor((physical + 200) / 20) % 2;
      const leak = k === 1 || k === 4;
      const slope = leak
        ? gas === "N2O"
          ? -rate
          : gas === "CO2"
            ? k === 4
              ? 0
              : -rate * 0.35
            : rate
        : k === 0
          ? 0
          : rate;
      const signal = k === 3 ? slope * v * Math.exp(-v / 90) : slope * v;
      const neighbour = (row.measurementId ?? 0) % 317 === 0 ? 4 : 1;
      return (
        base +
        chamber * growth * 0.12 +
        signal * (chamber ? 1.17 : 1) * neighbour +
        (rng() - 0.5) * growth * 0.012 +
        (phase < 2 ? growth * 0.025 * Math.exp(-phase) : 0) +
        (k === 2 && v % 20 === 10 ? growth * 0.3 : 0)
      );
    });
    // A few files have an N2O analyser dropout (zeros) in a left-chamber segment.
    if (
      ["N2O", "CO", "H2O"].includes(gas) &&
      (row.measurementId ?? 0) % 41 === 7
    )
      for (let i = 125; i < 129; i++) y[i] = 0;
    return {
      gas,
      unit: "ppm",
      t,
      y,
      side,
      fit: t.map(() => null),
      used: t.map(
        (v, i) =>
          side[i] === (row.side === "left" ? 1 : 2) &&
          v >= options.start &&
          v < options.stop &&
          y[i] !== 0,
      ),
    };
  }
  function fit(row: T.FluxRow, gas: T.Gas, o: T.AnalysisOptions): T.Regression {
    const op = { ...o, ...o.perGas?.[gas] },
      tr = trace(row, gas, op);
    let indices = tr.t.filter((_, i) => tr.used[i]);
    let ys = tr.y.filter((_, i) => tr.used[i]);
    if (op.mode === "auto") {
      let best: T.Regression | undefined;
      let bestStart = op.start;
      for (let s = op.start; s + op.interval <= op.stop; s += 1) {
        const xx = tr.t.filter(
            (v, i) => tr.used[i] && v >= s && v < s + op.interval,
          ),
          yy = tr.y.filter(
            (_, i) => tr.used[i] && tr.t[i] >= s && tr.t[i] < s + op.interval,
          );
        if (xx.length < 4) continue;
        const r = regression(xx, yy, gas, row.airTemp);
        if (
          !best ||
          (op.crit === "steepest" ? r.slope > best.slope : r.mse < best.mse)
        ) {
          best = r;
          bestStart = s;
        }
      }
      indices = tr.t.filter(
        (v, i) => tr.used[i] && v >= bestStart && v < bestStart + op.interval,
      );
      ys = tr.y.filter(
        (_, i) =>
          tr.used[i] &&
          tr.t[i] >= bestStart &&
          tr.t[i] < bestStart + op.interval,
      );
    }
    const r = regression(indices, ys, gas, row.airTemp);
    if (op.mode === "manual") {
      r.slope = op.slope ?? 0;
      r.flux = fluxConversion(
        r.slope,
        row.airTemp,
        gas,
        config.chamberHeight,
        config.pressure,
      );
      r.qc = "manual";
    } else
      r.flux = fluxConversion(
        r.slope,
        row.airTemp,
        gas,
        config.chamberHeight,
        config.pressure,
      );
    if (gas === "N2O" && r.rsq < config.qcThreshold) r.qc = "check fit";
    return r;
  }
  function results(r: T.FluxRow, o: T.AnalysisOptions) {
    let actual = o;
    if (o.mode === "auto" && o.co2Guides) {
      const guide = fit(r, "CO2", o);
      actual = {
        ...o,
        mode: "fixed",
        start: guide.start,
        stop: guide.stop + 1,
      };
    }
    return gases.map((g) => fit(r, g, actual));
  }
  const diagnosticMap = new Map<number, T.Diagnostic[]>(),
    lagCache = new Map<number, { lag: number; improvement: number }>();
  function analyse(r: T.FluxRow, o: T.AnalysisOptions) {
    if (r.source === "manual")
      return {
        regs: gases.map((g) => ({
          ...regression([], [], g, r.airTemp),
          flux: Number(r[g + "_flux"] ?? 0),
          slope:
            Number(r[g + "_flux"] ?? 0) /
            fluxConversion(
              1,
              r.airTemp,
              g,
              config.chamberHeight,
              config.pressure,
            ),
          qc: "manual",
        })),
        traces: [],
        robust: [] as T.RobustRegression[],
        lag: 0,
        diagnostics: [] as T.Diagnostic[],
      };

    const failed = r.measurementId === 106,
      regs = failed ? [] : results(r, o),
      traces = gases.map((g) => trace(r, g, o));
    const rawLag =
      lagCache.get(r.measurementId ?? r.id) ??
      estimateLag(traces.find((t) => t.gas === "CO2")!, {
        ...defaults,
        valveOffset: 0,
      });
    lagCache.set(r.measurementId ?? r.id, rawLag);
    const improvement =
      Math.abs(rawLag.lag - o.valveOffset) < 1.5 ? 0 : rawLag.improvement;
    const robust: T.RobustRegression[] = failed
      ? []
      : (["N2O", "CO2"] as T.Gas[]).map((g) => {
          const effective = { ...o, ...o.perGas?.[g] },
            lag = rawLag.lag + (g === "N2O" ? 2 : 0),
            robustOptions = {
              ...effective,
              perGas: {},
              valveOffset: Math.abs(lag) >= 1 ? lag : effective.valveOffset,
              cutBeginnings: effective.cutBeginnings + 3,
              cutEnds: effective.cutEnds + 3,
            },
            tr = trace(r, g, robustOptions),
            indices = tr.t.flatMap((_, i) => (tr.used[i] ? [i] : []));
          const fit = regression(
              indices.map((i) => tr.t[i]),
              indices.map((i) => tr.y[i]),
              g,
              r.airTemp,
            ),
            res = indices.map(
              (i) => tr.y[i] - fit.intercept - fit.slope * tr.t[i],
            ),
            centre = median(res),
            mad = Math.max(
              1e-12,
              median(res.map((v) => Math.abs(v - centre))) * 1.4826,
            ),
            kept = indices.filter(
              (_, j) => Math.abs(res[j] - centre) <= 4 * mad,
            ),
            f = regression(
              kept.map((i) => tr.t[i]),
              kept.map((i) => tr.y[i]),
              g,
              r.airTemp,
            );
          return {
            gas: g,
            slope: f.slope,
            intercept: f.intercept,
            start: f.start,
            stop: f.stop,
            n: f.n,
            flux: fluxConversion(
              f.slope,
              r.airTemp,
              g,
              config.chamberHeight,
              config.pressure,
            ),
          };
        });
    // The robust fit method reports the robust refit for N2O and CO2.
    if (o.fit === "robust")
      for (const fit of robust) {
        const i = regs.findIndex((v) => v.gas === fit.gas);
        if (i >= 0)
          regs[i] = {
            ...regs[i],
            slope: fit.slope,
            intercept: fit.intercept,
            n: fit.n,
            flux: fit.flux,
          };
      }
    return {
      regs,
      traces,
      robust,
      lag: rawLag.lag,
      diagnostics: findings(
        r,
        regs,
        traces,
        o,
        config,
        rawLag.lag,
        improvement,
      ),
    };
  }
  function refresh(r: T.FluxRow) {
    if (r.source === "manual")
      for (const gas of gases)
        if (typeof r[gas + "_flux"] !== "number")
          r[gas + "_flux"] = fluxConversion(
            (gas === "N2O" ? 0.00004 : 0.2) * (1 + Math.sin(r.id)),
            r.airTemp,
            gas,
          );
    const a = analyse(r, opts.get(r.id) ?? config.defaults);
    gases.forEach((g) => {
      const v = a.regs.find((r) => r.gas === g);
      for (const [key, value] of Object.entries({
        flux: v?.flux ?? null,
        slope: v?.slope ?? null,
        rsq: v?.rsq ?? null,
        pval: v?.pval ?? null,
        n: v?.n ?? 0,
        resid: v ? Math.sqrt(v.mse) : null,
      }))
        r[g + "_" + key] = value;
    });
    r.N2O_qc = a.regs.find((r) => r.gas === "N2O")?.qc ?? "error";
    r.valveLagS = a.lag;
    r.N2O_lagS = r.source === "robot" ? a.lag + 2 : 0;
    for (const g of ["N2O", "CO2"]) {
      const robust = a.robust.find((v) => v.gas === g),
        value = Number(r[g + "_flux"]);
      r[g + "_robustFlux"] = robust?.flux ?? null;
      r[g + "_impact"] = robust
        ? Math.abs(value - robust.flux) /
          Math.max(
            Math.abs(value),
            Math.abs(robust.flux),
            g === "N2O" ? 1 : 1000,
          )
        : null;
    }
    a.diagnostics = a.diagnostics.filter((d) => d.code !== "co2_low_r2");
    for (const finding of a.diagnostics)
      if (["valve_timing", "edge_transient", "spike"].includes(finding.code)) {
        const impact = Number(r[(finding.gas ?? "N2O") + "_impact"] ?? 0);
        finding.severity =
          impact >= 0.3 ? "bad" : impact >= 0.1 ? "warn" : "info";
      }
    if (
      r.source === "robot" &&
      r.N2O_qc !== "error" &&
      Number(r.CO2_flux) < 5000
    )
      a.diagnostics.push({
        code: "chamber_leak",
        severity: Number(r.CO2_flux) < 0 ? "bad" : "warn",
        gas: "CO2",
        message:
          "CO₂ respiration is far below the daily field median; inspect the chamber seal.",
        value: Number(r.CO2_flux),
      });
    if (r.source === "robot" && (r.measurementId ?? 0) % 29 === 2)
      a.diagnostics.push({
        code: "noisy",
        severity: Number(r.N2O_impact) > 0.3 ? "bad" : "warn",
        gas: "N2O",
        message:
          "Residual noise is high compared with this project's typical analyzer noise.",
        value: Number(r.N2O_resid),
      });
    const effective = opts.get(r.id) ?? config.defaults;
    for (const g of ["N2O", "CO2"] as T.Gas[]) {
      const tr = a.traces.find((t) => t.gas === g),
        o = { ...effective, ...effective.perGas?.[g] },
        side = r.side === "left" ? 1 : 2;
      if (!tr || r.source !== "robot") continue;
      const window = tr.t.flatMap((t, i) =>
          tr.side[i] === side && t >= o.start && t < o.stop ? [i] : [],
        ),
        zeros = window.filter((i) => tr.y[i] === 0).length;
      if (!zeros) continue;
      a.diagnostics.push({
        code: "zero_readings",
        severity: "warn",
        gas: g,
        value: zeros,
        message: `The ${g} analyser returned 0 for ${zeros} of ${window.length} readings in this chamber's window (instrument dropout). Zero readings are left out of the fit and hidden from the trace; check that enough points remain, or exclude ${g} for this flux.`,
      });
    }
    applyGasExclusion(r);
    r.overridden = opts.has(r.id);
    diagnosticMap.set(r.id, a.diagnostics);
    r.diagSeverity = findingLevels(a.diagnostics);
    r.diag = [...new Set(a.diagnostics.map((d) => d.code))].join(",");
    r.attention = score(a.diagnostics);
  }
  function neighbours() {
    const treatments = new Map<number, T.FluxRow[]>(),
      plots = new Map<number, T.FluxRow[]>();
    for (const r of rows) {
      if (r.excluded) continue;
      for (const [map, key] of [
        [treatments, r.treatmentId],
        [plots, r.plotId],
      ] as const) {
        let group = map.get(key);
        if (!group) {
          group = [];
          map.set(key, group);
        }
        group.push(r);
      }
    }
    for (const map of [treatments, plots])
      for (const group of map.values()) group.sort((a, b) => a.time - b.time);
    const range = (group: T.FluxRow[], time: number, gap: number) => {
      const lower = (t: number) => {
        let lo = 0,
          hi = group.length;
        while (lo < hi) {
          const m = (lo + hi) >>> 1;
          if (group[m].time < t) lo = m + 1;
          else hi = m;
        }
        return lo;
      };
      return group.slice(lower(time - gap), lower(time + gap + 1));
    };
    for (const r of rows) {
      const ds = (diagnosticMap.get(r.id) ?? []).filter(
        (d) => d.code !== "neighbour_outlier",
      );
      if (r.source === "robot" && r.N2O_qc !== "error") {
        let peers = range(
          treatments.get(r.treatmentId) ?? [],
          r.time,
          3 * 86400000,
        );
        if (peers.length < 6)
          peers = range(plots.get(r.plotId) ?? [], r.time, 10 * 86400000);
        if (peers.length >= 6)
          for (const gas of ["N2O", "CO2"]) {
            const vs = peers
                .filter((p) => typeof p[gas + "_flux"] === "number")
                .map((p) => Math.asinh(Number(p[gas + "_flux"]))),
              m = median(vs),
              mad = median(vs.map((v) => Math.abs(v - m))) * 1.4826,
              z =
                Math.abs(Math.asinh(Number(r[gas + "_flux"])) - m) /
                Math.max(0.01, mad);
            if (z > (config.diagnostics.neighbourZ ?? 5))
              ds.push({
                code: "neighbour_outlier",
                severity: "warn",
                gas,
                value: z,
                message:
                  "This flux is far from comparable measurements in the same treatment and nearby dates.",
              });
          }
      }
      ds.sort(
        (a, b) =>
          ({ bad: 0, warn: 1, info: 2 })[a.severity] -
          { bad: 0, warn: 1, info: 2 }[b.severity],
      );
      diagnosticMap.set(r.id, ds);
      r.diagSeverity = findingLevels(ds);
      r.diag = [...new Set(ds.map((d) => d.code))].join(",");
      r.attention = score(ds);
    }
  }
  function setRowPlot(r: T.FluxRow, plot?: T.Plot) {
    const treatment = layout.treatments.find((t) => t.id === plot?.treatmentId);
    Object.assign(r, {
      plotId: plot?.id ?? 0,
      plotLabel: plot?.label ?? "—",
      treatmentId: plot?.treatmentId ?? 0,
      treatmentName: treatment?.name ?? "Unassigned",
    });
  }
  function assignRobotPlot(r: T.FluxRow) {
    if (r.plotOverride != null) {
      setRowPlot(
        r,
        layout.plots.find((p) => p.id === r.plotOverride),
      );
      return;
    }
    const filename = r.filename.split(/[\\/]/).pop() ?? "";
    const waypointName = filename.match(/(?:left|right|both)(.*)/)?.[1] ?? "";
    const waypoint = waypointNumber(waypointName);
    const visitPlot = layout.plots.find((p) =>
      p.waypoints?.some((v) => v.waypoint === waypoint && v.side === r.side),
    );
    setRowPlot(
      r,
      visitPlot ?? layout.plots.find((p) => inside(p.polygon ?? [], r.x, r.y)),
    );
  }
  function makeRow(id: number, manual = false): T.FluxRow {
    const i = id - 1,
      p = layout.plots[i % Math.max(1, layout.plots.length)] ?? {
        id: 0,
        label: "Unassigned",
        treatmentId: 0,
        waypoints: null,
      },
      time = manual
        ? start + ((i * 4) % 728) * 86400000
        : start + Math.floor(i / 72) * 7 * 86400000 + (i % 72) * 190000,
      side = i % 2 ? "right" : "left",
      visit = p.waypoints?.find((v) => v.side === side);
    return {
      id,
      measurementId: manual ? null : Math.floor(i / 2) + 1,
      source: manual ? "manual" : "robot",
      time,
      filename: manual
        ? "Manual campaign"
        : "FFR_" +
          new Date(time).toISOString().slice(0, 10) +
          "_" +
          Math.floor(i / 2 + 1) +
          (visit ? "_both_Plot_" + visit.waypoint : ""),
      side,
      plotId: p.id,
      plotLabel: p.label,
      treatmentId: p.treatmentId,
      treatmentName:
        layout.treatments.find((t) => t.id === p.treatmentId)?.name ??
        "Unassigned",
      excluded: false,
      reviewed: i % 5 === 0,
      overridden: false,
      note: "",
      airTemp:
        8 + 11 * Math.sin(((time - start) / 86400000 / 365) * Math.PI * 2),
      soilMoisture: 0.28 + 0.05 * Math.sin((time - start) / 86400000 / 15),
      soilTemperature:
        8 + 11 * Math.sin(((time - start) / 86400000 / 365) * Math.PI * 2),
      precip: Math.max(0, Math.sin(i * 7) * 4 - 2),
      attention: 0,
      diag: "",
      valveLagS: 0,
      // Chamber position: the plot centre with a little GPS scatter.
      x: plotCentre(p.id)[0] + Math.sin(i * 12.9898) * 0.6,
      y: plotCentre(p.id)[1] + Math.cos(i * 78.233) * 0.6,
    };
  }
  for (let i = 1; i <= 7488; i++) {
    const r = makeRow(i);
    refresh(r);
    rows.push(r);
  }
  for (let i = 7489; i <= 7638; i++) {
    const r = makeRow(i, true);
    gases.forEach((g) => {
      r[g + "_flux"] = fluxConversion(
        (g === "N2O" ? 0.00004 : 0.2) * (1 + Math.sin(i)),
        r.airTemp,
        g,
      );
    });
    r.N2O_qc = "manual";
    rows.push(r);
  }
  neighbours();
  type Snapshot = {
    diagnostics: [number, T.Diagnostic[]][];
    rows: T.FluxRow[];
    opts: [number, T.AnalysisOptions][];
    config: T.ProjectConfig;
    layout: T.Layout;
    series: T.SeriesMeta[];
    gasChoices?: [number, Record<string, boolean>][];
  };
  let series: T.SeriesMeta[] = [
    ["air_temperature", "Air temperature", "°C", "Weather"],
    ["sum(precipitation_amount PT1H)", "Precipitation", "mm", "Weather"],
    ["VWC_GROUND", "Soil moisture", "m³ m⁻³", "Logger"],
    ["TEMPC_GROUND", "Soil temperature", "°C", "Logger"],
  ].map(([key, name, unit, source], i) => ({
    id: i + 1,
    key,
    name,
    unit,
    source,
    count: 17473,
    timeRange: [start, end],
  }));
  const undoStack: { before: Snapshot; after: Snapshot; change: T.Change }[] =
      [],
    redoStack: typeof undoStack = [];
  const snapshot = (): Snapshot =>
    structuredClone({
      rows,
      diagnostics: [...diagnosticMap],
      opts: [...opts],
      config,
      layout,
      series,
      gasChoices: [...gasChoices],
    });
  const restore = (s: Snapshot) => {
    rows.splice(0, rows.length, ...structuredClone(s.rows));
    diagnosticMap.clear();
    s.diagnostics.forEach(([id, ds]) =>
      diagnosticMap.set(id, structuredClone(ds)),
    );
    opts.clear();
    s.opts.forEach(([id, o]) => opts.set(id, structuredClone(o)));
    config = structuredClone(s.config);
    layout = structuredClone(s.layout);
    series = structuredClone(s.series);
    gasChoices.clear();
    s.gasChoices?.forEach(([id, c]) => gasChoices.set(id, { ...c }));
  };
  const persist = () => {
    try {
      sessionStorage.setItem(
        "ffr-mock-edits",
        JSON.stringify({
          opts: [...opts],
          flags: rows.map((r) => ({
            id: r.id,
            excluded: r.excluded,
            reviewed: r.reviewed,
            note: r.note,
            plotId: r.plotId,
            plotOverride: r.plotOverride ?? null,
          })),
          config,
          layout,
        }),
      );
    } catch {
      /* storage optional */
    }
  };
  try {
    const s = JSON.parse(sessionStorage.getItem("ffr-mock-edits") ?? "null");
    if (s) {
      config = {
        ...s.config,
        diagnostics: { ...thresholds, ...s.config.diagnostics },
        defaults: { ...defaults, ...s.config.defaults },
      };
      layout = s.layout;
      for (const [id, o] of s.opts) opts.set(id, { ...defaults, ...o });
      for (const f of s.flags) {
        const r = rows[f.id - 1];
        if (!r) continue;
        // Older saved edits stored the assigned plot under plotOverride.
        const { plotId, plotOverride, ...flags } = f;
        Object.assign(r, flags, {
          plotOverride: plotId === undefined ? null : plotOverride,
        });
        setRowPlot(
          r,
          layout.plots.find((p) => p.id === (plotId ?? plotOverride)),
        );
      }
      rows.filter((r) => r.source === "robot").forEach(refresh);
      neighbours();
    }
  } catch {
    /* browser or test without storage */
  }
  function change(kind: string, ids: number[], fn: () => void) {
    const before = snapshot();
    fn();
    neighbours();
    undoStack.push({
      before,
      after: snapshot(),
      change: {
        id: Date.now(),
        time: Date.now(),
        kind,
        fluxIds: ids,
        before: kind + " before",
        after: kind + " after",
      },
    });
    redoStack.length = 0;
    persist();
  }
  const demo = snapshot();
  const row = (id: number) => {
    const r = rows.find((r) => r.id === id);
    if (!r) throw { code: "NOT_FOUND", message: "Flux not found" };
    return r;
  };
  const info = (): T.ProjectInfo => ({
    path,
    name: config.name,
    timeZone: config.timeZone,
    schemaVersion: 1,
    counts: {
      measurements: new Set(
        rows
          .filter((r) => r.measurementId !== null)
          .map((r) => r.measurementId),
      ).size,
      fluxes: rows.length,
      excluded: rows.filter((r) => r.excluded).length,
      overridden: opts.size,
      reviewed: rows.filter((r) => r.reviewed).length,
      manual: rows.filter((r) => r.source === "manual").length,
      series: series.length,
    },
    timeRange: rows.length
      ? [
          Math.min(...rows.map((r) => r.time)),
          Math.max(...rows.map((r) => r.time)),
        ]
      : null,
  });
  const progress = async (task: string) => {
    for (let done = 0; done <= 5; done++) {
      listeners.forEach((cb) =>
        cb({
          task,
          done,
          total: 5,
          message: done === 5 ? "Complete" : "Processing synthetic demo…",
        }),
      );
      await new Promise((r) => setTimeout(r, 80));
    }
  };
  const detail = (
    id: number,
    o = opts.get(id) ?? config.defaults,
  ): T.FluxDetail => {
    const r = row(id),
      sibling = r.source === "manual" ? null : row(id % 2 ? id + 1 : id - 1),
      a = analyse(r, o),
      regs = a.regs;
    return {
      robust: a.robust,
      diagnostics: a.diagnostics.concat(
        (diagnosticMap.get(id) ?? []).filter(
          (d) =>
            [
              "neighbour_outlier",
              "chamber_leak",
              "noisy",
              "zero_readings",
            ].includes(d.code) && !a.diagnostics.some((f) => f.code === d.code),
        ),
      ),
      valveLagS: a.lag,
      flux: { ...r },
      options: structuredClone(o),
      isOverridden: opts.has(id),
      siblingFluxId: sibling?.id ?? null,
      switches: Array.from({ length: 10 }, (_, i) => ({
        t: i * 20,
        side: i % 2 ? "right" : "left",
      })),
      traces:
        r.source === "manual"
          ? []
          : gases.map((g) => {
              const tr = trace(r, g, { ...o, ...o.perGas?.[g] }),
                fit = regs.find((v) => v.gas === g)!;
              tr.used = tr.used.map(
                (v, i) =>
                  v &&
                  tr.t[i] >= (fit?.start ?? Infinity) &&
                  tr.t[i] <= (fit?.stop ?? -Infinity),
              );
              tr.fit = tr.t.map((t, i) =>
                tr.used[i] && fit ? fit.intercept + fit.slope * t : null,
              );
              return tr;
            }),
      regressions: regs,
      sibling: sibling
        ? results(sibling, opts.get(sibling.id) ?? config.defaults)
        : [],
    };
  };
  const report = (n: number): T.ImportReport => ({
    imported: n,
    skipped: 0,
    errors: [],
  });
  function download(args: T.ExportArgs, mode = "flat") {
    let chosen = rows.filter((r) => args.fluxIds.includes(r.id));
    const escape = (v: unknown) =>
      '"' + String(v ?? "").replaceAll('"', '""') + '"';
    let content = [
      args.columns.join(","),
      ...chosen.map((r) => args.columns.map((c) => escape(r[c])).join(",")),
    ].join("\r\n");
    if (mode === "sheetPerPlot") {
      chosen = chosen.sort((a, b) => a.plotId - b.plotId);
      content =
        "plot," +
        args.columns.join(",") +
        "\r\n" +
        chosen
          .map(
            (r) =>
              r.plotLabel +
              "," +
              args.columns.map((c) => escape(r[c])).join(","),
          )
          .join("\r\n");
    }
    if (mode === "dailyPerPlot") {
      const s = summarize(chosen, layout.plots, layout.treatments, {
        gas: "N2O",
        sources: ["robot", "manual"],
      });
      content =
        "plot,date,mean,cumulative\r\n" +
        s.plots
          .flatMap((p) =>
            p.daily.map((d) =>
              [
                p.label,
                new Date(d.time).toISOString(),
                d.mean,
                d.cumulative,
              ].join(","),
            ),
          )
          .join("\r\n");
    }
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([content], { type: "text/csv;charset=utf-8" }),
      );
    a.href = url;
    a.download = args.path.replace(/\.xlsx$/i, ".csv") || "fluxes.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    startupPath: async () => null,
    projectCreate: async (p, name) => {
      path = p;
      config.name = name;
      rows.splice(0);
      layout = { treatments: [], plots: [] };
      route = null;
      diagnosticMap.clear();
      opts.clear();
      series = [];
      undoStack.length = 0;
      redoStack.length = 0;
      open = true;
      return info();
    },
    projectOpen: async (p) => {
      restore(demo);
      route = demoRouteStored();
      path = p;
      open = true;
      return info();
    },
    projectClose: async () => {
      open = false;
    },
    projectInfo: async () => (open ? info() : null),
    projectSaveCopy: async () => {
      await progress("Backup");
    },
    recentProjects: async () => [
      { path: "demo.ffr", name: config.name, openedAt: Date.now() },
    ],
    legacyScan: async (dir) => ({
      configPaths: [dir + "/config.yml"],
      rawFiles: 3744,
      manualExists: true,
      loggerExists: true,
      weatherExists: true,
      warnings: ["Browser demo uses synthetic inputs only."],
    }),
    legacyImport: async (args) => {
      await progress("Import legacy project");
      path = args.outPath;
      open = true;
      return info();
    },
    importRawFiles: async (paths) => {
      await progress("Import raw files");
      change("Import raw files", [], () =>
        paths.forEach((filename) => {
          const measurementId =
            Math.max(...rows.map((r) => r.measurementId ?? 0)) + 1;
          for (let i = 0; i < 2; i++) {
            const r = makeRow(rows.length + 1);
            r.filename = filename;
            r.measurementId = measurementId;
            assignRobotPlot(r);
            refresh(r);
            rows.push(r);
          }
        }),
      );
      return report(paths.length);
    },
    getConfig: async () => structuredClone(config),
    setConfig: async (cfg) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: cfg.timeZone });
      } catch {
        throw {
          code: "TIME_ZONE",
          message: "Enter a valid IANA time zone, such as Europe/Oslo.",
        };
      }
      if (
        cfg.defaults.start < 0 ||
        cfg.defaults.stop > 185 ||
        cfg.defaults.start >= cfg.defaults.stop ||
        cfg.chamberHeight <= 0
      )
        throw {
          code: "CONFIG",
          message: "Check the window bounds and chamber height.",
        };
      change("Project settings", [], () => {
        config = structuredClone(cfg);
        rows.filter((r) => r.source === "robot").forEach(refresh);
      });
    },
    getLayout: async () => structuredClone(layout),
    setLayout: async (l) => {
      change("Field layout", [], () => {
        layout = structuredClone(l);
        rows.forEach((r) => {
          if (r.source === "robot") {
            assignRobotPlot(r);
            return;
          }
          const p = l.plots.find((p) => p.id === r.plotId),
            t = l.treatments.find((t) => t.id === p?.treatmentId);
          if (p && t)
            Object.assign(r, {
              plotLabel: p.label,
              treatmentId: t.id,
              treatmentName: t.name,
            });
        });
      });
    },
    listFluxes: async () => {
      const example = rows[0] ?? demo.rows[0];
      const keys = Object.keys(example);
      const columns: T.ColumnMeta[] = keys.map((key) => ({
        key,
        label:
          (
            {
              id: "Flux ID",
              measurementId: "File ID",
              source: "Source",
              time: "Measured at",
              filename: "Raw file",
              side: "Chamber",
              plotId: "Plot ID",
              plotLabel: "Plot",
              treatmentId: "Treatment ID",
              treatmentName: "Treatment",
              excluded: "Excluded",
              reviewed: "Reviewed",
              overridden: "Custom options",
              note: "Note",
              airTemp: "Air temperature",
              precip: "Precipitation",
              soilMoisture: "Soil moisture",
              soilTemperature: "Soil temperature",
              attention: "Attention score",
              diag: "Diagnostic codes",
              valveLagS: "Estimated valve lag",
            } as Record<string, string>
          )[key] ??
          key.replace(
            /_(slope|rsq|pval|flux|n|resid|qc)$/,
            (v) =>
              ({
                _slope: " slope",
                _rsq: " R²",
                _pval: " p value",
                _flux: " flux",
                _n: " points",
                _resid: " residual SD",
                _qc: " quality",
              })[v] ?? v,
          ),
        type:
          key === "time"
            ? "time"
            : typeof example[key] === "number"
              ? "number"
              : typeof example[key] === "boolean"
                ? "boolean"
                : [
                      "source",
                      "side",
                      "treatmentName",
                      "plotLabel",
                      "N2O_qc",
                    ].includes(key)
                  ? "category"
                  : "string",
        group: gases.some((g) => key.startsWith(g + "_"))
          ? "Gas results"
          : ["airTemp", "precip", "soilMoisture", "soilTemperature"].includes(
                key,
              )
            ? "External"
            : "Measurement",
        unit:
          key === "valveLagS"
            ? "s"
            : key.endsWith("_resid")
              ? "ppm"
              : key.endsWith("_slope")
                ? "ppm s⁻¹"
                : key.endsWith("_flux")
                  ? key === "N2O_flux" || key === "CO2_flux"
                    ? "µg m⁻² h⁻¹"
                    : "mol m⁻² s⁻¹"
                  : key === "airTemp"
                    ? "°C"
                    : undefined,
      }));
      return {
        columns,
        rows: rows.length,
        data: Object.fromEntries(
          keys.map((k) => [k, rows.map((r) => r[k] ?? null)]),
        ),
      };
    },
    getFluxDetail: async (id) => detail(id),
    previewFlux: async (id, o) => detail(id, o),
    setFluxOptions: async (ids, o) => {
      if (o && (o.start >= o.stop || o.start < 0 || o.stop > 185))
        throw {
          code: "WINDOW",
          message: "Window must satisfy 0 = start < stop = 185 s.",
        };
      change("Analysis window", ids, () =>
        ids.forEach((id) => {
          if (o) opts.set(id, structuredClone(o));
          else opts.delete(id);
          refresh(row(id));
        }),
      );
      return ids.map((id) => ({ ...row(id) }));
    },
    setFluxFlags: async (ids, flags) => {
      change("Flux flags", ids, () =>
        ids.forEach((id) => {
          const r = row(id),
            { gasExcluded, ...rest } = flags;
          Object.assign(r, rest);
          if (gasExcluded) {
            const merged = { ...gasChoices.get(id) };
            for (const [g, v] of Object.entries(gasExcluded))
              if (v === null || v === undefined) delete merged[g];
              else merged[g] = v;
            gasChoices.set(id, merged);
            applyGasExclusion(r);
          }
          if (flags.plotOverride !== undefined) {
            if (r.source === "robot") assignRobotPlot(r);
            else if (flags.plotOverride !== null)
              setRowPlot(
                r,
                layout.plots.find((p) => p.id === flags.plotOverride),
              );
          }
        }),
      );
      return ids.map((id) => ({ ...row(id) }));
    },
    patchFluxOptions: async (ids, partial) => {
      change("Patch analysis options", ids, () =>
        ids.forEach((id) => {
          const effective = opts.get(id) ?? config.defaults;
          opts.set(id, {
            ...effective,
            ...structuredClone(partial),
            perGas: partial.perGas
              ? Object.fromEntries(
                  [
                    ...new Set([
                      ...Object.keys(effective.perGas ?? {}),
                      ...Object.keys(partial.perGas),
                    ]),
                  ].map((g) => [
                    g,
                    {
                      ...effective.perGas?.[g as T.Gas],
                      ...partial.perGas?.[g as T.Gas],
                    },
                  ]),
                )
              : effective.perGas,
          });
          refresh(row(id));
        }),
      );
      return ids.map((id) => ({ ...row(id) }));
    },
    getFluxThumbs: async (ids, gas, maxPoints = 60) =>
      ids.map((id) => {
        const r = row(id),
          d = detail(id),
          tr = d.traces.find((t) => t.gas === gas),
          reg = d.regressions.find((r) => r.gas === gas),
          indices =
            tr?.t.flatMap((_, i) =>
              tr.side[i] === (r.side === "left" ? 1 : 2) ? [i] : [],
            ) ?? [],
          step = Math.max(
            1,
            Math.ceil(indices.length / Math.max(2, maxPoints)),
          ),
          selected = indices.filter((_, i) => i % step === 0);
        return {
          fluxId: id,
          t: selected.map((i) => tr!.t[i]),
          y: selected.map((i) => tr!.y[i]),
          used: selected.map((i) => tr!.used[i]),
          slope: reg?.slope ?? 0,
          intercept: reg?.intercept ?? 0,
        };
      }),
    diagnosticsSummary: async () =>
      Object.entries(diagnosticLabels)
        .filter(([code]) => code !== "co2_low_r2")
        .map(([code, label]) => {
          const found = rows.filter((r) => r.diag.split(",").includes(code)),
            d = [...diagnosticMap.values()].flat().find((d) => d.code === code);
          return {
            code,
            label,
            description: d?.message ?? label,
            severity: d?.severity ?? "info",
            count: found.length,
            unreviewed: found.filter((r) => !r.reviewed).length,
          };
        }),
    recomputeAll: async () => {
      await progress("Recompute");
      rows.filter((r) => r.source === "robot").forEach(refresh);
      neighbours();
    },
    undo: async () => {
      const c = undoStack.pop();
      if (c) {
        restore(c.before);
        redoStack.push(c);
        persist();
      }
      return {
        changed: !!c,
        canUndo: !!undoStack.length,
        canRedo: !!redoStack.length,
      };
    },
    redo: async () => {
      const c = redoStack.pop();
      if (c) {
        restore(c.after);
        undoStack.push(c);
        persist();
      }
      return {
        changed: !!c,
        canUndo: !!undoStack.length,
        canRedo: !!redoStack.length,
      };
    },
    history: async (limit) =>
      undoStack
        .slice(-limit)
        .reverse()
        .map((c) => ({
          id: c.change.id,
          time: c.change.time,
          kind: c.change.kind,
          fluxIds: c.change.fluxIds,
        })),
    treatmentSummary: async (q) =>
      summarize(rows, layout.plots, layout.treatments, q),
    listSeries: async () => structuredClone(series),
    getSeries: async (ids, from = start, to = end, maxPoints = 2000) =>
      ids.map((id) => {
        const hour = 3600000;
        const first =
          start + Math.max(0, Math.ceil((from - start) / hour)) * hour;
        const last = Math.min(to, end);
        const hours = Math.floor((last - first) / hour) + 1;
        const stride = Math.max(1, Math.ceil(hours / maxPoints));
        return {
          id,
          points: Array.from(
            {
              length:
                maxPoints > 0 ? Math.max(0, Math.ceil(hours / stride)) : 0,
            },
            (_, i) => {
              const time = first + i * stride * hour,
                d = (time - start) / 86400000;
              return {
                time,
                value:
                  id === 2
                    ? Math.max(0, Math.sin(d * 2.3) * 4 - 2)
                    : id === 3
                      ? 0.28 + 0.05 * Math.sin(d / 15)
                      : 8 +
                        11 * Math.sin((d / 365) * 2 * Math.PI) +
                        (id === 1 ? 2 * Math.sin(d * 2 * Math.PI) : 0),
              };
            },
          ),
        };
      }),
    previewTable: async () => ({
      sheets: ["Measurements"],
      headerCandidates: [0, 2],
      columns: ["date", "plot", "N2O", "CO2", "temperature", "VWC"],
      rows: Array.from({ length: 5 }, (_, i) => [
        "2024-06-" + (10 + i),
        "P01",
        23 + i,
        1800 + i * 10,
        15 + i,
        0.25,
      ]),
    }),
    importSeries: async (args) => {
      await progress("Import series");
      change("Import series", [], () =>
        args.valueColumns.forEach((name) =>
          series.push({
            id: Math.max(...series.map((s) => s.id)) + 1,
            name,
            unit: "",
            source: "Imported demo",
            count: 17473,
            timeRange: [start, end],
          }),
        ),
      );
    },
    deleteSeries: async (id) => {
      change("Delete series", [], () => {
        series = series.filter((s) => s.id !== id);
      });
    },
    importManualFluxes: async () => {
      await progress("Manual import");
      change("Import manual", [], () => {
        for (let i = 0; i < 10; i++) {
          const r = makeRow(rows.length + 1, true);
          refresh(r);
          rows.push(r);
        }
      });
      return report(10);
    },
    metnoGetClientId: async () => clientId,
    metnoSetClientId: async (id) => {
      clientId = id;
    },
    metnoFetch: async () => {
      await progress("Weather fetch");
    },
    exportCsv: async (args) => download(args),
    exportXlsx: async (args) => download(args, args.mode),
    onProgress: async (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    waypointsRead: async () => demoRoute(),
    waypointsWrite: async (target, points, sourcePath) => {
      if (sourcePath && target === sourcePath)
        throw {
          code: "SOURCE",
          message:
            "Choose a new filename to keep the original waypoint file intact.",
        };
      const text = points
        .map((p) => [p.x, p.y, p.z, p.angle, p.kind, p.side, p.name].join(","))
        .join("\n");
      const url = URL.createObjectURL(new Blob([text + "\n"]));
      const a = document.createElement("a");
      a.href = url;
      a.download = target.split(/[\\/]/).pop() || "route.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    waypointPlots: async (points, o) => mockWaypointPlots(points, o),
    applyWaypointLayout: async (args) => {
      if (!open) throw { code: "PROJECT", message: "no project open" };
      await progress("Apply waypoint layout");
      change("layout", [], () => {
        let treatments = layout.treatments;
        let unassigned = treatments.find((t) => t.name === "Unassigned")?.id;
        if (
          unassigned === undefined &&
          args.plots.some(
            (p) => !treatments.some((t) => t.id === p.treatmentId),
          )
        ) {
          unassigned = Math.max(0, ...treatments.map((t) => t.id)) + 1;
          treatments = [
            ...treatments,
            {
              id: unassigned,
              name: "Unassigned",
              shortName: "",
              colour: "#8a99a6",
              sortOrder: treatments.length,
            },
          ];
        }
        layout = {
          treatments,
          plots: args.plots.map((p, i) => ({
            id: i + 1,
            label: p.label,
            treatmentId: treatments.some((t) => t.id === p.treatmentId)
              ? p.treatmentId!
              : unassigned!,
            block: p.block ?? 0,
            polygon: p.polygon,
            waypoints: p.waypoints,
          })),
        };
        for (const r of rows) {
          if (r.source === "robot") assignRobotPlot(r);
        }
        route = {
          points: structuredClone(args.points),
          sourcePath: args.sourcePath ?? null,
          savedAt: Date.now(),
        };
      });
      return structuredClone(layout);
    },
    getRoute: async () => (open && route ? structuredClone(route) : null),
    rawFolderGet: async () => structuredClone(rawFolder),
    rawFolderSet: async (folder) => {
      if (folder && !folder.path.trim())
        throw { code: "core", message: "choose a folder" };
      rawFolder = folder ? { ...rawFolder, ...structuredClone(folder) } : null;
    },
    rawFolderScan: async () => {
      if (!rawFolder) throw { code: "core", message: "no raw-data folder set" };
      // The synthetic folder holds the demo's own files: nothing new.
      const files = new Set(rows.map((r) => r.measurementId)).size;
      const report: T.FolderReport = {
        files: files + 3,
        known: files,
        outsideField: rawFolder.fieldOnly ? 3 : 0,
        imported: 0,
        errors: [],
      };
      rawFolder = { ...rawFolder, lastScan: Date.now(), lastReport: report };
      return report;
    },
    mapTilesGet: async () => null,
    mapTilesSet: async (dir) => {
      if (dir)
        throw {
          code: "TILES",
          message:
            "Local imagery folders are only available in the desktop app.",
        };
      return null;
    },
    mapTile: async () => null,
  };
}
function inside(poly: [number, number][], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}
