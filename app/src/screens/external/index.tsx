import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import { useEffect, useState } from "react";
import { api, mockMode } from "../../api";
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
export function External() {
  const visible = useStore((s) => s.screen === "External data");
  const action = useAction(),
    series = useQuery({
      queryKey: ["series"],
      enabled: visible,
      queryFn: () => api.listSeries(),
    }),
    [selected, setSelected] = useState(1),
    [wizard, setWizard] = useState<"series" | "manual" | null>(null),
    [path, setPath] = useState(""),
    [sheet, setSheet] = useState("Measurements"),
    [header, setHeader] = useState(0),
    [timeCol, setTimeCol] = useState("date"),
    [values, setValues] = useState(["temperature"]),
    [aggregate, setAggregate] = useState<"mean" | "sum" | "none">("mean"),
    [preview, setPreview] =
      useState<Awaited<ReturnType<typeof api.previewTable>>>(),
    [station, setStation] = useState("SN17850"),
    [client, setClient] = useState(""),
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
          <button onClick={() => setWizard("manual")}>
            Import manual fluxes
          </button>
          <button className="primary" onClick={() => setWizard("series")}>
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
                setPreview(undefined);
              }}
            >
              Close
            </button>
          }
        >
          <div className="form-grid">
            <Field label="Excel / CSV path">
              <input value={path} onChange={(e) => setPath(e.target.value)} />
            </Field>
            <button onClick={() => void pick().then((p) => p && setPath(p))}>
              Browse file
            </button>
            <button
              onClick={() =>
                void action(async () =>
                  setPreview(
                    await api.previewTable(path, { headerRow: header, sheet }),
                  ),
                )
              }
            >
              Preview table
            </button>
          </div>
          {preview && (
            <>
              <div className="form-grid">
                <Field label="Sheet">
                  <select
                    value={sheet}
                    onChange={(e) => setSheet(e.target.value)}
                  >
                    {preview.sheets.map((v) => (
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
                <Field label="Time column">
                  <select
                    value={timeCol}
                    onChange={(e) => setTimeCol(e.target.value)}
                  >
                    {preview.columns.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
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
              </div>
              <p>Value columns</p>
              <div className="toolbar">
                {preview.columns
                  .filter((c) => c !== timeCol)
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
              <div className="preview-table">
                <table>
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((v, j) => (
                          <td key={j}>{String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {wizard === "manual" && (
                <p>
                  Manual mapping: date ? {timeCol}, plot → plot, N2O ? N2O, CO2
                  ? CO2; +12 h offset.
                </p>
              )}
              <button
                className="primary"
                disabled={!values.length}
                onClick={() =>
                  void action(async () => {
                    if (wizard === "manual")
                      await api.importManualFluxes({
                        path,
                        sheet,
                        headerRow: header,
                        dateColumn: timeCol,
                        plotColumn: "plot",
                        gasColumns: { N2O: "N2O", CO2: "CO2" },
                        offsetHours: 12,
                      });
                    else
                      await api.importSeries({
                        path,
                        sheet,
                        headerRow: header,
                        timeColumn: timeCol,
                        valueColumns: values,
                        aggregate,
                      });
                    setWizard(null);
                  }, "Synthetic import complete")
                }
              >
                Import mapped data
              </button>
            </>
          )}
        </Panel>
      )}
      <Panel title="met.no weather">
        <p className="muted">
          Hourly temperature and precipitation. Client ID stays outside the
          project.
        </p>
        <div className="form-grid">
          <Field label="Station">
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
            />
          </Field>
          <Field label="Frost client ID">
            <input
              type="password"
              autoComplete="off"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </Field>
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
          onClick={() =>
            void action(async () => {
              await api.metnoSetClientId(client);
              setClient("");
              await api.metnoFetch({
                station,
                from: Date.parse(from),
                to: Date.parse(to),
              });
            }, "Weather updated")
          }
        >
          {mockMode ? "Simulate weather fetch" : "Fetch weather"}
        </button>
      </Panel>
    </div>
  );
}
