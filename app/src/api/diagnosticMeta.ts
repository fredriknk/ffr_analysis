import type { Diagnostic } from "./types";
export const diagnosticLabels: Record<string, string> = {
  error: "Failed measurement",
  n2o_negative: "N₂O falling",
  co2_not_rising: "CO₂ not rising",
  chamber_leak: "Chamber leak",
  noisy: "High noise",
  co2_low_r2: "Poor CO₂ fit",
  curvature: "Curved trace",
  valve_timing: "Valve timing",
  edge_transient: "Segment edges",
  valves_irregular: "Irregular switches",
  spike: "Spike",
  few_points: "Few points",
  zero_readings: "Instrument dropout",
  legacy_qc: "N₂O quality check",
  neighbour_outlier: "Neighbour outlier",
  temp_fallback: "Fallback temperature",
  no_plot: "Unassigned plot",
};
export const codes = (diag: unknown) =>
  String(diag ?? "")
    .split(",")
    .filter(Boolean);
export const severity = (attention: unknown): Diagnostic["severity"] =>
  Number(attention) >= 70 ? "bad" : Number(attention) >= 30 ? "warn" : "info";
export function score(findings: Diagnostic[]) {
  if (!findings.some((d) => d.code !== "legacy_qc")) return 0;
  const worst = findings.some((d) => d.severity === "bad")
    ? 70
    : findings.some((d) => d.severity === "warn")
      ? 30
      : 5;
  return Math.min(100, worst + findings.length * 4);
}
