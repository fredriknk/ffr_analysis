import { flexRender, type Column, type Table } from "@tanstack/react-table";
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
  const pinned = (column: Column<FluxRow>) =>
    column.getIsPinned()
      ? {
          position: "sticky" as const,
          left: column.getStart("left") + 34,
          zIndex: 3,
          background: "var(--panel)",
        }
      : {};
  return (
    <div className="table-scroll panel" ref={parent}>
      <table style={{ width: table.getTotalSize() + 34 }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 5,
                  width: 34,
                  minWidth: 34,
                  background: "var(--rail)",
                }}
              >
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
                  data-column-key={h.id}
                  aria-sort={
                    h.column.getIsSorted() === "asc"
                      ? "ascending"
                      : h.column.getIsSorted() === "desc"
                        ? "descending"
                        : "none"
                  }
                  style={{
                    width: h.column.getSize(),
                    minWidth: h.column.getSize(),
                    maxWidth: h.column.getSize(),
                    ...pinned(h.column),
                    zIndex: 4,
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
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 3,
                    background: "var(--panel)",
                    width: 34,
                    minWidth: 34,
                  }}
                >
                  <input
                    aria-label={"Select flux " + r.id}
                    type="checkbox"
                    checked={!!selection[r.id]}
                    onChange={r.getToggleSelectedHandler()}
                  />
                </td>
                {r.getVisibleCells().map((c) => (
                  <td
                    key={c.id}
                    style={{
                      width: c.column.getSize(),
                      minWidth: c.column.getSize(),
                      ...pinned(c.column),
                    }}
                  >
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
