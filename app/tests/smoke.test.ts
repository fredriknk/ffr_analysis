import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
async function chartPoint(page: Page, label: string) {
  const el = page.getByRole("img", { name: label, exact: true });
  await el.scrollIntoViewIfNeeded();
  return page.evaluate(async (label) => {
    const path = "/src/shared/charts/Chart.tsx",
      { echarts } = await import(path),
      el = document.querySelector(
        '[aria-label="' + label + '"]',
      ) as HTMLElement,
      c = echarts.getInstanceByDom(el),
      opt = c.getOption(),
      series = opt.series.findIndex(
        (s: { data?: unknown[] }) => s.data?.length,
      ),
      datum = opt.series[series].data[0],
      pixel = c.convertToPixel({ seriesIndex: series }, datum.value ?? datum),
      box = el.getBoundingClientRect();
    return { x: box.left + pixel[0], y: box.top + pixel[1] };
  }, label);
}
test("outlier hunting, attribution and linked review in both themes", async ({
  page,
}) => {
  test.setTimeout(240000);
  mkdirSync("screenshots", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open demo project" }),
  ).toBeVisible({ timeout: 60000 });
  const shot = async (name: string) => {
    await page.waitForTimeout(350);
    await page.screenshot({
      path: "screenshots/" + name + ".png",
      fullPage: true,
    });
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
  await expect(page.getByLabel("Quick filter")).toHaveValue("attention");
  await expect(page.getByLabel("Valve offset seconds")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "N2O residual strip" }),
  ).toBeVisible();
  await pair("review-triage");
  await page.getByRole("button", { name: /Contact sheet/ }).click();
  await expect(page.locator(".contact-card").first()).toBeVisible();
  await page
    .locator(".contact-card")
    .nth(0)
    .click({ modifiers: ["Control"] });
  await page
    .locator(".contact-card")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await expect(page.getByText(/2 selected/)).toBeVisible();
  await pair("contact-sheet");
  await page.keyboard.press("x");
  await page
    .getByRole("button", { name: "Include selected", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mark selected reviewed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page.locator(".contact-card").first().click();
  await expect(page.getByLabel("start seconds")).toBeVisible();
  await page.getByLabel("Quick filter").selectOption("all");
  await page.getByLabel("Queue sort").selectOption("time");
  async function go(id: number) {
    await page.locator(".review-heading h2").click();
    await page.keyboard.press("g");
    await page.getByLabel("Go to flux or date").fill(String(id));
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.locator(".review-heading")).toContainText("Flux #" + id);
  }
  await go(1);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".review-heading")).toContainText("Flux #2");
  await page.getByLabel("start seconds").fill("25");
  await page.getByLabel("start seconds").press("Enter");
  await page.getByLabel("start seconds").blur();
  const box = await page
    .getByRole("slider", { name: "N2O start handle", exact: true })
    .boundingBox();
  if (box) {
    await page.mouse.move(box.x + 7, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 25, box.y + 50, { steps: 4 });
    await page.mouse.up();
  }
  await page.locator(".review-heading h2").click();
  await page.keyboard.press("x");
  await expect(
    page.getByRole("button", { name: "Include flux", exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("button", { name: "Exclude flux", exact: false }),
  ).toBeVisible();
  await go(1009);
  await page.getByLabel("Offset scope").selectOption("file");
  await page.getByRole("button", { name: "Apply estimated offset" }).click();
  await expect(page.getByLabel("Valve offset seconds")).not.toHaveValue("0");
  await page.locator(".review-heading h2").click();
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Valve offset seconds")).toHaveValue("0");
  await page
    .locator(".results")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.getByPlaceholder("Add a note…")).toBeVisible();
  await page.locator(".results").evaluate((el) => (el.scrollTop = 0));
  await pair("review");
  await nav("Outliers");
  await expect(
    page.getByRole("heading", { name: "Outlier hunting" }),
  ).toBeVisible();
  await pair("outliers");
  // Activate the box tool, then drag over the actual plotted points.
  await page
    .getByRole("img", { name: "N₂O versus CO₂", exact: true })
    .scrollIntoViewIfNeeded();
  const rect = await page
    .getByRole("img", { name: "N₂O versus CO₂", exact: true })
    .boundingBox();
  await page.evaluate(async () => {
    const path = "/src/shared/charts/Chart.tsx",
      { echarts } = await import(path),
      el = document.querySelector(
        '[aria-label="N₂O versus CO₂"]',
      ) as HTMLElement;
    echarts.getInstanceByDom(el).dispatchAction({
      type: "takeGlobalCursor",
      key: "brush",
      brushOption: { brushType: "rect" },
    });
  });
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
  await expect(
    page.getByRole("button", { name: "← Back to Outliers" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Outliers" }).click();
  await expect(
    page.getByRole("button", { name: "Review these →", exact: true }),
  ).toBeEnabled();
  const point = await chartPoint(page, "Valve lag over time");
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("button", { name: "← Back to Outliers" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Outliers" }).click();
  await nav("Treatments");
  await pair("treatments");
  await page.evaluate(async () => {
    const path = "/src/shared/charts/Chart.tsx",
      { echarts } = await import(path),
      el = document.querySelector(
        '[aria-label="Shared date-range brush"]',
      ) as HTMLElement;
    echarts
      .getInstanceByDom(el)
      .dispatchAction({ type: "dataZoom", start: 20, end: 80 });
  });
  await expect(page.getByLabel("Summary from")).not.toHaveValue("");
  const from = await page.getByLabel("Summary from").inputValue();
  const p = await chartPoint(page, "Individual fluxes over time");
  await page.mouse.click(p.x, p.y);
  await expect(
    page.getByRole("button", { name: "← Back to Treatments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Treatments" }).click();
  await expect(page.getByLabel("Summary from")).toHaveValue(from);
  await nav("Data");
  const plot = page.getByLabel("Filter Plot", { exact: true });
  await page.locator("th").filter({ has: plot }).locator("summary").click();
  await plot.selectOption("P03");
  await page.locator("th").filter({ has: plot }).locator("summary").click();
  await pair("data");
  await page.getByRole("button", { name: "Review these", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "← Back to Data" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Data" }).click();
  await expect(plot).toHaveValues(["P03"]);
  await page.locator(".table-scroll tbody tr button.cell").first().click();
  await expect(
    page.getByRole("button", { name: "← Back to Data" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Data" }).click();
  await nav("External data");
  await pair("external");
  await nav("Project");
  await pair("project");
  expect(errors).toEqual([]);
});
test("empty projects and query failures stay usable", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "New project…" }).click();
  await expect(
    page.getByRole("heading", { name: "Project settings" }),
  ).toBeVisible();
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
  await expect(
    page.locator("nav").getByRole("button", { name: "Project", exact: true }),
  ).toBeEnabled();
});
test("manual flux links retain their imported values and treatment detail captures are current", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo project" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Treatments", exact: true })
    .click();
  await page
    .getByRole("img", { name: "Individual fluxes over time", exact: true })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "screenshots/treatments-detail-light.png" });
  await page.getByLabel("Toggle theme").click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "screenshots/treatments-detail-dark.png" });
  const manual = await page.evaluate(async () => {
    const path = "/src/api/index.ts",
      { api } = await import(path),
      table = await api.listFluxes(),
      i = table.data.source.findIndex((s: string) => s === "manual");
    return {
      id: Number(table.data.id[i]),
      value: Number(table.data.N2O_flux[i]),
    };
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "Data", exact: true })
    .click();
  const source = page.getByLabel("Filter Source", { exact: true });
  await page.locator("th").filter({ has: source }).locator("summary").click();
  await source.selectOption("manual");
  await page.locator("th").filter({ has: source }).locator("summary").click();
  // Sorting by ID makes this independent of campaign order.
  await page.getByRole("button", { name: "Flux ID", exact: true }).click();
  await page.getByRole("button", { name: "Flux ID", exact: true }).click();
  await page.locator(".table-scroll tbody tr button.cell").first().click();
  await expect(page.locator(".review-heading")).toContainText(
    "Flux #" + manual.id,
  );
  await expect(
    page.getByText("Manual measurement · no raw trace", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".results .big-number").first()).toHaveText(
    manual.value.toLocaleString("en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  );
  await page
    .locator("nav")
    .getByRole("button", { name: "External data", exact: true })
    .click();
  const deletes = page.getByRole("button", { name: /^Delete / });
  for (let remaining = await deletes.count(); remaining > 0; remaining--) {
    await deletes.first().click();
    await expect(deletes).toHaveCount(remaining - 1);
  }
  await expect(
    page.getByRole("img", { name: "External series preview", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "No series selected. Import or choose a series to preview it.",
    ),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("button", { name: "Outliers", exact: true })
    .click();
  const last = page.getByRole("img", {
    name: "Fluxes by treatment",
    exact: true,
  });
  await expect(last).toBeVisible();
  const bottom = await last.boundingBox();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 26,
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: "screenshots/outliers-dark.png" });
  await page.getByLabel("Toggle theme").click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "screenshots/outliers-light.png" });
});

// The preceding workflow tests the empty workspace; the manual workflow also checks deleting the last series.
