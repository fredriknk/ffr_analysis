import { diagnosticLabels, score } from "./diagnosticMeta";
import { estimateLag, findings, median, thresholds } from "./diagnostics";
import {
  defaults,
  fluxConversion,
  gases,
  random,
  regression,
  summarize,
} from "./maths";
import type * as T from "./types";
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
  };
  let layout: T.Layout = {
    treatments: names.map((name, i) => ({
      id: i + 1,
      name,
      shortName: name,
      colour: colours[i],
      sortOrder: i,
    })),
    plots: Array.from({ length: 36 }, (_, i) => ({
      id: i + 1,
      label: "P" + String(i + 1).padStart(2, "0"),
      treatmentId: Math.floor(i / 3) + 1,
      block: (i % 3) + 1,
      polygon: [
        [i % 6, Math.floor(i / 6)],
        [(i % 6) + 1, Math.floor(i / 6)],
        [(i % 6) + 1, Math.floor(i / 6) + 1],
        [i % 6, Math.floor(i / 6) + 1],
      ],
    })),
  };
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
      trueLag = campaign >= 14 && campaign <= 18 ? 3 + (campaign % 3) : 0;
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
    return {
      regs,
      traces,
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
    r.overridden = opts.has(r.id);
    diagnosticMap.set(r.id, a.diagnostics);
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
      r.diag = [...new Set(ds.map((d) => d.code))].join(",");
      r.attention = score(ds);
    }
  }
  function makeRow(id: number, manual = false): T.FluxRow {
    const i = id - 1,
      p = layout.plots[i % Math.max(1, layout.plots.length)] ?? {
        id: 0,
        label: "Unassigned",
        treatmentId: 0,
      },
      time = manual
        ? start + ((i * 4) % 728) * 86400000
        : start + Math.floor(i / 72) * 7 * 86400000 + (i % 72) * 190000;
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
          Math.floor(i / 2 + 1),
      side: i % 2 ? "right" : "left",
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
      x: (p.id % 6) * 5 + 2,
      y: Math.floor((p.id - 1) / 6) * 5 + 2,
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
  };
  let series: T.SeriesMeta[] = [
    ["Air temperature", "°C", "Weather"],
    ["Precipitation", "mm", "Weather"],
    ["Soil moisture", "m³ m?³", "Logger"],
    ["Soil temperature", "°C", "Logger"],
  ].map(([name, unit, source], i) => ({
    id: i + 1,
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
            plotOverride: r.plotId,
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
        Object.assign(r, f);
        const p = layout.plots.find((p) => p.id === f.plotOverride);
        if (p)
          Object.assign(r, {
            plotId: p.id,
            plotLabel: p.label,
            treatmentId: p.treatmentId,
            treatmentName:
              layout.treatments.find((t) => t.id === p.treatmentId)?.name ?? "",
          });
      }
      rows.filter((r) => r.source === "robot").forEach(refresh);
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
      diagnostics: a.diagnostics.concat(
        (diagnosticMap.get(id) ?? []).filter(
          (d) => d.code === "neighbour_outlier",
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
    projectCreate: async (p, name) => {
      path = p;
      config.name = name;
      rows.splice(0);
      layout = { treatments: [], plots: [] };
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
                _rsq: " R?",
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
                  ? "µg m⁻² h⁻¹"
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
          const r = row(id);
          Object.assign(r, flags);
          if (flags.plotOverride) {
            const p = layout.plots.find((p) => p.id === flags.plotOverride)!;
            Object.assign(r, {
              plotId: p.id,
              plotLabel: p.label,
              treatmentId: p.treatmentId,
              treatmentName: layout.treatments[p.treatmentId - 1].name,
            });
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
              ? { ...effective.perGas, ...partial.perGas }
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
      Object.entries(diagnosticLabels).map(([code, label]) => {
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
        .map((c) => c.change),
    treatmentSummary: async (q) =>
      summarize(rows, layout.plots, layout.treatments, q),
    listSeries: async () => structuredClone(series),
    getSeries: async (ids, from = start, to = end, maxPoints = 2000) =>
      ids.map((id) => {
        const step = Math.max(
          3600000,
          Math.ceil((to - from) / maxPoints / 3600000) * 3600000,
        );
        return {
          id,
          points: Array.from(
            { length: Math.max(0, Math.floor((to - from) / step) + 1) },
            (_, i) => {
              const time = from + i * step,
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
  };
}
