import type { ColumnMeta, SeriesMeta } from "../api/types";
import { useStore } from "../store";
export const fmt = (n: unknown, d = 2) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      })
    : "—";
export const significant = (n: unknown, digits = 4) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-GB", { maximumSignificantDigits: digits })
    : "—";
export const attention = (n: unknown) => String(Math.round(Number(n) || 0));
const superscripts: Record<string, string> = {
  "-": "⁻",
  "+": "⁺",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};
export const unit = (value: unknown) =>
  String(value ?? "")
    .replace(/\bug\b/g, "µg")
    .replace(/\^([+-]?\d+)/g, (_, power: string) =>
      [...power].map((c) => superscripts[c] ?? c).join(""),
    );
export function date(n: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: useStore.getState().timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(n);
}
export function dateTime(n: number, compact = false) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: useStore.getState().timeZone,
    day: "2-digit",
    month: compact ? "2-digit" : "short",
    ...(compact ? {} : { year: "numeric" as const }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(n)
    .replace(",", "");
}
const known: Record<string, string> = {
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
  attention: "Attention",
  diag: "Findings",
  valveLagS: "CO₂ valve lag",
  N2O_lagS: "N₂O valve lag",
  x: "Easting",
  y: "Northing",
};
export function columnLabel(key: string, label?: string) {
  if (label && label !== key && !/^[a-z]+[A-Z]|^[A-Z0-9]+_/.test(label))
    return label;
  if (known[key]) return known[key];
  return key
    .replace(/^(licor_H2O|N2O|CO2|H2O|CO)_/, "$1 ")
    .replace(
      /(robustFlux|impact|slope|rsq|pval|flux|resid|qc|n)$/,
      (v) =>
        ({
          robustFlux: "robust flux",
          impact: "impact",
          slope: "slope",
          rsq: "R²",
          pval: "p value",
          flux: "flux",
          resid: "residual SD",
          qc: "quality",
          n: "points",
        })[v] ?? v,
    )
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
}
export function columnMeta(c: ColumnMeta): ColumnMeta {
  return {
    ...c,
    label: columnLabel(c.key, c.label),
    unit: unit(
      c.unit ||
        (c.key.startsWith("N2O_") && /(flux|robustFlux)$/.test(c.key)
          ? "ug N2O-N m^-2 h^-1"
          : c.key.startsWith("CO2_") && /(flux|robustFlux)$/.test(c.key)
            ? "ug CO2-C m^-2 h^-1"
            : c.key === "airTemp"
              ? "°C"
              : c.key === "precip"
                ? "mm"
                : c.key.endsWith("lagS") || c.key === "valveLagS"
                  ? "s"
                  : undefined),
    ),
  };
}
export function seriesDisplay(s: SeriesMeta): SeriesMeta {
  const raw = s.name,
    name =
      s.displayName ||
      (/air_temperature/.test(raw)
        ? /max/.test(raw)
          ? "Maximum air temperature"
          : /min/.test(raw)
            ? "Minimum air temperature"
            : "Air temperature"
        : /precipitation/.test(raw)
          ? "Precipitation"
          : raw);
  return {
    ...s,
    name,
    unit: unit(
      s.unit ||
        (/temperature/.test(raw)
          ? "°C"
          : /precipitation/.test(raw)
            ? "mm"
            : ""),
    ),
  };
}
