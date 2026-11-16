import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useRef, useState } from "react";
import { api, isTauri, mockMode } from "../../api";
import type { Cell, ExportArgs, FluxRow } from "../../api/types";
import {
  Empty,
  Field,
  Panel,
  Status,
  date,
  fmt,
  useAction,
  useRows,
} from "../../shared/common";
import { useStore } from "../../store";
export function Data() {
  const s = useStore(),
    data = useRows(),
    action = useAction(),
    parent = useRef<HTMLDivElement>(null),
    [sorting, setSorting] = useState<SortingState>([]),
    [filters, setFilters] = useState<ColumnFiltersState>([]),
    [visible, setVisible] = useState<Record<string, boolean>>({
      filename: false,
      measurementId: false,
      x: false,
      y: false,
      note: false,
      CO_slope: false,
      H2O_slope: false,
      licor_H2O_slope: false,
    }),
    [chooser, setChooser] = useState(false),
    [selection, setSelection] = useState<Record<string, boolean>>({}),
    [exporting, setExporting] = useState(false),
    [mode, setMode] = useState<"flat" | "sheetPerPlot" | "dailyPerPlot">(
      "flat",
    ),
    [preset, setPreset] = useState(""),
    [presets, setPresets] = useState<Record<string, ColumnFiltersState>>(() =>
      JSON.parse(localStorage.getItem("ffr-presets") ?? "{}"),
    );
  const columns = useMemo<ColumnDef<FluxRow>[]>(
    () =>
      data.data?.columns
        .slice()
        .sort((a, b) => {
          const order = [
            "id",
            "time",
            "plotLabel",
            "treatmentName",
            "N2O_flux",
            "CO2_flux",
            "N2O_qc",
            "source",
            "side",
          ];
          const rank = (key: string) =>
            order.includes(key) ? order.indexOf(key) : 99;
          return rank(a.key) - rank(b.key);
        })
        .map((c) => ({
          id: c.key,
          accessorKey: c.key,
          header: c.label,
          filterFn: (row, id, value: string) => {
            const cell = row.getValue<Cell>(id);
            if (c.type === "number" || c.type === "time") {
              const [a, b] = value.split("..");
              const parse = (v: string) =>
                c.type === "time" ? Date.parse(v) : Number(v);
              return (
                (!a || Number(cell) >= parse(a)) &&
                (!b || Number(cell) <= parse(b))
              );
            }
            return String(cell ?? "")
              .toLowerCase()
              .includes(value.toLowerCase());
          },
          cell: (info) =>
            c.type === "time"
              ? date(Number(info.getValue()))
              : typeof info.getValue() === "number"
                ? fmt(
                    info.getValue(),
                    c.key === "id" ? 0 : c.key.endsWith("slope") ? 6 : 2,
                  )
                : String(info.getValue() ?? "—"),
        })) ?? [],
    [data.data],
  );
  const defaultVisible = useMemo(() => {
    const v = { ...visible };
    data.data?.columns.forEach((c) => {
      if (
        !(c.key in v) &&
        ![
          "id",
          "source",
          "time",
          "side",
          "plotLabel",
          "treatmentName",
          "excluded",
          "reviewed",
          "overridden",
          "N2O_flux",
          "CO2_flux",
          "N2O_qc",
        ].includes(c.key)
      )
        v[c.key] = false;
    });
    return v;
  }, [data.data, visible]);
  const table = useReactTable({
    data: data.data?.rows ?? [],
    columns,
    state: {
      sorting,
      columnFilters: filters,
      columnVisibility: defaultVisible,
      globalFilter: s.dataSearch,
      rowSelection: selection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setFilters,
    onColumnVisibilityChange: setVisible,
    onRowSelectionChange: setSelection,
    onGlobalFilterChange: (v) => s.set({ dataSearch: String(v) }),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (r) => String(r.id),
  });
  const rs = table.getRowModel().rows,
    virt = useVirtualizer({
      count: rs.length,
      getScrollElement: () => parent.current,
      estimateSize: () => 39,
      overscan: 12,
    }),
    ids = Object.keys(selection)
      .filter((k) => selection[k])
      .map(Number),
    exportIds = ids.length ? ids : rs.map((r) => r.original.id);
  const doExport = (csv: boolean) =>
    void action(
      async () => {
        const args: ExportArgs = {
          path: csv ? "fluxes.csv" : "fluxes.xlsx",
          fluxIds: exportIds,
          columns: table.getVisibleLeafColumns().map((c) => c.id),
        };
        if (isTauri) {
          const p = await save({ defaultPath: args.path });
          if (!p) return;
          args.path = p;
        }
        await (csv ? api.exportCsv(args) : api.exportXlsx({ ...args, mode }));
        setExporting(false);
      },
      mockMode ? "Downloaded synthetic CSV" : "Export complete",
    );
  return (
    <div className="page data-page">
      <div className="page-heading">
        <div>
          <h2>Measurement data</h2>
          <p>Filter, inspect and export the complete analysis table.</p>
        </div>
        <button className="primary" onClick={() => setExporting(true)}>
          Export data ↗
        </button>
      </div>
      <div className="toolbar panel">
        <input
          aria-label="Search table"
          placeholder="Search all columns…"
          value={s.dataSearch}
          onChange={(e) => s.set({ dataSearch: e.target.value })}
        />
        <button onClick={() => setChooser(!chooser)}>Columns</button>
        <button
          onClick={() => {
            s.set({ subset: exportIds });
            s.nav("Treatments");
          }}
        >
          Show in Treatments →
        </button>
        <span>
          {rs.length.toLocaleString()} matching · {ids.length} selected
        </span>
        <button
          onClick={() => {
            setFilters([]);
            s.set({ dataSearch: "" });
            setSelection({});
          }}
        >
          Clear filters
        </button>
      </div>
      <div className="toolbar">
        <input
          aria-label="Preset name"
          placeholder="Filter preset name"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        />
        <button
          disabled={!preset}
          onClick={() => {
            const p = { ...presets, [preset]: filters };
            setPresets(p);
            localStorage.setItem("ffr-presets", JSON.stringify(p));
          }}
        >
          Save preset
        </button>
        <select
          aria-label="Load preset"
          onChange={(e) => setFilters(presets[e.target.value] ?? [])}
        >
          <option value="">Load preset…</option>
          {Object.keys(presets).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <small>
          Numeric / date ranges: minimum..maximum · Click headers to sort
        </small>
      </div>
      {chooser && (
        <Panel title="Visible columns">
          <div className="column-groups">
            {[...new Set(data.data?.columns.map((c) => c.group))].map(
              (group) => (
                <div key={group}>
                  <h4>{group}</h4>
                  {table
                    .getAllLeafColumns()
                    .filter(
                      (col) =>
                        data.data?.columns.find((c) => c.key === col.id)
                          ?.group === group,
                    )
                    .map((col) => (
                      <label key={col.id}>
                        <input
                          type="checkbox"
                          checked={col.getIsVisible()}
                          onChange={col.getToggleVisibilityHandler()}
                        />
                        {col.id}
                      </label>
                    ))}
                </div>
              ),
            )}
          </div>
        </Panel>
      )}
      <Status loading={data.isLoading} error={data.error} />
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
                      {h.column.getIsSorted() === "asc"
                        ? " ?"
                        : h.column.getIsSorted() === "desc"
                          ? " ?"
                          : ""}
                    </button>
                    <input
                      aria-label={"Filter " + h.id}
                      placeholder={
                        data.data?.columns.find((c) => c.key === h.id)?.type ===
                        "number"
                          ? "min..max"
                          : "Filter…"
                      }
                      value={String(h.column.getFilterValue() ?? "")}
                      onChange={(e) => h.column.setFilterValue(e.target.value)}
                    />
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
                        onClick={() => s.openFlux(r.original.id)}
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
                  virt.getTotalSize() -
                    (virt.getVirtualItems().at(-1)?.end ?? 0),
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
      {exporting && (
        <div className="modal-shade">
          <section
            role="dialog"
            aria-label="Export data"
            className="modal panel"
          >
            <h2>Export measurements</h2>
            <p>
              {exportIds.length.toLocaleString()} fluxes ·{" "}
              {table.getVisibleLeafColumns().length} visible columns
            </p>
            <Field label="Workbook layout">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="flat">Flat table</option>
                <option value="sheetPerPlot">Sheet per plot</option>
                <option value="dailyPerPlot">Daily means per plot</option>
              </select>
            </Field>
            {mockMode && (
              <p className="muted">
                Browser demo downloads CSV. Grouped and daily layouts use the
                selected mode.
              </p>
            )}
            <div className="toolbar">
              <button className="primary" onClick={() => doExport(false)}>
                {mockMode ? "Download selected layout" : "Export Excel"}
              </button>
              <button onClick={() => doExport(true)}>Flat CSV</button>
              <button onClick={() => setExporting(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
