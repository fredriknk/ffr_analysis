import { useQuery } from "@tanstack/react-query";
import { memo, useMemo, useState } from "react";
import { api } from "../../api";
import type { SeriesData, SeriesMeta } from "../../api/types";
import { Empty, Panel, Status } from "../../shared/common";
import { seriesDisplay } from "../../shared/format";
import { useStore } from "../../store";
import { TimeChart, timeAxis, timeZoom, type DateBounds } from "./TimeChart";

const palette = [
  "#b56e33",
  "#6089c4",
  "#278c79",
  "#995a99",
  "#a1973f",
  "#c15356",
  "#427d9b",
];
const contextMerge = ["series", "grid", "xAxis", "yAxis"];
const noSeries: SeriesMeta[] = [];

function weatherKind(series: SeriesMeta) {
  if (series.key === "air_temperature") return "temperature";
  if (series.key === "sum(precipitation_amount PT1H)") return "precipitation";
}

function dailyWeather(
  series: SeriesData,
  day: (time: number) => string,
  sum: boolean,
) {
  const days = new Map<
    string,
    { time: number; total: number; count: number }
  >();
  for (const { time, value } of series.points) {
    const key = day(time);
    const entry = days.get(key);
    if (entry) {
      entry.time = Math.min(entry.time, time);
      entry.total += value;
      entry.count++;
    } else {
      days.set(key, { time, total: value, count: 1 });
    }
  }
  return [...days.values()].map(({ time, total, count }) => ({
    time,
    value: sum ? total : total / count,
  }));
}

export const EnvironmentalContext = memo(function EnvironmentalContext({
  meta = noSeries,
  loading,
  error,
  visible,
  bounds,
}: {
  meta?: SeriesMeta[];
  loading: boolean;
  error: Error | null;
  visible: boolean;
  bounds: DateBounds;
}) {
  const timeZone = useStore((s) => s.timeZone);
  const [hidden, setHidden] = useState<number[]>([]);
  const metadata = useMemo(
    () =>
      meta.map((m, i) => {
        const display = seriesDisplay(m);
        const kind = weatherKind(m);
        return {
          ...display,
          kind,
          name:
            kind === "temperature"
              ? "Daily mean air temperature"
              : kind === "precipitation"
                ? "Daily precipitation"
                : display.name,
          unit: kind === "precipitation" ? "mm" : display.unit,
          colour: palette[i % palette.length],
        };
      }),
    [meta],
  );
  const { min, max } = bounds;
  const result = useQuery({
    queryKey: [
      "treatments-context",
      metadata.map(({ id, kind, count }) => [id, kind, count]),
      min,
      max,
      timeZone,
    ],
    enabled: visible && metadata.length > 0,
    queryFn: async () => {
      const weather = metadata.filter((m) => m.kind);
      const other = metadata.filter((m) => !m.kind);
      const [rawWeather, sampled] = await Promise.all([
        weather.length
          ? api.getSeries(
              weather.map((m) => m.id),
              min,
              max,
              Math.max(...weather.map((m) => m.count)),
            )
          : [],
        other.length
          ? api.getSeries(
              other.map((m) => m.id),
              min,
              max,
              3000,
            )
          : [],
      ]);
      const day = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format;
      return [
        ...rawWeather.map((series) => ({
          id: series.id,
          points: dailyWeather(
            series,
            day,
            weather.some(
              (m) => m.id === series.id && m.kind === "precipitation",
            ),
          ),
        })),
        ...sampled,
      ];
    },
  });
  const active = useMemo(
    () => metadata.filter((m) => !hidden.includes(m.id)),
    [metadata, hidden],
  );
  const { option, height, hasPoints } = useMemo(() => {
    const data = new Map(
      result.data?.map((series) => [series.id, series.points]),
    );
    const units = [...new Set(active.map((m) => m.unit))];
    const rowHeight = 115;
    const xAxis = units.map((_, gridIndex) => ({
      ...timeAxis(bounds),
      gridIndex,
      axisLabel: { show: gridIndex === units.length - 1 },
    }));
    const series = active.map((m) => {
      const axis = units.indexOf(m.unit);
      const points = data.get(m.id) ?? [];
      return {
        id: String(m.id),
        name: m.name,
        type: m.kind === "precipitation" ? "bar" : "line",
        xAxisIndex: axis,
        yAxisIndex: axis,
        showSymbol: points.length === 1,
        barMaxWidth: 10,
        itemStyle: { color: m.colour },
        lineStyle: { color: m.colour, width: 1.5 },
        areaStyle: m.kind === "temperature" ? { opacity: 0.1 } : undefined,
        data: points.map(({ time, value }) => [time, value]),
      };
    });
    return {
      height: units.length * rowHeight + 20,
      hasPoints: series.some((s) => s.data.length > 0),
      option: {
        animation: false,
        grid: units.map((_, i) => ({
          left: 65,
          right: 30,
          top: 26 + i * rowHeight,
          height: rowHeight - 26,
        })),
        tooltip: { trigger: "axis", renderMode: "richText" },
        xAxis,
        yAxis: units.map((name, gridIndex) => ({
          type: "value",
          name,
          gridIndex,
          scale: !active.some(
            (m) => m.unit === name && m.kind === "precipitation",
          ),
          splitNumber: 2,
        })),
        dataZoom: timeZoom(xAxis.map((_, i) => i)),
        series,
      },
    };
  }, [active, bounds, result.data]);
  return (
    <Panel title="Environmental context">
      <Status
        loading={loading || result.isLoading}
        error={error ?? result.error}
      />
      {!loading && !error && !metadata.length && (
        <Empty>
          Import environmental series in External data to add context.
        </Empty>
      )}
      {metadata.length > 0 && (
        <div
          className="treatments-controls"
          role="group"
          aria-label="Environmental series"
        >
          {metadata.map(({ id, name, colour, unit }) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={!hidden.includes(id)}
                onChange={(e) => {
                  setHidden(
                    e.target.checked
                      ? hidden.filter((v) => v !== id)
                      : [...hidden, id],
                  );
                }}
              />
              <span className="dot" style={{ background: colour }} />
              {name}
              {unit && " (" + unit + ")"}
            </label>
          ))}
        </div>
      )}
      {metadata.length > 0 && !active.length && (
        <Empty>Select a series to show it here.</Empty>
      )}
      {active.length > 0 &&
        !result.isLoading &&
        !result.error &&
        !hasPoints && (
          <Empty>No enabled series have data in this date range.</Empty>
        )}
      {active.length > 0 && hasPoints && (
        <TimeChart
          label="External environmental data"
          height={height}
          option={option}
          replaceMerge={contextMerge}
        />
      )}
    </Panel>
  );
});
