import { beta, regression } from "./maths";
import type {
  AnalysisOptions,
  Diagnostic,
  FluxRow,
  ProjectConfig,
  Regression,
  Trace,
} from "./types";
export const thresholds = {
  negativeP: 0.01,
  co2R2: 0.95,
  co2BadR2: 0.8,
  curvatureP: 0.001,
  curvatureFraction: 0.4,
  valveMinLag: 2,
  valveImprovement: 0.3,
  edgeRatio: 2.5,
  spikeMad: 6,
  minPoints: 20,
  minWindow: 60,
  neighbourZ: 5,
};
export const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return !s.length ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function findings(
  row: FluxRow,
  regs: Regression[],
  traces: Trace[],
  o: AnalysisOptions,
  cfg: ProjectConfig,
  lag: number,
  improvement: number,
): Diagnostic[] {
  if (row.source === "manual") return [];
  if (!regs.length)
    return [
      {
        code: "error",
        severity: "bad",
        message:
          "The measurement failed validation: a valve event is incomplete, so no chamber fit is available.",
      },
    ];
  const limits = { ...thresholds, ...cfg.diagnostics },
    out: Diagnostic[] = [];
  const add = (
    code: string,
    severity: Diagnostic["severity"],
    message: string,
    value?: number,
    gas?: string,
  ) => out.push({ code, severity, message, value, gas });
  if (!row.plotId)
    add(
      "no_plot",
      "info",
      "This chamber has no plot assignment; choose a plot before summarising.",
    );
  const n = regs.find((r) => r.gas === "N2O"),
    co2 = regs.find((r) => r.gas === "CO2");
  if (n && n.slope < 0 && n.pval < limits.negativeP)
    add(
      "n2o_negative",
      "bad",
      "N₂O is falling significantly; check whether the chamber was sealed.",
      n.slope,
      "N2O",
    );
  if (co2 && co2.slope <= 0)
    add(
      "co2_not_rising",
      "bad",
      "CO₂ does not accumulate; the chamber may be leaking or lifted.",
      co2.slope,
      "CO2",
    );
  if (
    Math.abs(lag - o.valveOffset) >= limits.valveMinLag &&
    improvement >= limits.valveImprovement
  )
    add(
      "valve_timing",
      "warn",
      "Signal transitions are delayed relative to the valve log; inspect the ghost switch lines.",
      lag,
      "CO2",
    );
  for (const r of regs) {
    const tr = traces.find((t) => t.gas === r.gas)!;
    const ix = tr.t.flatMap((_, i) => (tr.used[i] ? [i] : [])),
      x = ix.map((i) => tr.t[i]),
      y = ix.map((i) => tr.y[i]),
      res = ix.map((i) => tr.y[i] - r.intercept - r.slope * tr.t[i]);
    if (r.n < limits.minPoints || r.stop - r.start < limits.minWindow)
      add(
        "few_points",
        "warn",
        "Too few points or too short a window for a reliable fit.",
        r.n,
        r.gas,
      );
    const centre = median(res);
    const mad = Math.max(
        1e-12,
        median(res.map((v) => Math.abs(v - centre))) * 1.4826,
      ),
      spike = Math.max(...res.map((v) => Math.abs(v - centre))) / mad;
    if (spike > limits.spikeMad)
      add(
        "spike",
        "warn",
        "An isolated used point lies far outside the rest of the trace.",
        spike,
        r.gas,
      );
    const mid = (r.start + r.stop) / 2,
      a = regression(
        x.filter((t) => t < mid),
        y.filter((_, i) => x[i] < mid),
      ),
      b = regression(
        x.filter((t) => t >= mid),
        y.filter((_, i) => x[i] >= mid),
      );
    // Orthogonalise x² against the linear model, then test the extra quadratic term.
    if (x.length > 5) {
      const xx = x.map((t) => (t - mid) ** 2),
        qr = regression(x, xx),
        z = xx.map((v, i) => v - qr.intercept - qr.slope * x[i]),
        zz = z.reduce((s, v) => s + v * v, 0),
        coef = zz ? z.reduce((s, v, i) => s + v * res[i], 0) / zz : 0,
        sse = res.reduce((s, v) => s + v * v, 0),
        quad = res.reduce((s, v, i) => s + (v - coef * z[i]) ** 2, 0),
        f = (sse - quad) / (quad / (x.length - 3)),
        p =
          f > 0
            ? beta((x.length - 3) / (x.length - 3 + f), (x.length - 3) / 2, 0.5)
            : 1,
        frac =
          Math.abs(a.slope - b.slope) /
          Math.max(1e-12, Math.abs(a.slope), Math.abs(b.slope));
      if (p < limits.curvatureP && frac > limits.curvatureFraction)
        add(
          "curvature",
          "warn",
          "The trace bends: the first and second halves have different slopes.",
          frac,
          r.gas,
        );
    }
    const edge: number[] = [],
      inside: number[] = [];
    ix.forEach((i, j) => {
      const phase = (((tr.t[i] - o.valveOffset) % 20) + 20) % 20;
      (phase < o.cutBeginnings + 1.5 || phase > 20 - o.cutEnds - 1.5
        ? edge
        : inside
      ).push(Math.abs(res[j]) / mad);
    });
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1),
      ratio = avg(edge) / Math.max(1e-9, avg(inside));
    if (ratio > limits.edgeRatio)
      add(
        "edge_transient",
        "warn",
        "Segment-edge points sit systematically away from the fit; inspect cuts and timing.",
        ratio,
        r.gas,
      );
  }
  if (n?.qc !== "OK")
    add(
      "legacy_qc",
      "info",
      "The legacy N₂O quality check requests a closer look.",
      n?.rsq,
      "N2O",
    );
  return out.sort(
    (a, b) =>
      ({ bad: 0, warn: 1, info: 2 })[a.severity] -
      { bad: 0, warn: 1, info: 2 }[b.severity],
  );
}
export function estimateLag(trace: Trace, options: AnalysisOptions) {
  const sse = (offset: number) => {
    const sums = [
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ];
    trace.t.forEach((t, i) => {
      const shifted = t - offset,
        phase = ((shifted % 20) + 20) % 20;
      if (shifted < 0 || phase < 2 || phase >= 19) return;
      const a = sums[Math.floor((shifted + 200) / 20) % 2],
        y = trace.y[i];
      a[0]++;
      a[1] += t;
      a[2] += y;
      a[3] += t * t;
      a[4] += t * y;
      a[5] += y * y;
    });
    return sums.reduce((s, [n, x, y, xx, xy, yy]) => {
      const vx = xx - (x * x) / n,
        cov = xy - (x * y) / n;
      return s + Math.max(0, yy - (y * y) / n - (vx ? (cov * cov) / vx : 0));
    }, 0);
  };
  let lag = 0,
    best = Infinity;
  for (let d = -10; d <= 10; d += 0.5) {
    const v = sse(d);
    if (v < best) {
      best = v;
      lag = d;
    }
  }
  const original = sse(options.valveOffset);
  return { lag, improvement: original ? 1 - best / original : 0 };
}
