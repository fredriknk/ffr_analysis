import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import { useState } from "react";
import { api } from "../../api";
import type { Gas } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import {
  Empty,
  Field,
  Panel,
  Status,
  date,
  fmt,
  useRows,
} from "../../shared/common";
import { useStore } from "../../store";
export function Treatments() {
  const allFluxes = useRows();
  const s = useStore(),
    [log, setLog] = useState(false);
  const q = {
    gas: s.gas,
    from: s.from ? Date.parse(s.from) : undefined,
    to: s.to ? Date.parse(s.to) + 86400000 : undefined,
    sources: s.sources,
    fluxIds: s.subset,
  };
  const result = useQuery({
      queryKey: ["summary", q],
      queryFn: () => api.treatmentSummary(q),
    }),
    weather = useQuery({
      queryKey: ["weather", s.from, s.to],
      queryFn: () =>
        api.getSeries([1, 2], q.from, q.to, 20000).then((series) =>
          series.map((s) => {
            const days = new Map<number, number[]>();
            s.points.forEach((p) => {
              const day = Math.floor(p.time / 86400000) * 86400000;
              days.set(day, [...(days.get(day) ?? []), p.value]);
            });
            return {
              id: s.id,
              points: [...days].map(([time, v]) => ({
                time,
                value:
                  s.id === 2
                    ? v.reduce((a, b) => a + b, 0)
                    : v.reduce((a, b) => a + b, 0) / v.length,
              })),
            };
          }),
        ),
    });
  const d = result.data,
    ts = d?.treatments.filter((t) => !s.focus || t.id === s.focus) ?? [],
    ps = d?.plots.filter((p) => !s.focus || p.treatmentId === s.focus) ?? [];
  const colour = (id: number) => d?.treatments.find((t) => t.id === id)?.colour;
  const seriesTime = {
    grid: { left: 65, right: 30, top: 25, bottom: 65 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "time" },
    yAxis: { type: "value", scale: true },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 10 }],
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>Treatment comparison</h2>
          <p>From individual fluxes to cumulative field response.</p>
        </div>
        <span className="badge">Excluded fluxes omitted from summaries</span>
      </div>
      <div className="toolbar panel">
        <Field label="Gas">
          <select
            value={s.gas}
            onChange={(e) => s.set({ gas: e.target.value as Gas })}
          >
            {["N2O", "CO2", "CO", "H2O", "licor_H2O"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            aria-label="Summary from"
            type="date"
            value={s.from}
            onChange={(e) => s.set({ from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <input
            aria-label="Summary to"
            type="date"
            value={s.to}
            onChange={(e) => s.set({ to: e.target.value })}
          />
        </Field>
        {(["robot", "manual"] as const).map((source) => (
          <label key={source}>
            <input
              type="checkbox"
              checked={s.sources.includes(source)}
              onChange={(e) =>
                s.set({
                  sources: e.target.checked
                    ? [...s.sources, source]
                    : s.sources.filter((v) => v !== source),
                })
              }
            />
            {source}
          </label>
        ))}
        <button
          onClick={() =>
            s.set({ focus: null, from: "", to: "", subset: undefined })
          }
        >
          Reset view
        </button>
        <span className="muted">
          {s.subset ? s.subset.length + " selected fluxes" : "All plots"}
        </span>
      </div>
      <Status loading={result.isLoading} error={result.error} />
      {d && (
        <>
          <div className="toolbar brush">
            <span>Date-range brush</span>
            <input
              aria-label="Brush start date"
              type="range"
              min="0"
              max="728"
              value={
                s.from
                  ? Math.round(
                      (Date.parse(s.from) - Date.UTC(2023, 0, 4)) / 86400000,
                    )
                  : 0
              }
              onChange={(e) =>
                s.set({
                  from: new Date(
                    Date.UTC(2023, 0, 4) + Number(e.target.value) * 86400000,
                  )
                    .toISOString()
                    .slice(0, 10),
                })
              }
            />
            <input
              aria-label="Brush end date"
              type="range"
              min="0"
              max="728"
              value={
                s.to
                  ? Math.round(
                      (Date.parse(s.to) - Date.UTC(2023, 0, 4)) / 86400000,
                    )
                  : 728
              }
              onChange={(e) =>
                s.set({
                  to: new Date(
                    Date.UTC(2023, 0, 4) + Number(e.target.value) * 86400000,
                  )
                    .toISOString()
                    .slice(0, 10),
                })
              }
            />
          </div>
          <div className="treatment-legend">
            {d.treatments.map((t) => (
              <button
                key={t.id}
                className={s.focus === t.id ? "active" : ""}
                onClick={() => s.set({ focus: s.focus === t.id ? null : t.id })}
              >
                <span className="dot" style={{ background: t.colour }} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="two charts">
            <Panel
              title="Cumulative total by treatment"
              extra={<small>{d.cumulativeUnit} · mean ± population SD</small>}
            >
              <Chart
                label="Treatment cumulative totals"
                height={280}
                onClick={(p) => {
                  if (p.dataIndex != null)
                    s.set({ focus: ts[p.dataIndex]?.id ?? null });
                }}
                option={
                  {
                    grid: { left: 65, right: 20, top: 25, bottom: 80 },
                    tooltip: { trigger: "axis" },
                    xAxis: {
                      type: "category",
                      data: ts.map((t) => t.name),
                      axisLabel: { rotate: 40, fontSize: 10 },
                    },
                    yAxis: { type: "value", name: "kg ha⁻¹" },
                    series: [
                      {
                        type: "bar",
                        data: ts.map((t) => ({
                          value: t.mean,
                          itemStyle: { color: t.colour },
                        })),
                        barMaxWidth: 34,
                      },
                      {
                        type: "custom",
                        data: ts.map((t, i) => [
                          i,
                          t.mean - t.sd,
                          t.mean + t.sd,
                        ]),
                        renderItem: (
                          _p: unknown,
                          a: {
                            value: (i: number) => number;
                            coord: (v: number[]) => number[];
                          },
                        ) => {
                          const lo = a.coord([a.value(0), a.value(1)]),
                            hi = a.coord([a.value(0), a.value(2)]);
                          return {
                            type: "group",
                            children: [
                              {
                                type: "line",
                                shape: {
                                  x1: lo[0],
                                  y1: lo[1],
                                  x2: hi[0],
                                  y2: hi[1],
                                },
                                style: { stroke: "#73838e" },
                              },
                              ...[lo, hi].map((v) => ({
                                type: "line",
                                shape: {
                                  x1: v[0] - 5,
                                  y1: v[1],
                                  x2: v[0] + 5,
                                  y2: v[1],
                                },
                                style: { stroke: "#73838e" },
                              })),
                            ],
                          };
                        },
                      },
                    ],
                  } as EChartsCoreOption
                }
              />
            </Panel>
            <Panel
              title="Distribution of daily means"
              extra={
                <label>
                  <input
                    type="checkbox"
                    checked={log}
                    onChange={(e) => setLog(e.target.checked)}
                  />{" "}
                  Log scale
                </label>
              }
            >
              <Chart
                label="Daily means box plot"
                height={280}
                option={
                  {
                    grid: { left: 65, right: 20, top: 25, bottom: 80 },
                    tooltip: { trigger: "item" },
                    xAxis: {
                      type: "category",
                      data: ts.map((t) => t.name),
                      axisLabel: { rotate: 40, fontSize: 10 },
                    },
                    yAxis: { type: log ? "log" : "value", scale: true },
                    series: [
                      {
                        type: "boxplot",
                        data: ts.map((t) => ({
                          value: log
                            ? t.box.map((v) => Math.max(0.001, v))
                            : t.box,
                          itemStyle: {
                            color: t.colour + "55",
                            borderColor: t.colour,
                          },
                        })),
                      },
                    ],
                  } as EChartsCoreOption
                }
              />
            </Panel>
          </div>
          <Panel
            title="Cumulative curves by plot"
            extra={
              <small>
                Trapezoid integration between measured days · kg ha⁻¹
              </small>
            }
          >
            <Chart
              label="Cumulative plot curves"
              option={
                {
                  ...seriesTime,
                  series: ps.map((p) => ({
                    type: "line",
                    name: p.label,
                    showSymbol: false,
                    lineStyle: { color: colour(p.treatmentId), width: 1.5 },
                    data: p.daily.map((v) => [v.time, v.cumulative]),
                  })),
                } as EChartsCoreOption
              }
            />
          </Panel>
          <Panel
            title="Individual fluxes"
            extra={<small>Click any point to open its trace →</small>}
          >
            <Chart
              label="Individual fluxes over time"
              height={290}
              onClick={(p) => {
                const value = p.value as number[];
                if (value?.[2]) s.openFlux(value[2]);
              }}
              option={
                {
                  ...seriesTime,
                  tooltip: {
                    trigger: "item",
                    formatter: (p: { value: number[]; seriesName: string }) =>
                      p.seriesName +
                      " · " +
                      date(p.value[0]) +
                      "<br/>Flux #" +
                      p.value[2] +
                      ": " +
                      fmt(p.value[1], 1),
                  },
                  series: [
                    ...ps.map((p) => ({
                      name: p.label,
                      type: "scatter",
                      symbolSize: 5,
                      itemStyle: {
                        color: colour(p.treatmentId),
                        opacity: 0.65,
                      },
                      data: p.points.map((v) => [v.time, v.value, v.fluxId]),
                    })),
                    {
                      name: "Excluded",
                      type: "scatter",
                      symbolSize: 5,
                      itemStyle: { color: "#8b969e", opacity: 0.25 },
                      data:
                        allFluxes.data?.rows
                          .filter(
                            (r) =>
                              r.excluded &&
                              (!s.focus || r.treatmentId === s.focus) &&
                              s.sources.includes(r.source) &&
                              (!q.from || r.time >= q.from) &&
                              (!q.to || r.time <= q.to),
                          )
                          .map((r) => [r.time, r[s.gas + "_flux"], r.id]) ?? [],
                    },
                  ],
                } as EChartsCoreOption
              }
            />
            <div className="point-links">
              {ps.slice(0, 6).map(
                (p) =>
                  p.points[0] && (
                    <button
                      key={p.plotId}
                      onClick={() => s.openFlux(p.points[0].fluxId)}
                    >
                      Open {p.label} · #{p.points[0].fluxId} ↗
                    </button>
                  ),
              )}
            </div>
          </Panel>
          <Panel
            title="Weather context"
            extra={
              <small>
                Daily temperature and precipitation · shared date range above
              </small>
            }
          >
            <Chart
              label="Weather precipitation and temperature"
              height={190}
              option={
                {
                  ...seriesTime,
                  yAxis: [
                    { type: "value", name: "°C" },
                    { type: "value", name: "mm", splitLine: { show: false } },
                  ],
                  series: weather.data?.map((w, i) => ({
                    name: i ? "Precipitation" : "Temperature",
                    type: i ? "bar" : "line",
                    yAxisIndex: i,
                    showSymbol: false,
                    itemStyle: { color: i ? "#708ebd" : "#bd7d3e" },
                    areaStyle: i ? undefined : { opacity: 0.1 },
                    data: w.points.map((p) => [p.time, p.value]),
                  })),
                } as EChartsCoreOption
              }
            />
          </Panel>
          {!ps.some((p) => p.points.length) && (
            <Empty>No fluxes match this date range and source selection.</Empty>
          )}
        </>
      )}
    </div>
  );
}
