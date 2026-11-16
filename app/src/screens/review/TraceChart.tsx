import type { EChartsCoreOption } from "echarts/core";
import { useRef } from "react";
import type { AnalysisOptions, FluxDetail, Gas } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import { Empty, Panel, plotBase } from "../../shared/common";
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
  const tr = detail.traces.find((t) => t.gas === gas)!,
    r = detail.regressions.find((r) => r.gas === gas)!,
    sib = detail.sibling.find((r) => r.gas === gas),
    drag = useRef(options);
  drag.current = options;
  if (!r)
    return (
      <Panel title={gas + " concentration"}>
        <Empty>
          No fit: measurement failed validation. Inspect the finding before
          including this flux.
        </Empty>
      </Panel>
    );
  const series: object[] = [0, 1, 2].map((side) => ({
    name: side === 0 ? "Discarded" : side === 1 ? "Left" : "Right",
    type: "scatter",
    symbolSize: side === 0 ? 3 : 5,
    itemStyle: {
      color: ["#9aa7b3", "#0072b2", "#d55e00"][side],
      opacity: detail.flux.excluded
        ? 0.25
        : side === (detail.flux.side === "left" ? 1 : 2)
          ? 1
          : 0.35,
    },
    data: tr.t.flatMap((v, i) => (tr.side[i] === side ? [[v, tr.y[i]]] : [])),
  }));
  series.push({
    name: "Used in fit",
    type: "scatter",
    symbolSize: 7,
    itemStyle: {
      color: detail.flux.side === "left" ? "#0072b2" : "#d55e00",
      opacity: detail.flux.excluded ? 0.25 : 1,
    },
    data: tr.t.flatMap((v, i) => (tr.used[i] ? [[v, tr.y[i]]] : [])),
  });
  series.push({
    name: "Fit",
    type: "line",
    showSymbol: false,
    lineStyle: { width: 2, color: "#168b7c" },
    data: [
      [r.start, r.intercept + r.slope * r.start],
      [r.stop, r.intercept + r.slope * r.stop],
    ],
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      lineStyle: { type: "dashed", color: "#a771be", opacity: 0.65 },
      data: detail.switches.map((sw) => ({ xAxis: sw.t + detail.valveLagS })),
    },
    markArea: {
      silent: true,
      itemStyle: { color: "rgba(100,145,145,.06)" },
      data: detail.switches.map((sw) => [
        {
          xAxis: sw.t + options.valveOffset,
          itemStyle: {
            color:
              sw.side === "left"
                ? "rgba(0,114,178,.035)"
                : "rgba(213,94,0,.035)",
          },
        },
        { xAxis: sw.t + options.valveOffset + 20 },
      ]),
    },
  });
  if (sib)
    series.push({
      name: "Sibling fit",
      type: "line",
      showSymbol: false,
      lineStyle: { width: 1, type: "dashed", opacity: 0.3, color: "#d55e00" },
      data: [
        [sib.start, sib.intercept + sib.slope * sib.start],
        [sib.stop, sib.intercept + sib.slope * sib.stop],
      ],
    });
  return (
    <Panel
      title={gas + " concentration"}
      extra={<span className="muted">ppm · 1 Hz · {tr.t.length} samples</span>}
    >
      <div className="trace-wrap">
        <Chart
          label={gas + " raw concentration trace"}
          height={240}
          option={
            { ...plotBase, animation: false, series } as EChartsCoreOption
          }
        />
        <div className="handle-space">
          {(["start", "stop"] as const).map((k) => (
            <div
              key={k}
              role="slider"
              tabIndex={0}
              aria-label={gas + " " + k + " handle"}
              aria-valuemin={0}
              aria-valuemax={185}
              aria-valuenow={options[k]}
              className={"window-handle " + k}
              style={{ left: (options[k] / 185) * 100 + "%" }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const v = {
                    ...options,
                    [k]: Math.max(
                      k === "stop" ? options.start + 1 : 0,
                      Math.min(
                        k === "start" ? options.stop - 1 : 185,
                        options[k] + (e.key === "ArrowRight" ? 1 : -1),
                      ),
                    ),
                  };
                  preview(v);
                  commit(v);
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const box =
                    e.currentTarget.parentElement!.getBoundingClientRect(),
                  v = Math.round(
                    Math.max(
                      0,
                      Math.min(185, ((e.clientX - box.left) / box.width) * 185),
                    ),
                  );
                const next = {
                  ...drag.current,
                  [k]:
                    k === "start"
                      ? Math.min(v, drag.current.stop - 1)
                      : Math.max(v, drag.current.start + 1),
                };
                drag.current = next;
                preview(next);
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                commit(drag.current);
              }}
            >
              <span>
                {k} {options[k]}s
              </span>
            </div>
          ))}
          <div
            className="window-handle offset-handle"
            role="slider"
            tabIndex={0}
            aria-label={gas + " valve offset handle"}
            aria-valuemin={-10}
            aria-valuemax={10}
            aria-valuenow={options.valveOffset}
            style={{ left: ((20 + options.valveOffset) / 185) * 100 + "%" }}
            onPointerDown={(e) =>
              e.currentTarget.setPointerCapture(e.pointerId)
            }
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const box =
                  e.currentTarget.parentElement!.getBoundingClientRect(),
                valveOffset = Math.max(
                  -10,
                  Math.min(
                    10,
                    Math.round(
                      (((e.clientX - box.left) / box.width) * 185 - 20) * 2,
                    ) / 2,
                  ),
                );
              const next = { ...drag.current, valveOffset };
              drag.current = next;
              preview(next);
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              commit(drag.current);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const next = {
                  ...options,
                  valveOffset: Math.max(
                    -10,
                    Math.min(
                      10,
                      options.valveOffset +
                        (e.key === "ArrowRight" ? 0.5 : -0.5),
                    ),
                  ),
                };
                preview(next);
                commit(next);
              }
            }}
          >
            <span>valve {options.valveOffset}s</span>
          </div>
        </div>
      </div>
      <Chart
        label={gas + " residual strip"}
        height={88}
        option={
          {
            animation: false,
            grid: { left: 65, right: 25, top: 12, bottom: 25 },
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "value",
              min: 0,
              max: 185,
              axisLabel: { show: false },
            },
            yAxis: {
              type: "value",
              splitNumber: 2,
              axisLabel: {
                formatter: (v: number) => v.toExponential(1),
                fontSize: 9,
              },
            },
            series: [
              {
                type: "scatter",
                symbolSize: 3,
                itemStyle: { color: "#7486a1" },
                data: tr.t.flatMap((t, i) =>
                  tr.fit[i] !== null ? [[t, tr.y[i] - tr.fit[i]!]] : [],
                ),
                markLine: {
                  silent: true,
                  symbol: "none",
                  label: { show: false },
                  data: [{ yAxis: 0 }],
                },
              },
            ],
          } as EChartsCoreOption
        }
      />
    </Panel>
  );
}
