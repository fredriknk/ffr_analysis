import {
  BarChart,
  BoxplotChart,
  CustomChart,
  LineChart,
  ScatterChart,
} from "echarts/charts";
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import type { ECElementEvent, EChartsCoreOption } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { useStore } from "../../store";
echarts.use([
  LineChart,
  ScatterChart,
  BarChart,
  BoxplotChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  GraphicComponent,
  CanvasRenderer,
]);
export function Chart({
  option,
  height = 260,
  onClick,
  onReady,
  label,
}: {
  option: EChartsCoreOption;
  height?: number;
  onClick?: (p: ECElementEvent) => void;
  onReady?: (c: echarts.ECharts) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    theme = useStore((s) => s.theme);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, theme === "dark" ? "dark" : undefined);
    c.setOption({
      textStyle: {
        fontFamily: "Segoe UI, sans-serif",
        color: theme === "dark" ? "#aebfca" : "#526675",
      },
      backgroundColor: "transparent",
      ...option,
    });
    if (onClick) c.on("click", onClick);
    onReady?.(c);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, [option, theme, onClick, onReady]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      style={{ height, width: "100%", minWidth: 0 }}
    />
  );
}

export { echarts };
