import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import type { ECharts } from "echarts/core";
type ChartElement = HTMLElement & { __ffrChart: ECharts };
async function chartPoint(page: Page, label: string) {
  const el = page.getByRole("img", { name: label, exact: true });
  await expect(el).toBeVisible();
  await page.waitForTimeout(400);
  await el.scrollIntoViewIfNeeded();
  return el.evaluate((element) => {
    const c = (element as ChartElement).__ffrChart;
    const opt = c.getOption() as {
      series: { type: string; data: { value?: number[] } | number[][] }[];
    };
    for (const s of opt.series) {
      if (s.type !== "scatter" || !Array.isArray(s.data)) continue;
      for (const datum of s.data) {
        const value = Array.isArray(datum)
          ? datum
          : (datum as { value: number[] }).value;
        if (!value?.[2]) continue;
        const pixel = c.convertToPixel(
          { xAxisIndex: 0, yAxisIndex: 0 },
          value.slice(0, 2),
        );
        if (c.containPixel({ gridIndex: 0 }, pixel)) {
          const box = element.getBoundingClientRect();
          return { x: box.left + pixel[0], y: box.top + pixel[1] };
        }
      }
    }
    throw Error(
      "No visible scatter point in " + element.getAttribute("aria-label"),
    );
  });
}
async function quick(page: Page, value: string) {
  const filter = page.locator(".queue-toolbar .filter-menu").first();
  await filter.locator("summary").click();
  await page.getByLabel("Quick filter").selectOption(value);
  await filter.locator("summary").click();
}
async function go(page: Page, id: number) {
  await page.locator(".review-heading h2").click();
  await page.keyboard.press("g");
  await page.getByLabel("Go to flux or date").fill(String(id));
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    String(id),
  );
}
test("triage, stable selection, lazy contact sheet, linked charts and all screens", async ({
  page,
}) => {
  test.setTimeout(240000);
  mkdirSync("screenshots", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open demo project" }),
  ).toBeVisible({ timeout: 60000 });
  const shot = async (name: string) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  };
  const pair = async (name: string) => {
    await shot(name + "-light");
    await page.getByLabel("Toggle theme").click();
    await shot(name + "-dark");
    await page.getByLabel("Toggle theme").click();
  };
  const nav = (name: string) =>
    page.locator("nav").getByRole("button", { name, exact: true }).click();
  await pair("start");
  await page.getByRole("button", { name: "Open demo project" }).click();
  await expect(page.locator(".review-heading h2")).not.toHaveText(
    "Loading flux…",
  );
  await expect(page.getByLabel("Valve offset seconds")).toBeVisible();
  await pair("review-triage");
  await page.setViewportSize({ width: 1366, height: 768 });
  const dimensions = await page
    .locator(".review-main,.compact-inspector")
    .evaluateAll((els) =>
      els.map((el) => ({ h: el.clientHeight, scroll: el.scrollHeight })),
    );
  expect(dimensions.every((d) => d.scroll <= d.h + 3)).toBe(true);
  await pair("review-1366");
  expect(
    await page.locator(".triage-row:visible").count(),
  ).toBeGreaterThanOrEqual(20);
  await page.setViewportSize({ width: 1500, height: 960 });
  await quick(page, "all");
  await page.getByLabel("Queue sort").selectOption("time");
  await page.evaluate(async () => {
    const path = "/src/api/index.ts",
      { api } = await import(path);
    await api.setFluxFlags([1, 2], { reviewed: false, excluded: false });
  });
  await go(page, 1);
  // Slow only the next uncached detail: the previous header and chart must remain.
  await page.evaluate(async () => {
    const path = "/src/api/index.ts",
      { api } = await import(path),
      original = api.getFluxDetail;
    api.getFluxDetail = async (id: number) => {
      await new Promise((r) => setTimeout(r, 350));
      return original(id);
    };
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    "1",
  );
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    "2",
  );
  await page.keyboard.press("x");
  await expect(page.locator(".excluded-banner")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".excluded-banner")).toHaveCount(0);
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    "2",
  );
  await page.keyboard.press("a");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/api/index.ts",
          { api } = await import(path);
        return [
          (await api.getFluxDetail(1)).flux.reviewed,
          (await api.getFluxDetail(2)).flux.reviewed,
        ];
      }),
    )
    .toEqual([false, true]);
  // A change that removes the item from its filter must not select the first queue item.
  await go(page, 1009);
  await quick(page, "unreviewed");
  await page.getByLabel("Queue sort").selectOption("attention");
  await page
    .getByRole("button", { name: "Exclude flux", exact: false })
    .click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    "1009",
  );
  await page.getByLabel("start seconds").fill("25");
  await page.getByLabel("start seconds").press("Enter");
  await page.getByLabel("start seconds").blur();
  const handle = page.getByRole("slider", {
    name: "N2O start handle",
    exact: true,
  });
  const h = await handle.boundingBox();
  if (h) {
    await page.mouse.move(h.x + 4, h.y + 30);
    await page.mouse.down();
    await page.mouse.move(h.x + 20, h.y + 30, { steps: 4 });
    await page.mouse.up();
  }
  await pair("review");
  // Slow thumbnails deliberately: loading never masquerades as validation failure.
  await page.evaluate(async () => {
    const path = "/src/api/index.ts",
      { api } = await import(path),
      original = api.getFluxThumbs;
    (window as unknown as { thumbCalls: number[][] }).thumbCalls = [];
    api.getFluxThumbs = async (
      ids: number[],
      gas: "N2O" | "CO2",
      maxPoints?: number,
    ) => {
      (window as unknown as { thumbCalls: number[][] }).thumbCalls.push(ids);
      await new Promise((r) => setTimeout(r, 900));
      return original(ids, gas, maxPoints);
    };
  });
  await page.getByRole("button", { name: /Contact sheet/ }).click();
  await expect(
    page.getByRole("status", { name: "Loading trace" }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("No trace returned / validation failed"),
  ).toHaveCount(0);
  await expect(page.locator(".contact-card svg line").first()).toBeVisible();
  const calls = await page.evaluate(
    () => (window as unknown as { thumbCalls: number[][] }).thumbCalls,
  );
  expect(calls.every((ids) => ids.length <= 8)).toBe(true);
  expect(calls.flat().length).toBeLessThan(100);
  await pair("contact-sheet");
  await page
    .locator(".contact-card")
    .nth(0)
    .click({ modifiers: ["Control"] });
  await page
    .locator(".contact-card")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await expect(page.getByText(/2 selected/)).toBeVisible();
  await page
    .getByRole("button", { name: "Mark selected reviewed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page.locator(".contact-card").first().click();
  await nav("Outliers");
  await expect(
    page.getByRole("heading", { name: "Outlier hunting" }),
  ).toBeVisible();
  await pair("outliers");
  const scatter = page.getByRole("img", {
    name: "N₂O versus CO₂",
    exact: true,
  });
  await scatter.evaluate((el) =>
    (el as ChartElement).__ffrChart.dispatchAction({
      type: "takeGlobalCursor",
      key: "brush",
      brushOption: { brushType: "rect", brushMode: "single" },
    }),
  );
  const rect = await scatter.boundingBox();
  if (rect) {
    await page.mouse.move(rect.x + 80, rect.y + 40);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 35, rect.y + rect.height - 60, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect(
    page.getByRole("button", { name: "Review these →", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review these →", exact: true })
    .click();
  await page.getByRole("button", { name: "← Back to Outliers" }).click();
  await expect(
    page.getByRole("button", { name: "Review these →", exact: true }),
  ).toBeEnabled();
  const point = await chartPoint(page, "Valve lag over time");
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "← Back to Outliers" }).click();
  await nav("Treatments");
  await pair("treatments");
  await page
    .getByRole("img", { name: "Shared date-range brush", exact: true })
    .evaluate((el) =>
      (el as ChartElement).__ffrChart.dispatchAction({
        type: "dataZoom",
        start: 20,
        end: 80,
      }),
    );
  await expect(page.getByLabel("Summary from")).not.toHaveValue("");
  const from = await page.getByLabel("Summary from").inputValue();
  const p = await chartPoint(page, "Individual fluxes over time");
  await page.mouse.click(p.x, p.y);
  await page.getByRole("button", { name: "← Back to Treatments" }).click();
  await expect(page.getByLabel("Summary from")).toHaveValue(from);
  await pair("treatments-detail");
  await nav("Data");
  const plot = page.getByLabel("Filter Plot", { exact: true });
  await page.locator("th").filter({ has: plot }).locator("summary").click();
  await plot.selectOption("P03");
  await page.locator("th").filter({ has: plot }).locator("summary").click();
  await pair("data");
  await expect(
    page.getByRole("button", { name: "N2O_flux", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Review these", exact: true }).click();
  await page.getByRole("button", { name: "← Back to Data" }).click();
  await expect(plot).toHaveValues(["P03"]);
  await page.locator(".table-scroll tbody button.cell").first().click();
  await page.getByRole("button", { name: "← Back to Data" }).click();
  await nav("External data");
  await pair("external");
  await nav("Project");
  await pair("project");
  expect(errors).toEqual([]);
});
test("empty project and API error states stay usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project…" }).click();
  await expect(page.getByText(/No field layout yet/)).toBeVisible();
  const nav = (name: string) =>
    page.locator("nav").getByRole("button", { name, exact: true }).click();
  await nav("Review");
  await expect(
    page.getByText(
      "No measurements yet. Import robot or manual data to begin.",
    ),
  ).toBeVisible();
  await nav("Treatments");
  await expect(page.getByText(/No weather series/)).toBeVisible();
  await nav("Data");
  await expect(
    page.getByText("No rows match. Clear filters to see all measurements."),
  ).toBeVisible();
  await nav("External data");
  await expect(
    page.getByText("No series yet. Import a logger or fetch weather."),
  ).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/api/index.ts",
      { api } = await import(path);
    api.listSeries = async () => {
      throw { code: "CONNECTION", message: "Synthetic connection failure" };
    };
  });
  await page.getByRole("button", { name: "↶ Undo", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Synthetic connection failure" }),
  ).toBeVisible({ timeout: 10000 });
});
