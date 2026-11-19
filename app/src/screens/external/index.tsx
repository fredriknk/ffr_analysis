import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import { useEffect, useState } from "react";
import { api, mockMode } from "../../api";
import type { ImportReport } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import {
  Empty,
  Field,
  Panel,
  Status,
  pick,
  useAction,
} from "../../shared/common";
import { useStore } from "../../store";
import { RawFolderPanel } from "./RawFolderPanel";
import { manualImportMapping, suggestedColumns } from "./columnMapping";

function ColumnSelect({
  label,
  columns,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  columns: string[];
  value: string;
  placeholder?: string;
  onChange: (column: string) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {columns.filter(Boolean).map((column) => (
          <option key={column}>{column}</option>
        ))}
      </select>
    </Field>
  );
}

export function External() {
  const visible = useStore((s) => s.screen === "External data");
  const queryClient = useQueryClient();
  const frostClient = useQuery({
    queryKey: ["frost-client-id-saved"],
    queryFn: () => api.metnoGetClientId(),
    enabled: visible,
  });
  const action = useAction(),
    series = useQuery({
      queryKey: ["series"],
      enabled: visible,
      queryFn: () => api.listSeries(),
    }),
    [selected, setSelected] = useState(1),
    [wizard, setWizard] = useState<"series" | "manual" | null>(null),
    [path, setPath] = useState(""),
    [sheet, setSheet] = useState<string>(),
    [header, setHeader] = useState(0),
    [chosenColumns, setChosenColumns] = useState<
      Partial<ReturnType<typeof suggestedColumns>>
    >({}),
    [chosenValues, setValues] = useState(["temperature"]),
    [offset, setOffset] = useState("12"),
    [manualReport, setManualReport] = useState<ImportReport>(),
    [aggregate, setAggregate] = useState<"mean" | "sum" | "none">("mean"),
    [preview, setPreview] = useState<{
      path: string;
      sheet?: string;
      header: number;
      table: Awaited<ReturnType<typeof api.previewTable>>;
    }>(),
    [station, setStation] = useState("SN17850"),
    [client, setClient] = useState(""),
    [editingClient, setEditingClient] = useState(false),
    [fetchingWeather, setFetchingWeather] = useState(false),
    [from, setFrom] = useState("2023-01-01"),
    [to, setTo] = useState("2024-12-31");
  useEffect(() => {
    if (series.data?.length && !series.data.some((s) => s.id === selected))
      setSelected(series.data[0].id);
  }, [series.data, selected]);
  const points = useQuery({
    queryKey: ["series-points", selected],
    queryFn: () => api.getSeries([selected]),
    enabled: visible && !!series.data?.some((s) => s.id === selected),
  });
  const table = preview?.path === path ? preview.table : undefined;
  const columns = table?.columns ?? [];
  const mapping = { ...suggestedColumns(columns), ...chosenColumns };
  const manual = manualImportMapping(columns, mapping, offset);
  const values = chosenValues.filter(
    (v) => v !== mapping.time && columns.includes(v),
  );
  const activeSheet = sheet ?? table?.sheets[0];
  const previewIsCurrent =
    !!table &&
    preview?.header === header &&
    (preview.sheet ?? table.sheets[0]) === activeSheet;

  function resetMapping() {
    setChosenColumns({});
    setValues(["temperature"]);
  }

  function resetPreview() {
    setSheet(undefined);
    setPreview(undefined);
    resetMapping();
  }

  function openWizard(mode: "series" | "manual") {
    if (mode === wizard) return;
    resetPreview();
    setOffset("12");
    setManualReport(undefined);
    setWizard(mode);
  }

  function changePath(next: string) {
    setPath(next);
    resetPreview();
  }

  function fetchWeather() {
    setFetchingWeather(true);
    void action(async () => {
      const replacement = client.trim();
      if (replacement) {
        await api.metnoSetClientId(replacement);
        queryClient.setQueryData(["frost-client-id-saved"], true);
        setClient("");
        setEditingClient(false);
      }
      await api.metnoFetch({
        station,
        from: Date.parse(from),
        to: Date.parse(to),
      });
    }, "Weather updated").finally(() => setFetchingWeather(false));
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>External data</h2>
          <p>
            Weather, soil conditions and manual chamber campaigns alongside your
            fluxes.
          </p>
        </div>
        <div className="button-group">
          <button onClick={() => openWizard("manual")}>
            Import manual fluxes
          </button>
          <button className="primary" onClick={() => openWizard("series")}>
            Import series +
          </button>
        </div>
      </div>
      <Status loading={series.isLoading} error={series.error} />
      <div className="external-grid">
        <Panel title="Connected series">
          {series.data?.map((v) => (
            <div
              className={"series-row " + (selected === v.id ? "active" : "")}
              key={v.id}
            >
              <button onClick={() => setSelected(v.id)}>
                <strong>{v.name}</strong>
                <small>
                  {v.source} · {v.count.toLocaleString()} hourly values ·{" "}
                  {v.unit}
                </small>
              </button>
              <button
                aria-label={"Delete " + v.name}
                onClick={() => void action(() => api.deleteSeries(v.id))}
              >
                ×
              </button>
            </div>
          ))}
          {!series.data?.length && (
            <Empty>No series yet. Import a logger or fetch weather.</Empty>
          )}
        </Panel>
        <Panel
          title={
            series.data?.find((v) => v.id === selected)?.name ??
            "Series preview"
          }
        >
          <Status loading={points.isLoading} error={points.error} />
          {series.data?.some((s) => s.id === selected) ? (
            <Chart
              label="External series preview"
              height={290}
              option={
                {
                  grid: { left: 55, right: 25, top: 20, bottom: 65 },
                  tooltip: { trigger: "axis" },
                  xAxis: { type: "time" },
                  yAxis: { type: "value", scale: true },
                  dataZoom: [
                    { type: "inside" },
                    { type: "slider", height: 18 },
                  ],
                  series: points.data?.map((p) => ({
                    type: "line",
                    showSymbol: false,
                    lineStyle: { color: "#24877b", width: 1 },
                    areaStyle: { opacity: 0.08 },
                    data: p.points.map((v) => [v.time, v.value]),
                  })),
                } as EChartsCoreOption
              }
            />
          ) : (
            <Empty>
              No series selected. Import or choose a series to preview it.
            </Empty>
          )}
        </Panel>
      </div>
      {wizard && (
        <Panel
          title={
            wizard === "manual" ? "Import manual fluxes" : "Import time series"
          }
          extra={
            <button
              onClick={() => {
                setWizard(null);
                resetPreview();
              }}
            >
              Close
            </button>
          }
        >
          <div className="form-grid">
            <Field label="Excel / CSV path">
              <input
                value={path}
                onChange={(e) => changePath(e.target.value)}
              />
            </Field>
            <button onClick={() => void pick().then((p) => p && changePath(p))}>
              Browse file
            </button>
            <button
              disabled={!path.trim()}
              onClick={() =>
                void action(async () => {
                  const table = await api.previewTable(path, {
                    headerRow: header,
                    ...(sheet === undefined ? {} : { sheet }),
                  });
                  if (!previewIsCurrent) resetMapping();
                  setPreview({ path, header, sheet, table });
                })
              }
            >
              Preview table
            </button>
          </div>
          {table && (
            <>
              <div className="form-grid">
                <Field label="Sheet">
                  <select
                    value={activeSheet ?? ""}
                    onChange={(e) => setSheet(e.target.value)}
                  >
                    {table.sheets.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Header row (zero based)">
                  <input
                    type="number"
                    min="0"
                    value={header}
                    onChange={(e) => setHeader(Number(e.target.value))}
                  />
                </Field>
                <ColumnSelect
                  label="Time column"
                  columns={columns}
                  value={mapping.time}
                  onChange={(time) =>
                    setChosenColumns({ ...chosenColumns, time })
                  }
                />
                {wizard === "manual" ? (
                  <>
                    <ColumnSelect
                      label="Plot column"
                      columns={columns}
                      value={mapping.plot}
                      placeholder="Choose a column"
                      onChange={(plot) =>
                        setChosenColumns({ ...chosenColumns, plot })
                      }
                    />
                    {(["N2O", "CO2"] as const).map((gas) => (
                      <ColumnSelect
                        key={gas}
                        label={gas + " column"}
                        columns={columns}
                        value={mapping[gas]}
                        placeholder="None"
                        onChange={(column) =>
                          setChosenColumns({ ...chosenColumns, [gas]: column })
                        }
                      />
                    ))}
                    <Field label="Time offset (hours)">
                      <input
                        type="number"
                        step="any"
                        value={offset}
                        onChange={(e) => setOffset(e.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Aggregation">
                    <select
                      value={aggregate}
                      onChange={(e) =>
                        setAggregate(e.target.value as typeof aggregate)
                      }
                    >
                      <option>mean</option>
                      <option>sum</option>
                      <option>none</option>
                    </select>
                  </Field>
                )}
              </div>
              {wizard === "series" && (
                <>
                  <p>Value columns</p>
                  <div className="toolbar">
                    {columns
                      .filter((c) => c && c !== mapping.time)
                      .map((c) => (
                        <label key={c}>
                          <input
                            type="checkbox"
                            checked={values.includes(c)}
                            onChange={(e) =>
                              setValues(
                                e.target.checked
                                  ? [...values, c]
                                  : values.filter((v) => v !== c),
                              )
                            }
                          />
                          {c}
                        </label>
                      ))}
                  </div>
                </>
              )}
              <div className="preview-table">
                <table>
                  <thead>
                    <tr>
                      {table.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((v, j) => (
                          <td key={j}>{String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="primary"
                disabled={
                  !previewIsCurrent ||
                  (wizard === "manual"
                    ? !manual
                    : !mapping.time || !values.length)
                }
                onClick={() =>
                  void action(
                    async () => {
                      const source = { path, sheet, headerRow: header };
                      if (wizard === "manual") {
                        if (!manual) return;
                        setManualReport(
                          await api.importManualFluxes({
                            ...source,
                            ...manual,
                          }),
                        );
                      } else {
                        await api.importSeries({
                          ...source,
                          timeColumn: mapping.time,
                          valueColumns: values,
                          aggregate,
                        });
                      }
                      setWizard(null);
                      resetPreview();
                    },
                    wizard === "series" ? "Time series imported" : undefined,
                  )
                }
              >
                Import mapped data
              </button>
            </>
          )}
        </Panel>
      )}
      {manualReport && (
        <p role="status">
          Manual flux import · {manualReport.imported} rows imported ·{" "}
          {manualReport.unmatchedPlots ?? 0} without a matching plot ·{" "}
          {manualReport.skipped} skipped
        </p>
      )}
      <RawFolderPanel visible={visible} />
      <Panel title="met.no weather">
        <p className="muted">
          Hourly temperature and precipitation. Client ID stays outside the
          project.
        </p>
        <Status loading={frostClient.isLoading} error={frostClient.error} />
        {frostClient.data && (
          <div className="button-group">
            <span>Client ID saved for this user</span>
            {!editingClient && (
              <button
                disabled={fetchingWeather}
                onClick={() => setEditingClient(true)}
              >
                Change client ID
              </button>
            )}
          </div>
        )}
        <div className="form-grid">
          <Field label="Station">
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
            />
          </Field>
          {(!frostClient.data || editingClient) && (
            <Field label="Frost client ID">
              <input
                type="password"
                autoComplete="off"
                value={client}
                disabled={fetchingWeather}
                onChange={(e) => setClient(e.target.value)}
              />
            </Field>
          )}
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <button
          disabled={
            fetchingWeather ||
            (!mockMode && !frostClient.data && !client.trim())
          }
          onClick={fetchWeather}
        >
          {mockMode ? "Simulate weather fetch" : "Fetch weather"}
        </button>
      </Panel>
    </div>
  );
}
