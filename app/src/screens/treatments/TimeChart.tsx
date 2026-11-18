import type { ECharts, EChartsCoreOption } from "echarts/core";
import { memo, useCallback, useEffect, useRef } from "react";
import { Chart } from "../../shared/charts/Chart";
import { useStore } from "../../store";

export type DateBounds = { min?: number; max?: number };
type Zoom = ReturnType<typeof useStore.getState>["treatmentZoom"];

export function timeAxis(bounds: DateBounds) {
  return { type: "time", ...bounds };
}

export function timeZoom(xAxisIndex: number[] = [0], filterMode = "none") {
  return [{ type: "inside", xAxisIndex, start: 0, end: 100, filterMode }];
}

function applyZoom(chart: ECharts, zoom: Zoom) {
  chart.dispatchAction(
    {
      type: "dataZoom",
      ...(zoom
        ? { startValue: zoom[0], endValue: zoom[1] }
        : { start: 0, end: 100 }),
    },
    { silent: true },
  );
}

export const TimeChart = memo(function TimeChart({
  label,
  option,
  height,
  onClick,
  replaceMerge,
}: {
  label: string;
  option: EChartsCoreOption;
  height?: number;
  onClick?: React.ComponentProps<typeof Chart>["onClick"];
  replaceMerge?: string[];
}) {
  const chart = useRef<ECharts>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const ownZoom = useRef<Zoom>(null);

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.from !== previous.from || state.to !== previous.to) {
        clearTimeout(timer.current);
      }
      if (
        state.treatmentZoom === previous.treatmentZoom ||
        (state.treatmentZoom === ownZoom.current &&
          state.treatmentZoom !== null)
      )
        return;
      clearTimeout(timer.current);
      if (chart.current && !chart.current.isDisposed()) {
        applyZoom(chart.current, state.treatmentZoom);
      }
    });
    return () => {
      clearTimeout(timer.current);
      unsubscribe();
    };
  }, []);

  const ready = useCallback((instance: ECharts) => {
    clearTimeout(timer.current);
    chart.current = instance;
    const saved = useStore.getState().treatmentZoom;
    if (saved) applyZoom(instance, saved);
    instance.on("datazoom", () => {
      clearTimeout(timer.current);
      // The active chart handles each input event. Read its range and update
      // the linked charts only after the gesture pauses.
      timer.current = setTimeout(() => {
        if (instance.isDisposed()) return;
        const { dataZoom } = instance.getOption() as {
          dataZoom: { startValue?: number; endValue?: number }[];
        };
        const { startValue, endValue } = dataZoom[0];
        if (startValue === undefined || endValue === undefined) return;
        const current = useStore.getState().treatmentZoom;
        if (current?.[0] === startValue && current[1] === endValue) return;
        const zoom: Zoom = [startValue, endValue];
        ownZoom.current = zoom;
        useStore.setState({ treatmentZoom: zoom });
      }, 150);
    });
  }, []);

  return (
    <Chart
      label={label}
      option={option}
      height={height}
      onReady={ready}
      onClick={onClick}
      replaceMerge={replaceMerge}
    />
  );
});
