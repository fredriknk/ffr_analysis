import { memo, useMemo, useState } from "react";
import type { TreatmentSummary } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import { Panel, fmt } from "../../shared/common";
import { useStore } from "../../store";
import {
  inverse,
  quantile,
  transformed,
  type AxisScale,
} from "../outliers/axes";

export const DistributionChart = memo(function DistributionChart({
  treatments,
  plots,
}: {
  treatments: TreatmentSummary["treatments"];
  plots: TreatmentSummary["plots"];
}) {
  const [scale, setScale] = useState<AxisScale>("asinh");
  const option = useMemo(() => {
    const distributions = treatments.map((t) => {
      const daily = plots
        .filter((p) => p.treatmentId === t.id)
        .flatMap((p) =>
          p.daily.map((day) => ({
            value: day.mean,
            fluxId: p.points.find((v) => Math.abs(v.time - day.time) < 86400000)
              ?.fluxId,
          })),
        )
        .filter(
          (v) => Number.isFinite(v.value) && (scale !== "log" || v.value > 0),
        );
      const values = daily.map((v) => v.value);
      return {
        box: [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => quantile(values, p)),
        daily,
      };
    });
    return {
      grid: { left: 65, right: 20, top: 25, bottom: 80 },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        formatter: (p: {
          seriesType: string;
          value: number[];
          name: string;
        }) =>
          p.seriesType === "boxplot"
            ? p.name +
              "\n5%, Q1, median, Q3, 95%: " +
              p.value
                .slice(-5)
                .map((v) => fmt(inverse(v, scale), 1))
                .join(" / ")
            : "Flux #" + p.value[2] + ": " + fmt(inverse(p.value[1], scale), 1),
      },
      xAxis: {
        type: "category",
        data: treatments.map((t) => t.name),
        axisLabel: { rotate: 40, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { formatter: (v: number) => fmt(inverse(v, scale), 1) },
      },
      series: [
        {
          type: "boxplot",
          data: treatments.map((t, i) => ({
            value: distributions[i].box.map((v) => transformed(v, scale)),
            itemStyle: { color: t.colour + "55", borderColor: t.colour },
          })),
        },
        {
          type: "scatter",
          symbolSize: 4,
          data: distributions.flatMap(({ daily, box }, i) =>
            daily
              .filter((v) => v.value < box[0] || v.value > box[4])
              .map((v) => ({
                value: [i, transformed(v.value, scale), v.fluxId],
                itemStyle: { color: treatments[i].colour, opacity: 0.6 },
              })),
          ),
        },
      ],
    };
  }, [treatments, plots, scale]);
  return (
    <Panel
      title="Daily means · whiskers 5th–95th percentile"
      extra={
        <select
          aria-label="Distribution scale"
          value={scale}
          onChange={(e) => setScale(e.target.value as AxisScale)}
        >
          <option value="asinh">Symmetric log</option>
          <option value="linear">Linear</option>
          <option value="log">Log (positive)</option>
        </select>
      }
    >
      <Chart
        label="Daily means box plot"
        height={280}
        option={option}
        onClick={(p) => {
          const value = p.value as number[];
          if (p.seriesType === "scatter" && value?.[2])
            useStore.getState().openFlux(value[2]);
        }}
      />
    </Panel>
  );
});
