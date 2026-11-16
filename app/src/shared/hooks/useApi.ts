import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { FluxRow } from "../../api/types";
import { error, toastFn } from "../feedback";
import { columnMeta } from "../format";
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
