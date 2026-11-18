import type { CustomSeriesOption } from "echarts/charts";
import { memo, useMemo, useState } from "react";
import type { TreatmentSummary } from "../../api/types";
import { Chart } from "../../shared/charts/Chart";
import { Panel } from "../../shared/common";
import { unit } from "../../shared/format";
import { useStore } from "../../store";

type Treatments = TreatmentSummary["treatments"];
type Plots = TreatmentSummary["plots"];

export const TotalChart = memo(function TotalChart({
  treatments,
  plots,
  cumulativeUnit,
}: {
  treatments: Treatments;
  plots: Plots;
  cumulativeUnit: string;
}) {
  const [individual, setIndividual] = useState(false);
  const theme = useStore((s) => s.theme);
  const option = useMemo(() => {
    const colour = theme === "dark" ? "#f0f4f6" : "#172128";
    const renderWhisker: NonNullable<CustomSeriesOption["renderItem"]> = (
      _params,
      api,
    ) => {
      const low = api.coord([api.value(0), api.value(1)]);
      const high = api.coord([api.value(0), api.value(2)]);
      const line = (x1: number, y1: number, x2: number, y2: number) => ({
        type: "line" as const,
        shape: { x1, y1, x2, y2 },
        style: { stroke: colour, lineWidth: 2 },
      });
      return {
        type: "group",
        children: [
          line(low[0], low[1], high[0], high[1]),
          ...[low, high].map(([x, y]) => line(x - 5, y, x + 5, y)),
        ],
      };
    };

    const byTreatment = treatments.map((t) =>
      plots.filter((p) => p.treatmentId === t.id),
    );
    const series = individual
      ? Array.from(
          { length: Math.max(0, ...byTreatment.map((group) => group.length)) },
          (_, i) => ({
            id: "replicate-" + i,
            type: "bar",
            barMaxWidth: 24,
            data: byTreatment.map((group, j) => {
              const plot = group[i];
              return plot
                ? {
                    name: plot.label,
                    value: plot.total,
                    itemStyle: { color: treatments[j].colour },
                  }
                : null;
            }),
          }),
        )
      : [
          {
            id: "mean",
            type: "bar",
            z: 2,
            barMaxWidth: 34,
            data: treatments.map((t) => ({
              value: t.mean,
              itemStyle: { color: t.colour },
            })),
          },
          {
            id: "sd",
            name: "Mean ± SD",
            type: "custom",
            z: 5,
            silent: true,
            encode: { x: 0, y: [1, 2], tooltip: [1, 2] },
            data: treatments.map((t, i) => [i, t.mean - t.sd, t.mean + t.sd]),
            renderItem: renderWhisker,
          },
        ];
    return {
      grid: { left: 65, right: 20, top: 25, bottom: 80 },
      tooltip: {
        trigger: individual ? "item" : "axis",
        renderMode: "richText",
      },
      xAxis: {
        type: "category",
        data: treatments.map((t) => t.name),
        axisLabel: { rotate: 40, fontSize: 10 },
      },
      yAxis: { type: "value", name: unit(cumulativeUnit) },
      series,
    };
  }, [treatments, plots, individual, cumulativeUnit, theme]);

  return (
    <Panel
      title="Cumulative total by treatment"
      extra={
        <div className="treatments-controls">
          <small>
            {unit(cumulativeUnit)}
            {individual ? "" : " · mean ± population SD"}
          </small>
          <label>
            <input
              type="checkbox"
              checked={individual}
              onChange={(e) => setIndividual(e.target.checked)}
            />
            Show each plot
          </label>
        </div>
      }
    >
      <Chart
        label="Treatment cumulative totals"
        height={280}
        option={option}
        onClick={({ dataIndex }) => {
          if (dataIndex != null)
            useStore.setState({ focus: treatments[dataIndex]?.id ?? null });
        }}
      />
    </Panel>
  );
});
