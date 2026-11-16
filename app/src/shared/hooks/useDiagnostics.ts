import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../api";
import type { FluxRow } from "../../api/types";
import { codes } from "../diagnostics";
// Rule metadata changes with the backend build. Counts come from the current table,
// so reviewing a flux need not repeat the native summary's full findings scan.
export function useDiagnostics(enabled: boolean) {
  const query = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api.diagnosticsSummary(),
    enabled,
    staleTime: Infinity,
  });
  const table = useQuery<{ rows: FluxRow[] }>({
    queryKey: ["fluxes"],
    enabled: false,
  });
  const data = useMemo(() => {
    if (!query.data || !table.data) return query.data;
    const counts = new Map<string, { count: number; unreviewed: number }>();
    for (const row of table.data.rows)
      for (const code of new Set(codes(row.diag))) {
        const c = counts.get(code) ?? { count: 0, unreviewed: 0 };
        c.count++;
        if (!row.reviewed) c.unreviewed++;
        counts.set(code, c);
      }
    return query.data.map((c) => ({
      ...c,
      ...(counts.get(c.code) ?? { count: 0, unreviewed: 0 }),
    }));
  }, [query.data, table.data]);
  return { ...query, data };
}
