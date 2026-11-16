import { flexRender, type Table } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { ColumnMeta, FluxRow } from "../../api/types";
import { Empty } from "../common";
import { ColumnFilter } from "../filters/ColumnFilter";
export function FluxTableView({
  table,
  data,
  onOpen,
}: {
  table: Table<FluxRow>;
  data: { columns: ColumnMeta[]; rows: FluxRow[] };
  onOpen: (id: number) => void;
}) {
  const selection = table.getState().rowSelection,
    setSelection = table.setRowSelection;
  const parent = useRef<HTMLDivElement>(null),
    rs = table.getRowModel().rows,
    columns = data.columns;
  const virt = useVirtualizer({
    count: rs.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 39,
    overscan: 12,
  });
  return (
    <div className="table-scroll panel" ref={parent}>
      <table>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              <th>
                <input
                  aria-label="Select all matching rows"
                  type="checkbox"
                  checked={rs.length > 0 && rs.every((r) => selection[r.id])}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? Object.fromEntries(rs.map((r) => [r.id, true]))
                        : {},
                    )
                  }
                />
              </th>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  aria-sort={
                    h.column.getIsSorted() === "asc"
                      ? "ascending"
                      : h.column.getIsSorted() === "desc"
                        ? "descending"
                        : "none"
                  }
                  style={{
                    minWidth:
                      h.id === "id"
                        ? 55
                        : [
                              "source",
                              "side",
                              "reviewed",
                              "excluded",
                              "overridden",
                              "plotLabel",
                            ].includes(h.id)
                          ? 85
                          : 125,
                  }}
                >
                  <button onClick={h.column.getToggleSortingHandler()}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <span aria-hidden="true">
                      {h.column.getIsSorted() === "asc"
                        ? " ↑"
                        : h.column.getIsSorted() === "desc"
                          ? " ↓"
                          : ""}
                    </span>
                  </button>
                  {data?.columns.find((c) => c.key === h.id) && (
                    <ColumnFilter
                      meta={data.columns.find((c) => c.key === h.id)!}
                      rows={data.rows}
                      value={h.column.getFilterValue()}
                      onChange={(v) => h.column.setFilterValue(v)}
                    />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          <tr style={{ height: virt.getVirtualItems()[0]?.start ?? 0 }}>
            <td colSpan={columns.length + 1} />
          </tr>
          {virt.getVirtualItems().map((v) => {
            const r = rs[v.index];
            return (
              <tr
                key={r.id}
                className={r.original.excluded ? "excluded" : ""}
                style={{ height: 39 }}
              >
                <td>
                  <input
                    aria-label={"Select flux " + r.id}
                    type="checkbox"
                    checked={!!selection[r.id]}
                    onChange={r.getToggleSelectedHandler()}
                  />
                </td>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>
                    <button
                      className="cell"
                      onClick={() => onOpen(r.original.id)}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
          <tr
            style={{
              height: Math.max(
                0,
                virt.getTotalSize() - (virt.getVirtualItems().at(-1)?.end ?? 0),
              ),
            }}
          >
            <td colSpan={columns.length + 1} />
          </tr>
        </tbody>
      </table>
      {!rs.length && (
        <Empty>No rows match. Clear filters to see all measurements.</Empty>
      )}
    </div>
  );
}
