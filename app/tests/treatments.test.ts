import { expect, test, type Page } from "@playwright/test";
import type { ECharts } from "echarts/core";
import type { FfrApi } from "../src/api/types";

type ChartElement = HTMLElement & { __ffrChart: ECharts };

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo project" }).click();
}

test("individual flux zoom keeps chart options stable and links the time axes", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Treatments", exact: true }).click();
  const flux = page.getByRole("img", { name: "Individual fluxes over time" });
  const curves = page.getByRole("img", { name: "Cumulative plot curves" });
  const context = page.getByRole("img", {
    name: "External environmental data",
  });
  await expect(flux).toBeVisible();
  await expect(curves).toBeVisible();
  await expect(context).toBeVisible();
  const measurement = await flux.evaluate(async (el) => {
    const source = (el as ChartElement).__ffrChart;
    const charts = Array.from(
      el.closest(".page")!.querySelectorAll<ChartElement>("[role=img]"),
    ).filter((node) => node.__ffrChart);
    const calls = charts.map((node) => ({
      chart: node.getAttribute("aria-label"),
      updates: 0,
      zooms: 0,
    }));
    for (const [i, node] of charts.entries()) {
      const instance = node.__ffrChart;
      const setOption = instance.setOption.bind(instance);
      instance.setOption = (...args) => {
        calls[i].updates++;
        return setOption(...args);
      };
      const dispatchAction = instance.dispatchAction.bind(instance);
      instance.dispatchAction = (...args) => {
        if (args[0].type === "dataZoom") calls[i].zooms++;
        return dispatchAction(...args);
      };
    }
    const start = performance.now();
    for (let i = 1; i <= 8; i++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          source.dispatchAction({
            type: "dataZoom",
            start: i * 3,
            end: 100 - i * 3,
          });
          resolve();
        }),
      );
    }
    const gestureMs = Math.round(performance.now() - start);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { calls, gestureMs };
  });
  console.log("Treatments zoom measurement", measurement);
  expect(measurement.calls.filter((chart) => chart.updates)).toEqual([]);
  expect(
    measurement.calls
      .filter((chart) => chart.zooms)
      .map(({ chart, zooms }) => [chart, zooms]),
  ).toEqual([
    ["Cumulative plot curves", 1],
    ["Individual fluxes over time", 8],
    ["External environmental data", 1],
  ]);
  const zoom = (el: HTMLElement) =>
    (
      (el as ChartElement).__ffrChart.getOption() as {
        dataZoom: { startValue: number; endValue: number }[];
      }
    ).dataZoom.map(({ startValue, endValue }) => [startValue, endValue]);
  const range = await flux.evaluate(zoom);
  await expect.poll(() => curves.evaluate(zoom)).toEqual(range);
  expect(await context.evaluate(zoom)).toEqual(range);
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(() => flux.evaluate(zoom)).not.toEqual(range);
  await expect
    .poll(async () => curves.evaluate(zoom))
    .toEqual(await flux.evaluate(zoom));
});

test("cumulative totals, field map and environmental controls use the selected data", async ({
  page,
}) => {
  await openDemo(page);
  await page.evaluate(async () => {
    const module = "/src/api/index.ts";
    const { api } = (await import(module)) as { api: FfrApi };
    const summary = api.treatmentSummary;
    api.treatmentSummary = async (q) => {
      const result = await summary(q);
      const first = result.treatments[0];
      return first
        ? {
            ...result,
            treatments: [
              { ...first, mean: -3, sd: 2 },
              ...result.treatments.slice(1),
            ],
          }
        : result;
    };
  });
  await page.getByRole("button", { name: "Treatments", exact: true }).click();
  const totals = page.getByRole("img", { name: "Treatment cumulative totals" });
  await expect(totals).toBeVisible();
  const whiskers = await totals.evaluate((el) => {
    const chart = (el as ChartElement).__ffrChart;
    const {
      series: [bar, sd],
    } = chart.getOption() as {
      series: { z: number; data: number[][] }[];
    };
    const ends = sd.data[0];
    const list = chart.getZr().storage.getDisplayList(true);
    const capsInFront = ends.slice(1).map((value) => {
      const [x, y] = chart.convertToPixel({ seriesIndex: 1 }, [0, value]);
      return (
        chart.containPixel({ gridIndex: 0 }, [x, y]) &&
        list.some((element) => {
          if (element.type !== "line" || element.z <= bar.z) return false;
          const { shape } = element as typeof element & {
            shape: { x1: number; y1: number; x2: number; y2: number };
          };
          return (
            shape.x1 === x - 5 &&
            shape.x2 === x + 5 &&
            shape.y1 === y &&
            shape.y2 === y
          );
        })
      );
    });
    return { ends, capsInFront };
  });
  expect(whiskers).toEqual({ ends: [0, -5, -1], capsInFront: [true, true] });
  await page.getByRole("checkbox", { name: "Show each plot" }).check();
  const series = (el: HTMLElement) =>
    (
      (el as ChartElement).__ffrChart.getOption() as {
        series: ({
          type: string;
          name: string;
          data: { name?: string }[];
        } | null)[];
      }
    ).series.filter((s) => s !== null);
  expect((await totals.evaluate(series)).map((s) => s.data[0].name)).toEqual([
    "P01",
    "P02",
    "P03",
  ]);
  await page.getByRole("checkbox", { name: "Show each plot" }).uncheck();
  expect((await totals.evaluate(series)).map((s) => s.type)).toEqual([
    "bar",
    "custom",
  ]);

  const context = page.getByRole("img", {
    name: "External environmental data",
  });
  await expect(context).toBeVisible();
  const soil = page.getByRole("checkbox", { name: /^Soil moisture/ });
  expect(
    (await context.evaluate(series)).some(
      (s) => s.name === "Soil moisture" && s.data.length > 0,
    ),
  ).toBe(true);
  await soil.uncheck();
  expect(
    (await context.evaluate(series)).some((s) => s.name === "Soil moisture"),
  ).toBe(false);
  await soil.check();
  expect(
    (await context.evaluate(series)).some((s) => s.name === "Soil moisture"),
  ).toBe(true);

  const map = page.getByRole("img", { name: "Treatment plot map" });
  const plot = map.locator('[data-plot-id="1"] polygon');
  await expect(plot).toBeVisible();
  const originalFill = await plot.getAttribute("fill");
  await page.getByLabel("Colour by").selectOption("emission");
  await expect(plot).not.toHaveAttribute("fill", originalFill!);
  await plot.click();
  await expect(page.getByLabel("Map plot")).toHaveValue("1");
  await page.getByRole("button", { name: /^Review \d+ fluxes$/ }).click();
  await page.getByRole("button", { name: "← Back to Treatments" }).click();
  await expect(page.getByLabel("Map plot")).toHaveValue("1");
  await page.getByLabel("Summary from").fill("2027-01-01");
  await expect(plot).toHaveAttribute("fill", "#808e95");
  await expect(
    page.getByRole("button", { name: /^Review \d+ fluxes$/ }),
  ).toHaveCount(0);
});
