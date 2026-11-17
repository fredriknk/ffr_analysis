import {
  BarChart,
  BoxplotChart,
  CustomChart,
  LineChart,
  ScatterChart,
} from "echarts/charts";
import {
  BrushComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  ToolboxComponent,
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
  BrushComponent,
  ToolboxComponent,
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
  group,
}: {
  option: EChartsCoreOption;
  height?: number | string;
  onClick?: (p: ECElementEvent) => void;
  onReady?: (c: echarts.ECharts) => void;
  label: string;
  group?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    instance = useRef<echarts.ECharts>(),
    click = useRef(onClick),
    theme = useStore((s) => s.theme);
  click.current = onClick;
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, theme === "dark" ? "dark" : undefined);
    instance.current = c;
    Object.defineProperty(ref.current, "__ffrChart", {
      value: c,
      configurable: true,
    });
    if (group) {
      c.group = group;
      echarts.connect(group);
    }
    c.on("click", (p) => click.current?.(p));
    const ro = new ResizeObserver(() => {
      if (ref.current?.clientWidth) c.resize();
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      instance.current = undefined;
    };
  }, [theme, group]);
  useEffect(() => {
    const c = instance.current;
    if (!c) return;
    c.setOption(
      {
        textStyle: {
          fontFamily: "Segoe UI, sans-serif",
          color: theme === "dark" ? "#aebfca" : "#526675",
        },
        backgroundColor: "transparent",
        ...option,
      },
      { replaceMerge: ["series"] },
    );
    c.off("brushselected");
    c.off("brushEnd");
    c.off("datazoom");
    onReady?.(c);
  }, [option, onReady, theme, group]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      style={{ height, width: "100%", minWidth: 0, minHeight: 0 }}
    />
  );
}
export { echarts };
