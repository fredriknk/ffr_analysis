// Screenshots for docs/manual and README.md, taken from the synthetic mock (no real data).
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ECharts } from "echarts/core";
import { mkdirSync } from "node:fs";
type ChartElement = HTMLElement & { __ffrChart: ECharts };
const out = "../docs/images";

async function settle(page: Page) {
  // Let ECharts finish its entry animation.
  await page.waitForTimeout(700);
}
async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function crop(page: Page, el: Locator, name: string) {
  await settle(page);
  await el.screenshot({ path: `${out}/${name}.png` });
}
const panel = (page: Page, title: string) =>
  page
    .locator("section.panel")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const nav = (page: Page, name: string) =>
  page.locator("nav").getByRole("button", { name, exact: true }).click();

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

test("documentation screenshots", async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto("/");
  const demo = page.getByRole("button", { name: "Open demo project" });
  await expect(demo).toBeVisible({ timeout: 60000 });
  await shot(page, "start");

  // Legacy import wizard, scanned.
  await page.getByRole("button", { name: "Import legacy project →" }).click();
  await page.getByRole("button", { name: "Browse folder" }).click();
  await page.getByRole("button", { name: "Scan inputs" }).click();
  await expect(page.getByText(/robot files/)).toBeVisible();
  await crop(page, panel(page, "Import legacy project"), "legacy-import");
  await page.getByRole("button", { name: "Import legacy project →" }).click();

  // Review: a flux with valve-timing and spike findings.
  await demo.click();
  await expect(page.locator(".review-heading h2")).not.toHaveText(
    "Loading flux…",
  );
  await go(page, 1009);
  await shot(page, "review");
  await crop(page, page.locator(".compact-inspector"), "review-findings");
  await crop(page, page.locator(".trace-panel").first(), "review-valve-timing");
  await page.getByLabel("Toggle theme").click();
  await shot(page, "hero-review-dark");
  await page.getByLabel("Toggle theme").click();

  await page.getByRole("button", { name: /Contact sheet/ }).click();
  await expect(page.locator(".contact-card svg line").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "contact-sheet");
  await page.locator(".contact-card").first().click();

  await nav(page, "Outliers");
  await expect(
    page.getByRole("heading", { name: "Outlier hunting" }),
  ).toBeVisible();
  await shot(page, "outliers");
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
    await page.mouse.move(rect.x + rect.width * 0.55, rect.y + 30);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width - 30,
      rect.y + rect.height * 0.6,
      {
        steps: 8,
      },
    );
    await page.mouse.up();
  }
  await expect(
    page.getByRole("button", { name: "Review these →", exact: true }),
  ).toBeEnabled();
  await shot(page, "outliers-selection");

  await nav(page, "Treatments");
  await expect(
    page.getByRole("img", { name: "Shared date-range brush", exact: true }),
  ).toBeVisible();
  await shot(page, "treatments");
  await page
    .getByRole("img", { name: "Individual fluxes over time", exact: true })
    .scrollIntoViewIfNeeded();
  await shot(page, "treatments-detail");

  await nav(page, "Data");
  await expect(page.locator(".table-scroll tbody tr").first()).toBeVisible();
  await shot(page, "data");

  await nav(page, "External data");
  await expect(
    page.getByRole("heading", { name: "External data" }),
  ).toBeVisible();
  await shot(page, "external");
  await page.getByRole("button", { name: "Import series +" }).click();
  await page.getByRole("button", { name: "Browse file" }).click();
  await page.getByRole("button", { name: "Preview table" }).click();
  await expect(
    page.getByRole("button", { name: "Import mapped data" }),
  ).toBeVisible();
  await crop(page, panel(page, "Import time series"), "external-import");

  await nav(page, "Project");
  const plots = page.locator(".map-plot");
  await expect(plots.first()).toBeVisible();
  await plots.nth(14).click();
  await expect(page.getByLabel("Selected plot label")).toBeVisible();
  await shot(page, "project");

  await page.getByRole("button", { name: "Edit route" }).click();
  await expect(page.locator(".waypoint-glyph").first()).toBeVisible();
  await expect(page.locator(".proposal-plot").first()).toBeVisible();
  await shot(page, "waypoints");
});
