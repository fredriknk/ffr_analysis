import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
import { api, isTauri } from "../api";
import type { FluxRow } from "../api/types";
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
export const plotBase = {
  grid: { left: 65, right: 25, top: 25, bottom: 45 },
  tooltip: { trigger: "axis" },
  xAxis: {
    type: "value",
    name: "Time (s)",
    nameLocation: "middle",
    nameGap: 28,
    max: 185,
  },
  yAxis: { type: "value", scale: true, splitNumber: 4 },
};
export let toastFn: (s: string) => void = () => {};
export const error = (e: unknown) =>
  toastFn(
    typeof e === "object" && e && "message" in e
      ? String(e.message)
      : String(e),
  );
export function useAction() {
  const client = useQueryClient();
  return async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      await client.invalidateQueries();
      if (message) toastFn(message);
    } catch (e) {
      error(e);
    }
  };
}
export function useRows() {
  return useQuery({
    queryKey: ["fluxes"],
    queryFn: async () => {
      const t = await api.listFluxes();
      return {
        columns: t.columns,
        rows: Array.from(
          { length: t.rows },
          (_, i) =>
            Object.fromEntries(
              t.columns.map((c) => [c.key, t.data[c.key][i]]),
            ) as FluxRow,
        ),
      };
    },
  });
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Status({
  loading,
  error: e,
}: {
  loading: boolean;
  error: Error | null;
}) {
  useEffect(() => {
    if (e) error(e);
  }, [e]);
  return loading ? (
    <Empty>Loading measurements…</Empty>
  ) : e ? (
    <Empty>
      Could not load this view.{" "}
      <button onClick={() => location.reload()}>Retry</button>
    </Empty>
  ) : null;
}
export async function pick(folder = false, write = false) {
  if (!isTauri) return folder ? "synthetic-demo/" : "synthetic-demo.csv";
  const p = write
    ? await save({ filters: [{ name: "FFR project", extensions: ["ffr"] }] })
    : await open({ directory: folder, multiple: false });
  return typeof p === "string" ? p : null;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Panel({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function setToastHandler(fn: (s: string) => void) {
  toastFn = fn;
}
