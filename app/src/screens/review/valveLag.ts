import type { FluxDetail } from "../../api/types";

export type ValveLagTarget = "all" | "N2Oall" | "CO2" | "N2O";

export function valveLagEstimate(
  detail: Pick<FluxDetail, "CO2_lagS" | "N2O_lagS"> | undefined,
  target: ValveLagTarget,
): number | null {
  const estimate =
    target === "N2O" || target === "N2Oall"
      ? detail?.N2O_lagS
      : detail?.CO2_lagS;
  return typeof estimate === "number" && Number.isFinite(estimate)
    ? estimate
    : null;
}
