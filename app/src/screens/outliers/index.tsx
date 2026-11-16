import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api";
import type { Gas } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import {
  Empty,
  Field,
  fmt,
  Panel,
  Status,
  useAction,
  useRows,
} from "../../shared/common";
import { codes, diagnosticLabels } from "../../shared/diagnostics";
import { useStore } from "../../store";
export function Outliers() {
  const s = useStore(
      useShallow(({ openFlux, reviewThese }) => ({ openFlux, reviewThese })),
    ),
    data = useRows(),
    action = useAction(),
    [selected, setSelected] = useState<number[]>([]),
    [diagnostic, setDiagnostic] = useState<string | null>(null),
    [excluded, setExcluded] = useState(false),
    [gas, setGas] = useState<Gas>("N2O"),
    [log, setLog] = useState(false);
  const counts = useQuery({
      queryKey: ["diagnostics"],
      queryFn: () => api.diagnosticsSummary(),
    }),
    layout = useQuery({ queryKey: ["layout"], queryFn: () => api.getLayout() });
  const rows = useMemo(
    () =>
      data.data?.rows.filter(
        (r) =>
          (excluded || !r.excluded) &&
          (!diagnostic || codes(r.diag).includes(diagnostic)),
      ) ?? [],
    [data.data, excluded, diagnostic],
  );
  const selectedSet = new Set(selected);
  const pairs: {
    label: string;
    x: string;
    y: string;
    xLabel: string;
    yLabel: string;
    time?: boolean;
  }[] = [
    {
      label: "N₂O versus CO₂",
      x: "CO2_flux",
      y: "N2O_flux",
      xLabel: "CO₂ · µg C m⁻² h⁻¹",
      yLabel: "N₂O · µg N m⁻² h⁻¹",
    },
    {
      label: "Fit quality versus flux",
      x: gas + "_rsq",
      y: gas + "_flux",
      xLabel: "R²",
      yLabel: gas + (gas === "N2O" ? " - ?g N m⁻² h⁻¹" : " - ?g C m⁻² h⁻¹"),
    },
    {
      label: "Valve lag over time",
      x: "time",
      y: "valveLagS",
      xLabel: "Date",
      yLabel: "Estimated lag · s",
      time: true,
    },
    {
      label: "Fluxes by treatment",
      x: "time",
      y: gas + "_flux",
      xLabel: "Date",
      yLabel: gas + (gas === "N2O" ? " - ?g N m⁻² h⁻¹" : " - ?g C m⁻² h⁻¹"),
      time: true,
    },
  ];
  function plot(pair: (typeof pairs)[number]) {
    const visible = rows.filter(
      (r) =>
        typeof r[pair.x] === "number" &&
        typeof r[pair.y] === "number" &&
        (!log || !pair.x.includes("flux") || Number(r[pair.x]) > 0) &&
        (!log || !pair.y.includes("flux") || Number(r[pair.y]) > 0),
    );
    return (
      <Panel
        key={pair.label}
        title={pair.label}
        extra={
          <small>Click to inspect · drag a box or polygon to select</small>
        }
      >
        <Chart
          label={pair.label}
          height={285}
          onClick={(p) => {
            const v = p.value as number[];
            if (v?.[2]) s.openFlux(v[2]);
          }}
          onReady={(c) => {
            c.on("brushselected", (event: unknown) => {
              const ev = event as {
                batch?: {
                  selected: { seriesIndex: number; dataIndex: number[] }[];
                }[];
              };
              const ids = [
                ...new Set(
                  ev.batch?.flatMap((b) =>
                    b.selected.flatMap((sel) =>
                      sel.dataIndex
                        .map((i) => visible[i]?.id)
                        .filter((v): v is number => v !== undefined),
                    ),
                  ) ?? [],
                ),
              ];
              if (ids.length)
                setSelected((prev) =>
                  prev.join(",") === ids.join(",") ? prev : ids,
                );
            });
          }}
          option={
            {
              animation: false,
              grid: { left: 75, right: 25, top: 35, bottom: 55 },
              tooltip: {
                trigger: "item",
                formatter: (p: { value: number[] }) =>
                  "Flux #" +
                  p.value[2] +
                  "<br/>" +
                  fmt(p.value[0], 2) +
                  " / " +
                  fmt(p.value[1], 2),
              },
              toolbox: {
                right: 15,
                top: 0,
                feature: { brush: { type: ["rect", "polygon", "clear"] } },
              },
              brush: {
                toolbox: ["rect", "polygon", "clear"],
                brushMode: "multiple",
                xAxisIndex: 0,
                yAxisIndex: 0,
              },
              xAxis: {
                type: pair.time
                  ? "time"
                  : log && pair.x.includes("flux")
                    ? "log"
                    : "value",
                name: pair.xLabel,
                nameLocation: "middle",
                nameGap: 30,
                axisLabel: {
                  hideOverlap: true,
                  formatter: pair.time
                    ? undefined
                    : (v: number) =>
                        new Intl.NumberFormat("en-GB", {
                          notation: "compact",
                          maximumFractionDigits: 2,
                        }).format(v),
                },
                scale: true,
              },
              yAxis: {
                type: log && pair.y.includes("flux") ? "log" : "value",
                name: pair.yLabel,
                nameTextStyle: { fontSize: 10 },
                scale: true,
                splitNumber: 4,
              },
              series: [
                {
                  type: "scatter",
                  symbolSize: (_v: number[], p: { dataIndex: number }) =>
                    selectedSet.has(visible[p.dataIndex].id)
                      ? 10
                      : visible[p.dataIndex].attention >= 30
                        ? 7
                        : 4,
                  data: visible.map((r) => ({
                    value: [r[pair.x], r[pair.y], r.id],
                    symbol: r.attention >= 30 ? "diamond" : "circle",
                    itemStyle: {
                      color: selectedSet.has(r.id)
                        ? "#d55e00"
                        : (layout.data?.treatments.find(
                            (t) => t.id === r.treatmentId,
                          )?.colour ?? "#258c80"),
                      opacity: r.excluded
                        ? 0.2
                        : selectedSet.size && !selectedSet.has(r.id)
                          ? 0.15
                          : 0.8,
                      borderColor: r.attention >= 70 ? "#c34f48" : undefined,
                      borderWidth: r.attention >= 70 ? 1 : 0,
                    },
                  })),
                },
              ],
            } as EChartsCoreOption
          }
        />
      </Panel>
    );
  }
  const selectedIds = selected.filter((id) => rows.some((r) => r.id === id));
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>Outlier hunting</h2>
          <p>
            Link unusual fluxes to their raw evidence. Diagnostics guide review;
            they never exclude data automatically.
          </p>
        </div>
        <span className="badge">
          {rows.length.toLocaleString()} visible fluxes
        </span>
      </div>
      <div className="toolbar panel">
        <Field label="Gas">
          <select
            aria-label="Outlier gas"
            value={gas}
            onChange={(e) => setGas(e.target.value as Gas)}
          >
            <option>N2O</option>
            <option>CO2</option>
          </select>
        </Field>
        <label>
          <input
            type="checkbox"
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
          />
          Show excluded
        </label>
        <label>
          <input
            type="checkbox"
            checked={log}
            onChange={(e) => setLog(e.target.checked)}
          />
          Log flux axes
        </label>
        <strong>{selectedIds.length} selected</strong>
        <button onClick={() => setSelected(rows.map((r) => r.id))}>
          Select all visible
        </button>
        <button
          className="primary"
          disabled={!selectedIds.length}
          onClick={() => s.reviewThese(selectedIds)}
        >
          Review these →
        </button>
        <button
          disabled={!selectedIds.length}
          onClick={() =>
            void action(() => api.setFluxFlags(selectedIds, { excluded: true }))
          }
        >
          Exclude selected
        </button>
        <button
          disabled={!selectedIds.length}
          onClick={() =>
            void action(() => api.setFluxFlags(selectedIds, { reviewed: true }))
          }
        >
          Mark selected reviewed
        </button>
        <button
          onClick={() => {
            setSelected([]);
            setDiagnostic(null);
          }}
        >
          Clear selection & filter
        </button>
        {log && <small>Log axes show positive fluxes only.</small>}
      </div>
      <Status loading={data.isLoading} error={data.error} />
      <Status loading={layout.isLoading} error={layout.error} />
      <div className="outliers-layout">
        <aside className="panel diagnostic-bars">
          <h3>Findings across the project</h3>
          <Status loading={counts.isLoading} error={counts.error} />
          {counts.data
            ?.filter((c) => c.count)
            .map((c) => (
              <button
                className={diagnostic === c.code ? "active" : ""}
                key={c.code}
                onClick={() => {
                  setDiagnostic(diagnostic === c.code ? null : c.code);
                  setSelected([]);
                }}
                title={c.description}
              >
                <span>{diagnosticLabels[c.code] ?? c.label}</span>
                <strong>{c.count.toLocaleString()}</strong>
                <i
                  style={{
                    width:
                      (c.count /
                        Math.max(...counts.data!.map((c) => c.count))) *
                        100 +
                      "%",
                  }}
                />
              </button>
            ))}
          {!counts.isLoading && !counts.data?.some((c) => c.count) && (
            <Empty>No findings.</Empty>
          )}
        </aside>
        <div className="outlier-plots two">{pairs.map(plot)}</div>
      </div>
      {!rows.length && <Empty>No fluxes match this view.</Empty>}
      <p className="muted">
        Diamonds indicate findings; red outlines indicate severe findings. A
        selection is highlighted across all four charts.
      </p>
    </div>
  );
}
