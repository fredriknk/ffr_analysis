import { expect,test } from "@playwright/test";
import { mkdirSync } from "node:fs";
test("complete synthetic workspace in both themes", async ({ page }) => {
  mkdirSync("screenshots", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open demo project" }),
  ).toBeVisible();
  async function shot(name: string) {
    await page.waitForTimeout(500);
    await page.screenshot({
      path: "screenshots/" + name + ".png",
      fullPage: true,
    });
  }
  await shot("start-light");
  await page.getByLabel("Toggle theme").click();
  await shot("start-dark");
  await page.getByLabel("Toggle theme").click();
  await page.getByRole("button", { name: "Open demo project" }).click();
  await expect(page.getByLabel("start seconds")).toHaveValue("10");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".review-heading")).toContainText("Flux #2");
  await page.getByLabel("start seconds").fill("25");
  await page.getByLabel("start seconds").press("Enter");
  await page.getByLabel("start seconds").blur();
  await expect(page.locator(".review-heading")).toContainText("Overridden");
  const handle = page.getByRole("slider", { name: "N2O start handle" });
  const box = await handle.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 7, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 35, box.y + 30, { steps: 5 });
    await page.mouse.up();
  }
  await page.locator("h2").filter({ hasText: "P02" }).click();
  await page.keyboard.press("x");
  await expect(
    page.getByRole("button", { name: "Include flux" }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("button", { name: "Exclude flux" }),
  ).toBeVisible();
  await shot("review-light");
  await page.getByLabel("Toggle theme").click();
  await shot("review-dark");
  await page.getByLabel("Toggle theme").click();
  const nav = (name: string) =>
    page.locator("nav").getByRole("button", { name, exact: true }).click();
  await nav("Treatments");
  await expect(
    page.getByText("Treatment comparison", { exact: true }),
  ).toBeVisible();
  await shot("treatments-light");
  await page.getByLabel("Toggle theme").click();
  await shot("treatments-dark");
  await page.getByLabel("Toggle theme").click();
  await page
    .getByRole("img", { name: "Individual fluxes over time", exact: true })
    .scrollIntoViewIfNeeded();
  await shot("treatments-detail-light");
  await page.getByLabel("Toggle theme").click();
  await shot("treatments-detail-dark");
  await page.getByLabel("Toggle theme").click();
  const point = await page.evaluate(async () => {
    const modulePath = "/src/shared/charts/Chart.tsx";
    const { echarts } = await import(modulePath);
    const element = document.querySelector(
      '[aria-label="Individual fluxes over time"]',
    ) as HTMLElement;
    const c = echarts.getInstanceByDom(element);
    const option = c.getOption(),
      first = option.series[0].data[0];
    const [x, y] = c.convertToPixel({ seriesIndex: 0 }, first);
    const box = element.getBoundingClientRect();
    return { x: box.left + x, y: box.top + y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("button", { name: "← Back to Treatments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Treatments" }).click();
  await expect(
    page.getByText("Treatment comparison", { exact: true }),
  ).toBeVisible();
  await nav("Data");
  await page.getByLabel("Filter plotLabel", { exact: true }).fill("P03");
  await expect(
    page.locator(".table-scroll tbody tr button.cell").first(),
  ).toBeVisible();
  await shot("data-light");
  await page.getByLabel("Toggle theme").click();
  await shot("data-dark");
  await page.getByLabel("Toggle theme").click();
  await page.locator(".table-scroll tbody tr button.cell").first().click();
  await expect(
    page.getByRole("button", { name: "← Back to Data" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Data" }).click();
  await expect(
    page.getByLabel("Filter plotLabel", { exact: true }),
  ).toHaveValue("P03");
  await nav("External data");
  await shot("external-light");
  await page.getByLabel("Toggle theme").click();
  await shot("external-dark");
  await page.getByLabel("Toggle theme").click();
  await nav("Project");
  await shot("project-light");
  await page.getByLabel("Toggle theme").click();
  await shot("project-dark");
  expect(errors).toEqual([]);
});
