import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ECElementEvent } from "echarts/core";
import { memo, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api";
import type { FluxRow, Gas } from "../../api/types";
import { Empty, Field, Panel, Status, fmt, useRows } from "../../shared/common";
import { TimeBrush } from "../../shared/filters/TimeBrush";
import { dateTime, unit } from "../../shared/format";
import { useStore } from "../../store";
import { DistributionChart } from "./DistributionChart";
import { EmissionMap } from "./EmissionMap";
import { EnvironmentalContext } from "./EnvironmentalContext";
import { TimeChart, timeAxis, timeZoom } from "./TimeChart";
import { TotalChart } from "./TotalChart";

const Overview = memo(TimeBrush);
const emptyRows: FluxRow[] = [];
const dayMs = 86400000;
const timeGrid = { left: 65, right: 30, top: 25, bottom: 65 };

function openFluxPoint(p: ECElementEvent) {
  const value = p.value as number[];
  if (value?.[2]) useStore.getState().openFlux(value[2]);
}

export function Treatments() {
  const visible = useStore((s) => s.screen === "Treatments");
  const allFluxes = useRows();
  const rows = allFluxes.data?.rows ?? emptyRows;
  const s = useStore(
    useShallow(({ gas, from, to, sources, subset, focus, set, openFlux }) => ({
      gas,
      from,
      to,
      sources,
      subset,
      focus,
      set,
      openFlux,
    })),
  );
  const [fluxAsinh, setFluxAsinh] = useState(true);
  const [hidden, setHidden] = useState<number[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const seriesMeta = useQuery({
    queryKey: ["series"],
    enabled: visible,
    queryFn: () => api.listSeries(),
  });
  const from = s.from ? Date.parse(s.from) : undefined;
  const to = s.to ? Date.parse(s.to) + dayMs : undefined;
  const q = { gas: s.gas, from, to, sources: s.sources, fluxIds: s.subset };
  const result = useQuery({
    queryKey: ["summary", q],
    placeholderData: keepPreviousData,
    enabled: visible,
    queryFn: () => api.treatmentSummary(q),
  });
  const summary = result.data;
  const gas = summary?.gas ?? s.gas;
  const fluxUnit = unit(summary?.unit);
  const formatFlux = useMemo(
    () => (value: number) =>
      fluxUnit.startsWith("mol ") && Number.isFinite(value) && value !== 0
        ? value.toExponential(2)
        : fmt(value, 1),
    [fluxUnit],
  );
  const treatments = useMemo(
    () =>
      summary?.treatments.filter(
        (t) =>
          t.nPlots > 0 &&
          (s.focus === null || t.id === s.focus) &&
          !hidden.includes(t.id),
      ) ?? [],
    [summary, s.focus, hidden],
  );
  const colours = useMemo(
    () => new Map(treatments.map((t) => [t.id, t.colour])),
    [treatments],
  );
  const plots = useMemo(
    () =>
      summary?.plots.filter(
        (plot) => plot.points.length > 0 && colours.has(plot.treatmentId),
      ) ?? [],
    [summary, colours],
  );
  const { min, max } = useMemo(() => {
    let min = Number.POSITIVE_INFINITY,
      max = Number.NEGATIVE_INFINITY;
    for (const { time } of rows) {
      min = Math.min(min, time);
      max = Math.max(max, time);
    }
    for (const plot of summary?.plots ?? []) {
      if (plot.daily.length) min = Math.min(min, plot.daily[0].time);
    }
    for (const {
      timeRange: [start, end],
    } of seriesMeta.data ?? []) {
      min = Math.min(min, start);
      max = Math.max(max, end);
    }
    // A single explicit endpoint can be outside the available data.
    // Keep a valid shared domain for the empty portion of that range.
    return {
      min:
        from ??
        (Number.isFinite(min) || to !== undefined
          ? Math.min(min, (to ?? Infinity) - dayMs)
          : undefined),
      max:
        to ??
        (Number.isFinite(max) || from !== undefined
          ? Math.max(max, (from ?? -Infinity) + dayMs)
          : undefined),
    };
  }, [from, to, rows, summary, seriesMeta.data]);
  const bounds = useMemo(() => ({ min, max }), [min, max]);
  const lineOption = useMemo(
    () => ({
      animation: false,
      grid: timeGrid,
      tooltip: { trigger: "axis", renderMode: "richText" },
      xAxis: timeAxis(bounds),
      yAxis: { type: "value", scale: true },
      dataZoom: timeZoom(),
      series: plots.map((p) => ({
        type: "line",
        name: p.label,
        showSymbol: false,
        lineStyle: { color: colours.get(p.treatmentId), width: 1.5 },
        data: p.daily.map((v) => [v.time, v.cumulative]),
      })),
    }),
    [bounds, plots, colours],
  );
  const fluxLookup = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const fluxOption = useMemo(() => {
    const fluxKey = gas + "_flux";
    const display = (v: number) => (fluxAsinh ? Math.asinh(v) : v);
    const original = (v: number) => formatFlux(fluxAsinh ? Math.sinh(v) : v);
    const subset = s.subset ? new Set(s.subset) : null;
    return {
      animation: false,
      grid: timeGrid,
      xAxis: timeAxis(bounds),
      yAxis: {
        type: "value",
        scale: true,
        name: fluxUnit,
        axisLabel: { formatter: original },
      },
      dataZoom: timeZoom([0], "filter"),
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        formatter: ({
          value,
          seriesName,
        }: {
          value: number[];
          seriesName: string;
        }) =>
          seriesName +
          " · " +
          dateTime(value[0]) +
          "\nFlux #" +
          value[2] +
          ": " +
          original(value[1]),
      },
      series: [
        ...plots.map((p) => ({
          name: p.label,
          type: "scatter",
          itemStyle: { color: colours.get(p.treatmentId), opacity: 0.65 },
          data: p.points.flatMap((v) => {
            const flux = fluxLookup.get(v.fluxId);
            if (flux?.excluded) return [];
            const attention = flux?.attention ?? 0;
            return [
              {
                value: [v.time, display(v.value), v.fluxId],
                itemStyle: {
                  borderWidth: attention >= 30 ? 2 : 0,
                  borderColor: attention >= 70 ? "#c94e48" : "#c58a2f",
                },
                symbolSize: attention >= 30 ? 7 : 4,
              },
            ];
          }),
        })),
        {
          name: "Excluded",
          type: "scatter",
          symbolSize: 5,
          itemStyle: { color: "#8b969e", opacity: 0.25 },
          data: showExcluded
            ? rows.flatMap((r) => {
                const value = r[fluxKey];
                return r.excluded &&
                  typeof value === "number" &&
                  Number.isFinite(value) &&
                  (s.focus === null || r.treatmentId === s.focus) &&
                  !hidden.includes(r.treatmentId) &&
                  s.sources.includes(r.source) &&
                  (!subset || subset.has(r.id)) &&
                  (from === undefined || r.time >= from) &&
                  (to === undefined || r.time <= to)
                  ? [[r.time, display(value), r.id]]
                  : [];
              })
            : [],
        },
      ],
    };
  }, [
    bounds,
    colours,
    fluxAsinh,
    fluxLookup,
    fluxUnit,
    formatFlux,
    from,
    gas,
    hidden,
    plots,
    rows,
    s.focus,
    s.sources,
    s.subset,
    showExcluded,
    to,
  ]);
  const hasManual = useMemo(
    () => rows.some((r) => r.source === "manual"),
    [rows],
  );

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>Treatment comparison</h2>
          <p>From individual fluxes to cumulative field response.</p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
          />
          Show excluded points faintly
        </label>
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
            onChange={(e) =>
              s.set({ from: e.target.value, treatmentZoom: null })
            }
          />
        </Field>
        <Field label="To">
          <input
            aria-label="Summary to"
            type="date"
            value={s.to}
            onChange={(e) => s.set({ to: e.target.value, treatmentZoom: null })}
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
          onClick={() => {
            setHidden([]);
            s.set({
              focus: null,
              from: "",
              to: "",
              subset: undefined,
              treatmentZoom: null,
            });
          }}
        >
          Reset view
        </button>
        <span className="muted">
          {s.subset ? s.subset.length + " selected fluxes" : "All plots"}
        </span>
      </div>
      <Status loading={result.isLoading} error={result.error} />
      <Status loading={allFluxes.isLoading} error={allFluxes.error} />
      {allFluxes.data && !hasManual && s.sources.includes("manual") && (
        <p className="muted">
          No manual fluxes in this project. Robot data remain available.
        </p>
      )}
      {summary && (
        <>
          <Overview rows={rows} />
          <div className="treatment-legend">
            {summary.treatments
              .filter((t) => t.nPlots > 0)
              .map((t) => (
                <button
                  key={t.id}
                  className={
                    hidden.includes(t.id) ? "hidden-treatment" : "active"
                  }
                  onDoubleClick={() => {
                    s.set({ focus: null });
                    setHidden(
                      summary.treatments
                        .filter((v) => v.id !== t.id)
                        .map((v) => v.id),
                    );
                  }}
                  onClick={() => {
                    s.set({ focus: null });
                    setHidden((v) =>
                      v.includes(t.id)
                        ? v.filter((id) => id !== t.id)
                        : [...v, t.id],
                    );
                  }}
                >
                  <span className="dot" style={{ background: t.colour }} />
                  {t.name}
                </button>
              ))}
          </div>
          <div className="two charts">
            <TotalChart
              treatments={treatments}
              plots={plots}
              cumulativeUnit={summary.cumulativeUnit}
            />
            <DistributionChart
              treatments={treatments}
              plots={plots}
              fluxUnit={fluxUnit}
              formatFlux={formatFlux}
            />
          </div>
          <Panel
            title="Cumulative curves by plot"
            extra={
              <small>
                Trapezoid integration between measured days ·{" "}
                {unit(summary.cumulativeUnit)}
              </small>
            }
          >
            <TimeChart label="Cumulative plot curves" option={lineOption} />
          </Panel>
          <Panel
            title="Individual fluxes"
            extra={
              <label>
                <input
                  type="checkbox"
                  checked={fluxAsinh}
                  onChange={(e) => setFluxAsinh(e.target.checked)}
                />{" "}
                Symmetric log (asinh)
              </label>
            }
          >
            <TimeChart
              label="Individual fluxes over time"
              height={290}
              onClick={openFluxPoint}
              option={fluxOption}
            />
            <details className="accessible-points">
              <summary>Open a flux by keyboard</summary>
              <input
                type="number"
                min="1"
                aria-label="Treatment flux ID"
                placeholder="Flux ID, then Enter"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const id = Number(e.currentTarget.value);
                    if (
                      plots.some((p) => p.points.some((v) => v.fluxId === id))
                    )
                      s.openFlux(id);
                  }
                }}
              />
            </details>
          </Panel>
          <EnvironmentalContext
            meta={seriesMeta.data}
            loading={seriesMeta.isLoading}
            error={seriesMeta.error}
            visible={visible}
            bounds={bounds}
          />
          <EmissionMap
            summary={summary}
            rows={rows}
            updating={result.isPlaceholderData}
            visible={visible}
          />
          {!plots.length && (
            <Empty>No fluxes match the current selection.</Empty>
          )}
        </>
      )}
    </div>
  );
}
