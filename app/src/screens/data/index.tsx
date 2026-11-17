import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, isTauri, mockMode } from "../../api";
import type { Cell, ExportArgs, FluxRow } from "../../api/types";
import {
  Field,
  fmt,
  Panel,
  Status,
  useAction,
  useRows,
} from "../../shared/common";
import { codes, DiagnosticPicker } from "../../shared/diagnostics";
import { attention, dateTime, significant } from "../../shared/format";
import { useDiagnostics } from "../../shared/hooks/useDiagnostics";
import { FluxTableView } from "../../shared/table/FluxTableView";
import { useStore } from "../../store";
export function Data() {
  const active = useStore((s) => s.screen === "Data");
  const s = useStore(
      useShallow(({ dataSearch, set, nav, reviewThese, openFlux }) => ({
        dataSearch,
        set,
        nav,
        reviewThese,
        openFlux,
      })),
    ),
    data = useRows(),
    action = useAction(),
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
    [columnSearch, setColumnSearch] = useState(""),
    [selection, setSelection] = useState<Record<string, boolean>>({}),
    [exporting, setExporting] = useState(false),
    [mode, setMode] = useState<"flat" | "sheetPerPlot" | "dailyPerPlot">(
      "flat",
    ),
    [preset, setPreset] = useState(""),
    [presets, setPresets] = useState<Record<string, ColumnFiltersState>>(() =>
      JSON.parse(localStorage.getItem("ffr-presets") ?? "{}"),
    );
  const [diagnosticCodes, setDiagnosticCodes] = useState<string[]>([]);
  const diagnostics = useDiagnostics(active);
  const dataRows = useMemo(
    () =>
      data.data?.rows.filter(
        (r) =>
          !diagnosticCodes.length ||
          diagnosticCodes.some((c) => codes(r.diag).includes(c)),
      ) ?? [],
    [data.data, diagnosticCodes],
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
            "side",
            "N2O_flux",
            "CO2_flux",
            "N2O_rsq",
            "attention",
            "diag",
            "excluded",
            "reviewed",
            "airTemp",
          ];
          const rank = (key: string) =>
            order.includes(key) ? order.indexOf(key) : 99;
          return rank(a.key) - rank(b.key);
        })
        .map((c) => ({
          id: c.key,
          accessorKey: c.key,
          size:
            c.key === "id"
              ? 60
              : c.key === "time"
                ? 175
                : c.key === "diag"
                  ? 210
                  : 115,
          enableHiding: !["id", "time"].includes(c.key),
          header: () => (
            <span>
              {c.label}
              {c.unit && <small className="column-unit">{c.unit}</small>}
            </span>
          ),
          filterFn: (row, id, value: unknown) => {
            const cell = row.getValue<Cell>(id);
            if (c.type === "number" || c.type === "time") {
              const [a, b] = String(value ?? "").split("..");
              const parse = (v: string) =>
                c.type === "time" ? Date.parse(v) : Number(v);
              return (
                (!a || Number(cell) >= parse(a)) &&
                (!b ||
                  Number(cell) <=
                    parse(b) + (c.type === "time" ? 86400000 - 1 : 0))
              );
            }
            if (Array.isArray(value))
              return !value.length || value.includes(String(cell));
            return String(cell ?? "")
              .toLowerCase()
              .includes(String(value ?? "").toLowerCase());
          },
          cell: (info) =>
            c.key === "attention"
              ? attention(info.getValue())
              : c.key.endsWith("_flux") || c.key.endsWith("_robustFlux")
                ? significant(info.getValue())
                : c.key === "diag"
                  ? String(info.getValue() ?? "")
                      .split(",")
                      .map(
                        (code) =>
                          diagnostics.data?.find((d) => d.code === code)
                            ?.label ?? code.replaceAll("_", " "),
                      )
                      .join(", ")
                  : c.type === "boolean"
                    ? info.getValue()
                      ? "✓"
                      : "—"
                    : c.type === "time"
                      ? dateTime(Number(info.getValue()))
                      : typeof info.getValue() === "number"
                        ? fmt(
                            info.getValue(),
                            c.key === "id"
                              ? 0
                              : c.key.endsWith("slope")
                                ? 6
                                : 2,
                          )
                        : String(info.getValue() ?? "—"),
        })) ?? [],
    [data.data, diagnostics.data],
  );
  const defaultVisible = useMemo(() => {
    const v = { ...visible };
    data.data?.columns.forEach((c) => {
      if (
        !(c.key in v) &&
        ![
          "id",
          "time",
          "plotLabel",
          "treatmentName",
          "side",
          "N2O_flux",
          "CO2_flux",
          "N2O_rsq",
          "attention",
          "diag",
          "excluded",
          "reviewed",
          "airTemp",
        ].includes(c.key)
      )
        v[c.key] = false;
    });
    return v;
  }, [data.data, visible]);
  const table = useReactTable({
    data: dataRows,
    columns,
    state: {
      sorting,
      columnPinning: { left: ["id", "time"] },
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
          className="primary"
          disabled={!exportIds.length}
          onClick={() => s.reviewThese(exportIds)}
        >
          Review these
        </button>
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
            setDiagnosticCodes([]);
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
        <small>Typed column filters · Click headers to sort</small>
      </div>
      {chooser && (
        <Panel title="Visible columns">
          <input
            aria-label="Search columns"
            placeholder="Find a column…"
            value={columnSearch}
            onChange={(e) => setColumnSearch(e.target.value)}
          />
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
                          ?.group === group &&
                        (
                          data.data?.columns.find((c) => c.key === col.id)
                            ?.label ?? ""
                        )
                          .toLowerCase()
                          .includes(columnSearch.toLowerCase()),
                    )
                    .map((col) => (
                      <label
                        key={
                          data.data?.columns.find((c) => c.key === col.id)
                            ?.label ?? "Column"
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={!col.getCanHide()}
                          checked={col.getIsVisible()}
                          onChange={col.getToggleVisibilityHandler()}
                        />
                        {data.data?.columns.find((c) => c.key === col.id)
                          ?.label ?? "Column"}
                      </label>
                    ))}
                </div>
              ),
            )}
          </div>
        </Panel>
      )}
      <details className="panel diagnostic-filter">
        <summary>
          Filter by diagnostic code ({diagnosticCodes.length} selected)
        </summary>
        <Status loading={diagnostics.isLoading} error={diagnostics.error} />
        <DiagnosticPicker
          counts={(diagnostics.data ?? []).filter((c) => c.count)}
          value={diagnosticCodes}
          onChange={setDiagnosticCodes}
        />
      </details>
      <Status loading={data.isLoading} error={data.error} />
      <FluxTableView
        table={table}
        data={data.data ?? { columns: [], rows: [] }}
        onOpen={s.openFlux}
      />
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
