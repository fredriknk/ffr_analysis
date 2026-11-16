import { useStore } from "../store";
export const fmt = (n: unknown, d = 2) =>
  typeof n === "number"
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      })
    : String(n ?? "—");
export const date = (n: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: useStore.getState().timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(n);
