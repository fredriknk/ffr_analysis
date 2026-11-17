import type { Diagnostic, FluxRow } from "./types";
export type Levels = Record<string, Diagnostic["severity"]>;
export function rowLevels(row: FluxRow): Levels | undefined {
  const value: unknown = row.diagSeverity;
  if (value && typeof value === "object") return value as Levels;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Levels;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
export function hasFinding(row: FluxRow, code: string, includeInfo = false) {
  if (!row.diag.split(",").includes(code)) return false;
  return includeInfo || ["warn", "bad"].includes(rowLevels(row)?.[code] ?? "");
}
export function findingLevels(findings: Diagnostic[]): Levels {
  const out: Levels = {},
    rank = { info: 0, warn: 1, bad: 2 };
  for (const f of findings)
    if (out[f.code] === undefined || rank[f.severity] > rank[out[f.code]])
      out[f.code] = f.severity;
  return out;
}
