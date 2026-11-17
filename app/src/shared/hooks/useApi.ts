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
      if (
        Array.isArray(result) &&
        result.every((r) => r && typeof r.id === "number")
      ) {
        const updates = new Map((result as FluxRow[]).map((r) => [r.id, r]));
        client.setQueryData<{ columns: ColumnMeta[]; rows: FluxRow[] }>(
          ["fluxes"],
          (old) =>
            old
              ? {
                  ...old,
                  rows: old.rows.map((r) => ({ ...r, ...updates.get(r.id) })),
                }
              : old,
        );
        client.setQueriesData<FluxDetail>({ queryKey: ["detail"] }, (old) =>
          old && updates.has(old.flux.id)
            ? { ...old, flux: { ...old.flux, ...updates.get(old.flux.id) } }
            : old,
        );
      }
      // Refresh the visible trace before expensive table/summary requests queue at the native mutex.
      await client.invalidateQueries({
        queryKey: ["detail"],
        refetchType: "active",
      });
      await client.invalidateQueries({
        predicate: (q) =>
          !["detail", "diagnostics"].includes(String(q.queryKey[0])),
      });
      if (message) toastFn(message);
    } catch (e) {
      error(e);
    }
  };
}
export function useRows() {
  const screen = useStore((s) => s.screen);
  return useQuery({
    enabled: ["Review", "Treatments", "Outliers", "Data"].includes(screen),
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
