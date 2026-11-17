import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { ColumnMeta, FluxDetail, FluxRow } from "../../api/types";
import { useStore } from "../../store";
import { error, toastFn } from "../feedback";
import { columnMeta } from "../format";
export function useAction() {
  const client = useQueryClient();
  return async (fn: () => Promise<unknown>, message?: string) => {
    try {
      const result = await fn();
      // Edits return the edited rows plus every row the core re-scored, so
      // the table is patched in place instead of reloading every flux.
      const rows =
        Array.isArray(result) &&
        result.every((r) => r && typeof r.id === "number")
          ? (result as FluxRow[])
          : null;
      if (rows) {
        const updates = new Map(rows.map((r) => [r.id, r]));
        client.setQueryData<{ columns: ColumnMeta[]; rows: FluxRow[] }>(
          ["fluxes"],
          (old) =>
            old
              ? {
                  ...old,
                  rows: old.rows.map((r) => {
                    const u = updates.get(r.id);
                    return u ? { ...r, ...u } : r;
                  }),
                }
              : old,
        );
        client.setQueriesData<FluxDetail>({ queryKey: ["detail"] }, (old) =>
          old && updates.has(old.flux.id)
            ? { ...old, flux: { ...old.flux, ...updates.get(old.flux.id) } }
            : old,
        );
      }
      // Only the visible trace is awaited: it is cheap and the next keypress needs it.
      await client.invalidateQueries({
        queryKey: ["detail"],
        refetchType: "active",
      });
      if (message) toastFn(message);
      // Summaries and other screens refresh in the background.
      void client.invalidateQueries({
        predicate: (q) => {
          const key = String(q.queryKey[0]);
          return (
            !["detail", "diagnostics"].includes(key) &&
            !(rows && key === "fluxes")
          );
        },
      });
    } catch (e) {
      error(e);
    }
  };
}
export function useRows() {
  const screen = useStore((s) => s.screen);
  return useQuery({
    enabled: ["Review", "Treatments", "Outliers", "Data", "Project"].includes(
      screen,
    ),
    queryKey: ["fluxes"],
    queryFn: async () => {
      const t = await api.listFluxes();
      return {
        columns: t.columns.map(columnMeta),
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
