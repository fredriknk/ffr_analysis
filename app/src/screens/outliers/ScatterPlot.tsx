import type { ECharts, EChartsCoreOption } from "echarts/core";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { FluxRow, Layout } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import { dateTime, significant } from "../../shared/common";
import { useStore } from "../../store";
import {
  clamp,
  inverse,
  robustBounds,
  transformed,
  type AxisScale,
} from "./axes";
export interface ScatterSpec {
  label: string;
  x: string;
  y: string;
  xLabel: string;
  yLabel: string;
  time?: boolean;
}
interface Props {
  spec: ScatterSpec;
  rows: FluxRow[];
  layout?: Layout;
  scale: AxisScale;
  full: boolean;
  colour: "severity" | "treatment";
  selected: number[];
  onSelect: (ids: number[]) => void;
  onOpen: (id: number) => void;
}
export const ScatterPlot = memo(function ScatterPlot({
  spec,
  rows,
  layout,
  scale,
  full,
  colour,
  selected,
  onSelect,
  onOpen,
}: Props) {
  const theme = useStore((s) => s.theme);
  const instance = useRef<ECharts>(),
    select = useRef(onSelect),
    open = useRef(onOpen),
    brushStarted = useRef(0);
  select.current = onSelect;
  open.current = onOpen;
  const dataset = useMemo(() => {
    const sx: AxisScale =
        spec.x.includes("flux") || spec.x === "dayMedian" ? scale : "linear",
      sy: AxisScale = spec.y.includes("flux") ? scale : "linear";
    const visible = rows.filter(
      (r) =>
        typeof r[spec.x] === "number" &&
        Number.isFinite(r[spec.x]) &&
        typeof r[spec.y] === "number" &&
        Number.isFinite(r[spec.y]) &&
        (scale !== "log" ||
          !["dayMedian", "CO2_flux", "N2O_flux"].includes(spec.x) ||
          Number(r[spec.x]) > 0) &&
        (scale !== "log" || !spec.y.includes("flux") || Number(r[spec.y]) > 0),
    );
    const xs = visible.map((r) =>
        spec.time ? Number(r[spec.x]) : transformed(Number(r[spec.x]), sx),
      ),
      ys = visible.map((r) => transformed(Number(r[spec.y]), sy)),
      xb = spec.time ? robustBounds(xs, true) : robustBounds(xs, full),
      yb = robustBounds(ys, full);
    const groups = new Map<
      string,
      { severity: string; colour: string; points: number[][] }
    >();
    visible.forEach((r, i) => {
      const severity =
          r.attention >= 70 ? "bad" : r.attention >= 30 ? "warn" : "info",
        key = severity + (colour === "treatment" ? "-" + r.treatmentId : "");
      let group = groups.get(key);
      if (!group) {
        group = {
          severity,
          colour:
            colour === "severity"
              ? severity === "bad"
                ? "#c94e48"
                : severity === "warn"
                  ? "#c58a2f"
                  : "#78929e"
              : (layout?.treatments.find((t) => t.id === r.treatmentId)
                  ?.colour ?? "#78929e"),
          points: [],
        };
        groups.set(key, group);
      }
      group.points.push([
        clamp(xs[i], xb),
        clamp(ys[i], yb),
        r.id,
        Number(r[spec.x]),
        Number(r[spec.y]),
      ]);
    });
    const series = [...groups.values()].sort(
      (a, b) =>
        ({ info: 0, warn: 1, bad: 2 })[a.severity as "info"] -
        { info: 0, warn: 1, bad: 2 }[b.severity as "info"],
    );
    return { visible, sx, sy, xb, yb, series };
  }, [rows, spec, scale, full, colour, layout]);
  const option = useMemo(
    () =>
      ({
        animation: false,
        grid: { left: 65, right: 20, top: 32, bottom: 47 },
        tooltip: {
          trigger: "item",
          formatter: (p: { value: number[] }) =>
            "Flux #" +
            p.value[2] +
            "<br/>" +
            (spec.time ? dateTime(p.value[3]) : significant(p.value[3])) +
            " / " +
            significant(p.value[4]),
        },
        toolbox: {
          right: 12,
          top: 0,
          feature: { brush: { type: ["rect", "polygon", "clear"] } },
        },
        brush: {
          toolbox: ["rect", "polygon", "clear"],
          brushMode: "multiple",
          xAxisIndex: 0,
          yAxisIndex: 0,
          throttleType: "debounce",
          throttleDelay: 80,
        },
        xAxis: {
          type: spec.time ? "time" : "value",
          min: dataset.xb[0],
          max: dataset.xb[1],
          name: spec.xLabel,
          nameLocation: "middle",
          nameGap: 29,
          axisLabel: {
            hideOverlap: true,
            fontSize: 10,
            formatter: spec.time
              ? undefined
              : (v: number) =>
                  new Intl.NumberFormat("en-GB", {
                    notation: "compact",
                    maximumSignificantDigits: 3,
                  }).format(inverse(v, dataset.sx)),
          },
        },
        yAxis: {
          type: "value",
          min: dataset.yb[0],
          max: dataset.yb[1],
          scale: true,
          splitNumber: 3,
          name: spec.yLabel,
          nameTextStyle: { fontSize: 9 },
          axisLabel: {
            fontSize: 9,
            formatter: (v: number) =>
              new Intl.NumberFormat("en-GB", {
                notation: "compact",
                maximumSignificantDigits: 3,
              }).format(inverse(v, dataset.sy)),
          },
        },
        series: [
          ...dataset.series.map((g, i) => ({
            id: "points-" + i,
            name: g.severity,
            type: "scatter",
            z: g.severity === "bad" ? 5 : g.severity === "warn" ? 3 : 1,
            large: false,
            largeThreshold: 2000,
            progressive: 2000,
            progressiveThreshold: 3000,
            symbol: "circle",
            symbolSize:
              g.severity === "bad" ? 5 : g.severity === "warn" ? 4 : 2.5,
            itemStyle: {
              color: g.colour,
              opacity: g.severity === "info" ? 0.22 : 0.8,
            },
            data: g.points,
            markLine:
              i === 0 && spec.x === "dayMedian"
                ? {
                    silent: true,
                    symbol: "none",
                    label: { show: false },
                    lineStyle: { type: "dashed", color: "#78929e" },
                    data: [
                      [
                        {
                          coord: [
                            Math.max(dataset.xb[0], dataset.yb[0]),
                            Math.max(dataset.xb[0], dataset.yb[0]),
                          ],
                        },
                        {
                          coord: [
                            Math.min(dataset.xb[1], dataset.yb[1]),
                            Math.min(dataset.xb[1], dataset.yb[1]),
                          ],
                        },
                      ],
                    ],
                  }
                : undefined,
          })),
          {
            id: "selection",
            name: "Selected",
            type: "scatter",
            z: 9,
            symbol: "circle",
            symbolSize: 7,
            itemStyle: {
              color: "transparent",
              borderColor: "#d55e00",
              borderWidth: 1.5,
            },
            data: [],
          },
        ],
      }) as EChartsCoreOption,
    [dataset, spec],
  );
  const ready = useCallback(
    (c: ECharts) => {
      instance.current = c;
      c.on("brushEnd", () => {
        brushStarted.current = performance.now();
      });
      c.on("brushselected", (event: unknown) => {
        const ev = event as {
          batch?: {
            selected: { seriesIndex: number; dataIndex: number[] }[];
          }[];
        };
        const ids = [
          ...new Set(
            ev.batch?.flatMap((b) =>
              b.selected.flatMap((s) =>
                s.dataIndex
                  .map((i) => dataset.series[s.seriesIndex]?.points[i]?.[2])
                  .filter((id): id is number => id !== undefined),
              ),
            ) ?? [],
          ),
        ];
        if (ids.length) {
          if (!brushStarted.current) brushStarted.current = performance.now();
          select.current(ids);
        }
      });
    },
    [dataset],
  );
  const click = useCallback((p: { value: unknown }) => {
    const v = p.value as number[];
    if (v?.[2]) open.current(v[2]);
  }, []);
  useEffect(() => {
    const c = instance.current;
    if (!c || c.isDisposed()) return;
    const ids = new Set(selected);
    c.setOption({
      series: [
        {
          id: "selection",
          data: dataset.series.flatMap((g) =>
            g.points.filter((p) => ids.has(p[2])),
          ),
        },
      ],
    });
    if (brushStarted.current) {
      const started = brushStarted.current;
      brushStarted.current = 0;
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.dispatchEvent(
            new CustomEvent("ffr-brush-latency", {
              detail: {
                milliseconds: performance.now() - started,
                selected: selected.length,
              },
            }),
          ),
        ),
      );
    }
  }, [selected, dataset, theme]);
  return (
    <section className="panel scatter-panel">
      <div className="panel-title">
        <h3>{spec.label}</h3>
        <small>
          {full ? "Full range" : "1st–99th percentile · edge points clamped"}
        </small>
      </div>
      <Chart
        label={spec.label}
        height={235}
        option={option}
        onReady={ready}
        onClick={click}
      />
      {!dataset.visible.length && (
        <div className="chart-empty">
          No values available for this comparison.
        </div>
      )}
    </section>
  );
});
