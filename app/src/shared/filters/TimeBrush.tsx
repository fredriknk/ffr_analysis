import type { EChartsCoreOption } from "echarts/core";
import { useShallow } from "zustand/react/shallow";
import type { FluxRow } from "../../api/types";
import { useStore } from "../../store";
import { Chart } from "../charts/Chart";
export function TimeBrush({ rows }: { rows: FluxRow[] }) {
  const s = useStore(
      useShallow(({ gas, from, to, set }) => ({ gas, from, to, set })),
    ),
    times = rows.map((r) => r.time),
    min = Math.min(...times),
    max = Math.max(...times);
  if (!rows.length) return null;
  const start = s.from
      ? Math.max(0, ((Date.parse(s.from) - min) / (max - min || 1)) * 100)
      : 0,
    end = s.to
      ? Math.min(
          100,
          ((Date.parse(s.to) + 86400000 - min) / (max - min || 1)) * 100,
        )
      : 100;
  const days = new Map<number, number[]>();
  rows
    .filter((r) => !r.excluded && typeof r[s.gas + "_flux"] === "number")
    .forEach((r) => {
      const day = Math.floor(r.time / 86400000) * 86400000;
      days.set(day, [...(days.get(day) ?? []), Number(r[s.gas + "_flux"])]);
    });
  return (
    <section className="panel time-brush">
      <div className="panel-title">
        <h3>Shared date range</h3>
        <small>
          Drag the handles or brush inside the overview. All plots and weather
          follow.
        </small>
      </div>
      <Chart
        label="Shared date-range brush"
        height={110}
        onReady={(c) => {
          c.on("datazoom", () => {
            const opt = c.getOption() as {
                dataZoom: { start: number; end: number }[];
              },
              zoom = opt.dataZoom[0];
            const day = (percent: number) =>
              new Date(min + ((max - min) * percent) / 100)
                .toISOString()
                .slice(0, 10);
            s.set({
              treatmentZoom: null,
              from: zoom.start < 0.01 ? "" : day(zoom.start),
              to: zoom.end > 99.99 ? "" : day(zoom.end),
            });
          });
        }}
        option={
          {
            animation: false,
            grid: { left: 65, right: 30, top: 5, bottom: 45 },
            xAxis: { type: "time", min, max },
            yAxis: { type: "value", show: false },
            dataZoom: [
              {
                type: "slider",
                start,
                end,
                height: 24,
                bottom: 0,
                brushSelect: true,
                filterMode: "none",
              },
            ],
            series: [
              {
                type: "line",
                showSymbol: false,
                lineStyle: { width: 1, color: "#438d83" },
                areaStyle: { opacity: 0.15 },
                data: [...days].map(([time, values]) => [
                  time,
                  values.reduce((a, b) => a + b, 0) / values.length,
                ]),
              },
            ],
          } as EChartsCoreOption
        }
      />
    </section>
  );
}
