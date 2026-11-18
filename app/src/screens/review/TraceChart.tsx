import type { EChartsCoreOption } from "echarts/core";
import { useRef } from "react";
import type { AnalysisOptions, FluxDetail, Gas } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import { Empty, unit } from "../../shared/common";
import { useStore } from "../../store";
import { anchorSwitch, usedRuns } from "./traceGeometry";

const chamberColour = ["#98a5af", "#0072b2", "#d55e00"],
  // Faint: this chamber's valve segments. Stronger: the points the fit uses,
  // i.e. the segments after the cuts, inside start/stop.
  chamberShade = ["", "rgba(0,114,178,.035)", "rgba(213,94,0,.035)"],
  usedShade = ["", "rgba(0,114,178,.13)", "rgba(213,94,0,.13)"];
type TooltipParam = {
  seriesName?: string;
  value?: unknown;
  axisValue?: number | string;
  marker?: string;
};
const short = (v: number) =>
  Math.abs(v) >= 1000 ? v.toFixed(0) : String(Number(v.toPrecision(5)));
const signed = (v: number) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toString();

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
    drag = useRef(options),
    dragging = useRef(false),
    anchor = useRef<number | null>(null);
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
    side = detail.flux.side === "left" ? 1 : 2,
    offset = o.valveOffset ?? 0,
    lag = gas === "N2O" ? Number(detail.flux.N2O_lagS) : detail.valveLagS,
    hasLag = Number.isFinite(lag) && Math.abs(lag - offset) >= 0.5,
    switches = [...detail.switches].sort((a, b) => a.t - b.t);
  // Segments of this chamber, after the valve timing shift: exactly where the
  // points that can enter this flux's regression come from.
  const segments = switches.flatMap((sw, i) =>
    sw.side === detail.flux.side
      ? [
          [
            { xAxis: sw.t + offset },
            { xAxis: (switches[i + 1]?.t ?? max - offset) + offset },
          ],
        ]
      : [],
  );
  const used = usedRuns(tr.t, tr.used).map(([a, b]) => [
    { xAxis: a },
    { xAxis: b },
  ]);
  const reportsRobust = o.fit === "robust";
  const line = (fit: typeof r | typeof robust) =>
    fit
      ? [
          [fit.start, fit.intercept + fit.slope * fit.start],
          [fit.stop, fit.intercept + fit.slope * fit.stop],
        ]
      : [];
  const series: object[] = [0, 1, 2].map((s) => ({
    name: s === 0 ? "Cut" : s === 1 ? "Left" : "Right",
    type: "scatter",
    symbolSize: s ? 4 : 2,
    itemStyle: {
      color: chamberColour[s],
      opacity: s === side ? 1 : 0.3,
    },
    data: tr.t.flatMap((t, i) => (tr.side[i] === s ? [[t, tr.y[i]]] : [])),
    xAxisIndex: 0,
    yAxisIndex: 0,
  }));
  series.push({
    name: "Used",
    type: "scatter",
    symbolSize: 5,
    itemStyle: { color: chamberColour[side] },
    data: tr.t.flatMap((t, i) => (tr.used[i] ? [[t, tr.y[i]]] : [])),
  });
  series.push({
    name: "Window",
    type: "line",
    data: [],
    markArea: {
      silent: true,
      itemStyle: { color: chamberShade[side] },
      data: segments,
    },
  });
  series.push({
    name: reportsRobust ? "Robust fit" : "Linear fit",
    type: "line",
    showSymbol: false,
    lineStyle: { color: "#168b7c", width: 1.5 },
    data: line(r),
    markArea: {
      silent: true,
      itemStyle: { color: usedShade[side] },
      data: used,
    },
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      data: [
        // Valve switches as the analysis uses them (shifted by the offset).
        ...switches.map((sw) => ({
          xAxis: sw.t + offset,
          lineStyle: { color: "#8999a5", type: "solid", opacity: 0.55 },
        })),
        // Where the robot logged them, when a shift is applied.
        ...(offset
          ? switches.map((sw) => ({
              xAxis: sw.t,
              lineStyle: { color: "#8999a5", type: "dotted", opacity: 0.35 },
            }))
          : []),
        ...(hasLag
          ? switches.map((sw, i) => ({
              xAxis: sw.t + lag,
              lineStyle: { type: "dashed", color: "#a771be", opacity: 0.7 },
              label: {
                show: i === 1,
                formatter: "estimated " + signed(lag) + " s",
                position: "insideEndTop",
                fontSize: 9,
              },
            }))
          : []),
      ],
    },
  });
  if (robust && !reportsRobust)
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
  const current = (key: "start" | "stop" | "valveOffset") =>
    ({ ...drag.current, ...drag.current.perGas?.[gas] })[key] ?? 0;
  const toPercent = (t: number) => ((t - zoom[0]) / (zoom[1] - zoom[0])) * 100;
  const timeAt = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    return zoom[0] + ((e.clientX - box.left) / box.width) * (zoom[1] - zoom[0]);
  };
  // The offset handle sits on a real valve switch line, kept fixed while it is
  // dragged or has keyboard focus.
  const nearest = anchorSwitch(
      switches.map((sw) => sw.t),
      (zoom[0] + zoom[1]) / 2,
    ),
    anchorIndex = anchor.current ?? nearest,
    anchored = switches[anchorIndex];
  /** Starts a handle drag: no text selection, and the drag always ends. */
  function beginDrag(e: React.PointerEvent<HTMLElement>) {
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    document.body.classList.add("handle-dragging");
  }
  function endDrag(e: React.PointerEvent<HTMLElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("handle-dragging");
    if (!dragging.current) return;
    dragging.current = false;
    commit(drag.current);
  }
  function keyStep(
    e: React.KeyboardEvent,
    key: "start" | "stop" | "valveOffset",
    step: number,
    limit: [number, number],
  ) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const value = Math.max(
      limit[0],
      Math.min(
        limit[1],
        (o[key] ?? 0) + (e.key === "ArrowRight" ? step : -step),
      ),
    );
    const next = update(key, value);
    preview(next);
    commit(next);
  }
  return (
    <section className="trace-panel">
      <h3>
        {gas} <small>{unit(tr.unit)} · residual below</small>
        {hasLag && (
          <button
            className="snap-lag"
            title={
              "Shift the valve switches to the estimated timing (" +
              signed(lag) +
              " s): the dashed purple lines"
            }
            onClick={() => {
              const next = update("valveOffset", Math.round(lag * 2) / 2);
              preview(next);
              commit(next);
            }}
          >
            Use estimated valve timing {signed(lag)} s
          </button>
        )}
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
              tooltip: {
                trigger: "axis",
                confine: true,
                padding: [3, 6],
                textStyle: { fontSize: 10, lineHeight: 13 },
                extraCssText: "box-shadow:none;opacity:.92;",
                // Beside the cursor along the top edge, not on the points.
                position: (
                  point: number[],
                  _p: unknown,
                  _d: unknown,
                  _r: unknown,
                  size: { contentSize: number[]; viewSize: number[] },
                ) => [
                  point[0] + 14 + size.contentSize[0] > size.viewSize[0]
                    ? point[0] - size.contentSize[0] - 14
                    : point[0] + 14,
                  2,
                ],
                formatter: (raw: TooltipParam | TooltipParam[]) => {
                  const ps = Array.isArray(raw) ? raw : [raw],
                    t = Number(ps[0]?.axisValue);
                  if (!Number.isFinite(t)) return "";
                  const lines = [t.toFixed(1) + " s"];
                  for (const p of ps)
                    if (["Left", "Right", "Cut"].includes(p.seriesName ?? ""))
                      lines.push(
                        (p.marker ?? "") +
                          p.seriesName +
                          " " +
                          short((p.value as number[])[1]),
                      );
                  if (t >= r.start && t <= r.stop)
                    lines.push("Fit " + short(r.intercept + r.slope * t));
                  if (robust && t >= robust.start && t <= robust.stop)
                    lines.push(
                      "Robust " + short(robust.intercept + robust.slope * t),
                    );
                  return lines.join("<br/>");
                },
              },
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
          {(["start", "stop"] as const).map((key) => (
            <div
              key={key}
              role="slider"
              tabIndex={0}
              aria-label={gas + " " + key + " handle"}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={o[key]}
              title={
                "Regression " +
                key +
                ": drag, or focus and use ←/→. Saved when you let go."
              }
              className={"window-handle " + key}
              style={{ left: toPercent(o[key]) + "%" }}
              onPointerDown={beginDrag}
              onPointerMove={(e) => {
                if (!dragging.current) return;
                const value = Math.max(0, Math.min(max, Math.round(timeAt(e))));
                if (value !== current(key)) preview(update(key, value));
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onKeyDown={(e) => keyStep(e, key, 1, [0, max])}
            >
              <span>
                {key === "start" ? "▶ Start" : "Stop ◀"} {o[key]} s
              </span>
            </div>
          ))}
          {anchored && (
            <div
              role="slider"
              tabIndex={0}
              aria-label={gas + " valve offset handle"}
              aria-valuemin={-10}
              aria-valuemax={10}
              aria-valuenow={offset}
              title={
                "Valve timing: drag this switch line to move all valve switches together. " +
                "Points are re-assigned to the left/right chamber live; the shaded bands " +
                "are this chamber's segments. Dotted lines: switch times as logged."
              }
              className="window-handle offset-handle"
              style={{ left: toPercent(anchored.t + offset) + "%" }}
              onFocus={() => (anchor.current = anchorIndex)}
              onBlur={() => (anchor.current = null)}
              onPointerDown={(e) => {
                anchor.current = anchorIndex;
                beginDrag(e);
              }}
              onPointerMove={(e) => {
                if (!dragging.current) return;
                const value = Math.max(
                  -10,
                  Math.min(10, Math.round((timeAt(e) - anchored.t) * 2) / 2),
                );
                if (value !== current("valveOffset"))
                  preview(update("valveOffset", value));
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onKeyDown={(e) => keyStep(e, "valveOffset", 0.5, [-10, 10])}
            >
              <span>
                ⇆ Valve timing {offset ? signed(offset) + " s" : "as logged"}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
