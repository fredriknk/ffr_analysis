import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../api";
import { rowLevels } from "../../api/findingLevels";
import { codes } from "../diagnostics";
import { useRows } from "./useApi";
// Rule metadata changes with the backend build. Counts come from the current table,
// so reviewing a flux need not repeat the native summary's full findings scan.
export function useDiagnostics(enabled: boolean) {
  const query = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api.diagnosticsSummary(),
    enabled,
    staleTime: Infinity,
  });
  const table = useRows();
  const data = useMemo(() => {
    if (!query.data || !table.data) return query.data;
    const counts = new Map<
      string,
      {
        count: number;
        unreviewed: number;
        warnBad: number;
        info: number;
        pending: number;
      }
    >();
    for (const row of table.data.rows)
      for (const code of new Set(codes(row.diag))) {
        const c = counts.get(code) ?? {
          count: 0,
          unreviewed: 0,
          warnBad: 0,
          info: 0,
          pending: 0,
        };
        c.count++;
        const level = rowLevels(row)?.[code];
        if (!level) c.pending++;
        else if (level === "info") c.info++;
        else c.warnBad++;
        if (!row.reviewed) c.unreviewed++;
        counts.set(code, c);
      }
    return query.data.map((c) => ({
      ...c,
      ...(counts.get(c.code) ?? {
        count: 0,
        unreviewed: 0,
        warnBad: 0,
        info: 0,
        pending: 0,
      }),
    }));
  }, [query.data, table.data]);
  return { ...query, data };
}
