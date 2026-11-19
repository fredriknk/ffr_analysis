import type { ImportManualArgs } from "../../api/types";

export function suggestedColumns(columns: string[]) {
  const pick = (...names: string[]) =>
    names.find((name) => columns.includes(name)) ?? "";
  return {
    time:
      pick("date", "time", "Measurement Time") || columns.find(Boolean) || "",
    plot: pick("plot", "nr"),
    N2O: pick("N2O", "N2O_N_mug_m2h"),
    CO2: pick("CO2", "CO2_C_mug_m2h"),
  };
}

export function manualImportMapping(
  columns: string[],
  mapping: ReturnType<typeof suggestedColumns>,
  offset: string,
):
  | Pick<
      ImportManualArgs,
      "dateColumn" | "plotColumn" | "gasColumns" | "offsetHours"
    >
  | undefined {
  const { time, plot, N2O, CO2 } = mapping;
  const offsetHours = Number(offset);
  if (
    !time ||
    !columns.includes(time) ||
    !plot ||
    !columns.includes(plot) ||
    (!N2O && !CO2) ||
    (N2O && !columns.includes(N2O)) ||
    (CO2 && !columns.includes(CO2)) ||
    !offset.trim() ||
    !Number.isFinite(offsetHours)
  )
    return undefined;

  return {
    dateColumn: time,
    plotColumn: plot,
    gasColumns: { ...(N2O ? { N2O } : {}), ...(CO2 ? { CO2 } : {}) },
    offsetHours,
  };
}
