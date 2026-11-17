import type { EChartsCoreOption } from "echarts/core";
import { useRef } from "react";
import type { AnalysisOptions, FluxDetail, Gas } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import { Empty, unit } from "../../shared/common";
import { useStore } from "../../store";
export function TraceChart({
  detail,
  gas,
  options,
  preview,
  commit,
}: {
  detail: FluxDetail;
  gas: Gas;
  options: AnalysisOptions;
  preview: (o: AnalysisOptions) => void;
  commit: (o: AnalysisOptions) => void;
}) {
  const zoom = useStore((s) => s.traceZoom),
    set = useStore((s) => s.set),
    tr = detail.traces.find((t) => t.gas === gas),
    r = detail.regressions.find((r) => r.gas === gas),
    robust = detail.robust?.find((r) => r.gas === gas),
    sib = detail.sibling.find((r) => r.gas === gas),
    o = { ...options, ...options.perGas?.[gas] },
    drag = useRef(options);
  drag.current = options;
  if (!tr || !r)
    return (
      <section className="trace-panel">
        <h3>{gas}</h3>
        <Empty>No fit available for this measurement.</Empty>
      </section>
    );
  const max = Math.max(185, ...tr.t),
    min = Math.min(0, ...tr.t),
    lag = gas === "N2O" ? Number(detail.flux.N2O_lagS) : detail.valveLagS;
  const line = (fit: typeof r | typeof robust) =>
    fit
      ? [
          [fit.start, fit.intercept + fit.slope * fit.start],
          [fit.stop, fit.intercept + fit.slope * fit.stop],
        ]
      : [];
  const series: object[] = [0, 1, 2].map((side) => ({
    name: side === 0 ? "Cut" : side === 1 ? "Left" : "Right",
    type: "scatter",
    symbolSize: side ? 4 : 2,
    itemStyle: {
      color: ["#98a5af", "#0072b2", "#d55e00"][side],
      opacity: side === (detail.flux.side === "left" ? 1 : 2) ? 1 : 0.3,
    },
    data: tr.t.flatMap((t, i) => (tr.side[i] === side ? [[t, tr.y[i]]] : [])),
    xAxisIndex: 0,
    yAxisIndex: 0,
  }));
  series.push({
    name: "Used",
    type: "scatter",
    symbolSize: 5,
    itemStyle: { color: detail.flux.side === "left" ? "#0072b2" : "#d55e00" },
    data: tr.t.flatMap((t, i) => (tr.used[i] ? [[t, tr.y[i]]] : [])),
  });
  series.push({
    name: "Linear fit",
    type: "line",
    showSymbol: false,
    lineStyle: { color: "#168b7c", width: 1.5 },
    data: line(r),
    markArea: {
      silent: true,
      itemStyle: { color: "rgba(80,140,150,.045)" },
      data: detail.switches.map((sw) => [
        { xAxis: sw.t + o.valveOffset },
        { xAxis: sw.t + o.valveOffset + 20 },
      ]),
    },
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      lineStyle: { type: "dashed", color: "#a771be", opacity: 0.65 },
      data:
        Number.isFinite(lag) && Math.abs(lag) >= 1
          ? detail.switches.map((sw) => ({ xAxis: sw.t + lag }))
          : [],
    },
  });
  if (robust)
    series.push({
      name: "Robust fit",
      type: "line",
      showSymbol: false,
      lineStyle: { color: "#9d62ad", type: "dashed", width: 2 },
      data: line(robust),
    });
  if (sib)
    series.push({
      name: "Sibling",
      type: "line",
      showSymbol: false,
      lineStyle: { color: "#7f8da4", opacity: 0.35, type: "dotted", width: 1 },
      data: line(sib),
    });
  series.push({
    name: "Residual",
    type: "scatter",
    xAxisIndex: 1,
    yAxisIndex: 1,
    symbolSize: 2,
    itemStyle: { color: "#7e8fa6" },
    data: tr.t.flatMap((t, i) =>
      tr.used[i]
        ? [[t, tr.y[i] - (tr.fit?.[i] ?? r.intercept + r.slope * t)]]
        : [],
    ),
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      data: [{ yAxis: 0 }],
    },
  });
  function update(key: "start" | "stop" | "valveOffset", value: number) {
    const next = options.perGas?.[gas]
      ? {
          ...drag.current,
          perGas: {
            ...drag.current.perGas,
            [gas]: { ...drag.current.perGas?.[gas], [key]: value },
          },
        }
      : { ...drag.current, [key]: value };
    drag.current = next;
    return next;
  }
  return (
    <section className="trace-panel">
      <h3>
        {gas} <small>{unit(tr.unit)} · residual below</small>
      </h3>
      <div className="trace-fill">
        <Chart
          label={gas + " raw concentration trace"}
          height="100%"
          group="review-traces"
          onReady={(c) => {
            c.on("datazoom", () => {
              const config = c.getOption() as {
                dataZoom: {
                  startValue?: number;
                  endValue?: number;
                  start: number;
                  end: number;
                }[];
              };
              const z = config.dataZoom[0],
                a = z.startValue ?? min + ((max - min) * z.start) / 100,
                b = z.endValue ?? min + ((max - min) * z.end) / 100;
              if (Math.abs(a - zoom[0]) > 0.01 || Math.abs(b - zoom[1]) > 0.01)
                set({ traceZoom: [a, b] });
            });
          }}
          option={
            {
              animation: false,
              grid: [
                { left: 54, right: 12, top: 12, bottom: 72 },
                { left: 54, right: 12, height: 30, bottom: 24 },
              ],
              tooltip: { trigger: "axis" },
              axisPointer: { link: [{ xAxisIndex: "all" }] },
              xAxis: [
                {
                  type: "value",
                  min,
                  max,
                  gridIndex: 0,
                  axisLabel: { show: false },
                },
                {
                  type: "value",
                  min,
                  max,
                  gridIndex: 1,
                  axisLabel: { fontSize: 9 },
                  name: "s",
                  nameGap: 4,
                },
              ],
              yAxis: [
                {
                  type: "value",
                  scale: true,
                  gridIndex: 0,
                  splitNumber: 3,
                  axisLabel: { fontSize: 10 },
                },
                {
                  type: "value",
                  scale: true,
                  gridIndex: 1,
                  splitNumber: 1,
                  axisLabel: {
                    fontSize: 8,
                    formatter: (v: number) => v.toExponential(0),
                  },
                },
              ],
              dataZoom: [
                {
                  type: "inside",
                  xAxisIndex: [0, 1],
                  startValue: zoom[0],
                  endValue: zoom[1],
                  filterMode: "none",
                },
              ],
              series,
            } as EChartsCoreOption
          }
        />
        <div className="trace-handle-space">
          {(["start", "stop", "valveOffset"] as const).map((key) => {
            const value =
                key === "valveOffset" ? 20 + (o.valveOffset ?? 0) : o[key],
              position = ((value - zoom[0]) / (zoom[1] - zoom[0])) * 100;
            return (
              <div
                key={key}
                role="slider"
                tabIndex={0}
                aria-label={
                  gas +
                  " " +
                  (key === "valveOffset" ? "valve offset" : key) +
                  " handle"
                }
                aria-valuemin={key === "valveOffset" ? -10 : 0}
                aria-valuemax={key === "valveOffset" ? 10 : max}
                aria-valuenow={o[key] ?? 0}
                className={
                  "window-handle " +
                  (key === "valveOffset" ? "offset-handle" : key)
                }
                style={{ left: position + "%" }}
                onPointerDown={(e) =>
                  e.currentTarget.setPointerCapture(e.pointerId)
                }
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const box =
                      e.currentTarget.parentElement!.getBoundingClientRect(),
                    t =
                      zoom[0] +
                      ((e.clientX - box.left) / box.width) *
                        (zoom[1] - zoom[0]),
                    value =
                      key === "valveOffset"
                        ? Math.max(
                            -10,
                            Math.min(10, Math.round((t - 20) * 2) / 2),
                          )
                        : Math.max(0, Math.min(max, Math.round(t)));
                  preview(update(key, value));
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  commit(drag.current);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const value =
                      (o[key] ?? 0) + (e.key === "ArrowRight" ? 1 : -1);
                    const next = update(key, value);
                    preview(next);
                    commit(next);
                  }
                }}
              >
                <span>
                  {key === "valveOffset" ? "δ" : key} {o[key] ?? 0}s
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
