/* global window, document, MutationObserver, requestAnimationFrame */
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { spawn, execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 30000 });
const source = process.env.FFR_REAL_PROJECT;
if (!source) {
  console.log(
    "Skipped real smoke: set FFR_REAL_PROJECT to an existing project.",
  );
  process.exit(0);
}
const root = fileURLToPath(new URL("../../", import.meta.url)),
  out = join(
    root,
    "local",
    "real-smoke-" + new Date().toISOString().replace(/[:.]/g, "-"),
  );
await mkdir(out, { recursive: true });
const project = join(out, "capture-work.ffr");
await copyFile(resolve(source), project);
const report = {
  projectSource: resolve(source),
  screens: [],
  timings: {},
  exports: [],
  consoleErrors: [],
  backendDifferences: [],
  legacy: {},
};
let browser, child, page;
const stamp = async (page, name) => {
  await page.waitForTimeout(200);
  const path = join(out, name + ".png");
  await page.screenshot({ path });
  report.screens.push(path);
};
try {
  child = spawn(
    join(root, "app", "src-tauri", "target", "release", "ffr-analyzer.exe"),
    [],
    {
      windowsHide: true,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9334",
      },
    },
  );
  for (let i = 0; i < 80; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9334");
      break;
    } catch {
      await delay(500);
    }
  }
  if (!browser) throw Error("WebView2 CDP did not start on port 9334");
  const context = browser.contexts()[0];
  page = context.pages()[0];
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.consoleErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1500, height: 950 });
  const invoke = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  let started = performance.now();
  const info = await invoke("project_open", { path: project });
  report.timings.projectOpenMs = performance.now() - started;
  report.counts = info.counts;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Make sense of every measurement." }),
  ).toBeVisible();
  await stamp(page, "start");
  const nav = (name) =>
    page.locator("nav").getByRole("button", { name, exact: true }).click();
  const table = await invoke("list_fluxes"),
    layout = await invoke("get_layout");
  report.layout = {
    plots: layout.plots.length,
    treatments: layout.treatments.length,
  };
  const chronological = table.data.id
    .map((id, i) => ({
      id,
      time: table.data.time[i],
      source: table.data.source[i],
    }))
    .filter((r) => r.source === "robot")
    .sort((a, b) => a.time - b.time || a.id - b.id);
  const first = chronological[0].id,
    second = chronological[1].id;
  await invoke("set_flux_flags", {
    fluxIds: [first, second],
    flags: { reviewed: false, excluded: false },
  });
  await page.reload();
  started = performance.now();
  await nav("Review");
  await expect(page.getByLabel("Valve offset seconds")).toBeVisible({
    timeout: 60000,
  });
  report.timings.reviewReadyMs = performance.now() - started;
  const filters = page.locator(".queue-toolbar .filter-menu").first();
  await filters.locator("summary").click();
  await page.getByLabel("Quick filter").selectOption("all");
  await filters.locator("summary").click();
  await page.getByLabel("Queue sort").selectOption("time");
  async function go(id) {
    await page.locator(".review-heading h2").click();
    await page.keyboard.press("g");
    await page.getByLabel("Go to flux or date").fill(String(id));
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.locator(".review-heading")).toHaveAttribute(
      "data-flux-id",
      String(id),
    );
    await expect(page.getByLabel("Go to flux or date")).toHaveCount(0);
  }
  await go(first);
  await expect(page.getByLabel("Go to flux or date")).toHaveCount(0);
  await page.locator(".review-heading h2").click();
  started = performance.now();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    String(second),
  );
  report.timings.keyboardStepMs = performance.now() - started;
  await page.keyboard.press("x");
  await expect(page.locator(".excluded-banner")).toBeVisible();
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    String(second),
  );
  await page.keyboard.press("Control+z");
  await expect(page.locator(".excluded-banner")).toHaveCount(0);
  await expect(page.locator(".review-heading")).toHaveAttribute(
    "data-flux-id",
    String(second),
  );
  await page.keyboard.press("a");
  await expect
    .poll(
      async () =>
        (await invoke("get_flux_detail", { fluxId: second })).flux.reviewed,
    )
    .toBe(true);
  if ((await invoke("get_flux_detail", { fluxId: first })).flux.reviewed)
    throw Error(
      "A marked the first flux after undo instead of the displayed second flux",
    );
  await go(second);
  await stamp(page, "review-1500");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  await stamp(page, "review-1366");
  report.reviewLayout = await page
    .locator(".review-main,.compact-inspector")
    .evaluateAll((elements) =>
      elements.map((el) => ({
        class: el.className,
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
      })),
    );
  if (report.reviewLayout.some((el) => el.scrollHeight > el.height + 3))
    throw Error("Review centre or inspector needs scrolling at 1366×768");
  const sample = await invoke("get_flux_detail", { fluxId: second });
  report.detailKeys = Object.keys(sample);
  if (!sample.robust)
    report.backendDifferences.push(
      "FluxDetail.robust absent; robust/impact controls were tested using their optional-field fallback.",
    );
  if (!("N2O_lagS" in sample.flux))
    report.backendDifferences.push("FluxTable/FluxRow N2O_lagS absent.");
  report.rawLabels = table.columns.filter((c) => c.label === c.key).length;
  if (report.rawLabels)
    report.backendDifferences.push(
      report.rawLabels +
        " ColumnMeta labels are raw keys; UI fallback labels were used.",
    );
  const detailTimes = [];
  for (const id of chronological.slice(2, 7).map((r) => r.id)) {
    started = performance.now();
    await invoke("get_flux_detail", { fluxId: id });
    detailTimes.push(performance.now() - started);
  }
  report.timings.detailRequestsMs = detailTimes;
  await page.getByRole("button", { name: /Contact sheet/ }).click();
  await expect(page.locator(".contact-card").first()).toBeVisible();
  started = performance.now();
  await expect(page.locator(".contact-card svg line").first()).toBeVisible({
    timeout: 60000,
  });
  report.timings.firstThumbnailBatchMs = performance.now() - started;
  await stamp(page, "contact-sheet");
  await page.setViewportSize({ width: 1500, height: 950 });
  await nav("Outliers");
  await page.waitForTimeout(500);
  started = performance.now();
  const rules = await invoke("diagnostics_summary");
  report.timings.diagnosticsSummaryMs = performance.now() - started;
  report.diagnosticRules = rules.map((r) => ({ code: r.code, count: r.count }));
  await stamp(page, "outliers");
  await page.evaluate(() => {
    window.__ffrBrushSamples = [];
    window.addEventListener("ffr-brush-latency", (event) =>
      window.__ffrBrushSamples.push(event.detail),
    );
  });
  const scatter = page.getByRole("img", {
      name: "N₂O versus CO₂",
      exact: true,
    }),
    box = await scatter.boundingBox();
  // Activate ECharts' public brush action, then draw through actual pointer events.
  await scatter.evaluate((el) =>
    el.__ffrChart.dispatchAction({
      type: "takeGlobalCursor",
      key: "brush",
      brushOption: { brushType: "rect", brushMode: "single" },
    }),
  );
  started = performance.now();
  await page.mouse.move(box.x + 85, box.y + 48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 38, box.y + box.height - 55, {
    steps: 8,
  });
  const released = performance.now();
  await page.mouse.up();
  await expect(page.getByTestId("outlier-selection")).not.toHaveText(
    "0 selected",
    { timeout: 15000 },
  );
  report.timings.brushAfterReleaseMs = performance.now() - released;
  report.timings.brushGestureMs = performance.now() - started;
  report.brushSamples = await page.evaluate(() => window.__ffrBrushSamples);
  await page
    .getByRole("button", { name: "Review these →", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "← Back to Outliers" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to Outliers" }).click();
  await nav("Treatments");
  await page.waitForTimeout(300);
  const brush = page.getByRole("img", {
    name: "Shared date-range brush",
    exact: true,
  });
  await brush.scrollIntoViewIfNeeded();
  const overviewBox = await brush.boundingBox();
  await page.mouse.move(
    overviewBox.x + 65,
    overviewBox.y + overviewBox.height - 12,
  );
  await page.mouse.down();
  await page.mouse.move(
    overviewBox.x + overviewBox.width * 0.22,
    overviewBox.y + overviewBox.height - 12,
    { steps: 6 },
  );
  await page.mouse.up();
  const from = await page.getByLabel("Summary from").inputValue();
  report.treatmentFrom = from;
  const fluxChart = page.getByRole("img", {
    name: "Individual fluxes over time",
    exact: true,
  });
  await fluxChart.scrollIntoViewIfNeeded();
  // Public ECharts coordinates identify a real datum; the navigation itself uses a canvas click.
  const target = await fluxChart.evaluate((el) => {
    const c = el.__ffrChart,
      option = c.getOption();
    for (const series of option.series) {
      if (series.type !== "scatter") continue;
      for (const point of series.data ?? []) {
        const value = point.value ?? point;
        if (!Array.isArray(value) || !value[2]) continue;
        const pixel = c.convertToPixel(
          { xAxisIndex: 0, yAxisIndex: 0 },
          value.slice(0, 2),
        );
        if (c.containPixel({ gridIndex: 0 }, pixel))
          return { pixel, id: value[2] };
      }
    }
    return null;
  });
  if (!target) throw Error("No visible treatment scatter point");
  report.treatmentClickedFlux = target.id;
  const pointBox = await fluxChart.boundingBox();
  await page.mouse.click(
    pointBox.x + target.pixel[0],
    pointBox.y + target.pixel[1],
  );
  await expect(
    page.getByRole("button", { name: "\u2190 Back to Treatments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "\u2190 Back to Treatments" }).click();
  await expect(page.getByLabel("Summary from")).toHaveValue(from);
  await stamp(page, "treatments");
  await nav("Data");
  await expect(
    page.locator(".table-scroll tbody button.cell").first(),
  ).toBeVisible();
  await stamp(page, "data");
  const columns = await page
    .locator("th[data-column-key]")
    .evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-column-key")),
    );
  if (!columns.includes("id") || !columns.includes("time"))
    throw Error("Pinned ID/time columns missing");
  await page.getByRole("button", { name: "Export data ↗" }).click();
  await expect(page.getByRole("dialog", { name: "Export data" })).toBeVisible();
  const ids = table.data.id;
  const counts = new Map(),
    dayCounts = new Map(),
    dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: info.timeZone });
  ids.forEach((_, i) => {
    const plot = String(table.data.plotId[i]);
    counts.set(plot, (counts.get(plot) ?? 0) + 1);
    dayCounts.set(plot + "|" + dayFormat.format(table.data.time[i]), true);
  });
  const inspect = (path) =>
    JSON.parse(
      execFileSync(
        "python",
        [
          "-c",
          'import openpyxl,json,sys; w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True); print(json.dumps([{"name":s.title,"rows":s.max_row-1,"columns":s.max_column,"headers":[c.value for c in next(s.iter_rows())]} for s in w]))',
          path,
        ],
        { encoding: "utf8" },
      ),
    );
  for (const mode of ["flat", "sheetPerPlot", "dailyPerPlot"]) {
    await page.getByLabel("Workbook layout").selectOption(mode);
    const path = join(out, mode + ".xlsx");
    started = performance.now();
    await invoke("export_xlsx", {
      args: { path, fluxIds: ids, columns, mode },
    });
    const sheets = inspect(path),
      expectedRows = mode === "dailyPerPlot" ? dayCounts.size : ids.length;
    if (sheets.reduce((sum, s) => sum + s.rows, 0) !== expectedRows)
      throw Error(mode + " workbook row count mismatch");
    if (mode !== "flat" && sheets.length !== counts.size)
      throw Error(mode + " plot-sheet count mismatch");
    for (const sheet of sheets) {
      if (!columns.every((c) => sheet.headers.includes(c)))
        throw Error(mode + " export columns mismatch");
    }
    report.exports.push({
      mode,
      path,
      bytes: (await stat(path)).size,
      sheets,
      expectedRows,
      milliseconds: performance.now() - started,
    });
  }
  const csv = join(out, "flat.csv");
  await invoke("export_csv", { args: { path: csv, fluxIds: ids, columns } });
  const csvShape = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        'import csv,json,sys; r=list(csv.reader(open(sys.argv[1],encoding="utf-8-sig",newline="")));print(json.dumps({"rows":len(r)-1,"headers":r[0]}))',
        csv,
      ],
      { encoding: "utf8" },
    ),
  );
  if (
    csvShape.rows !== ids.length ||
    columns.join("|") !== csvShape.headers.join("|")
  )
    throw Error("CSV dimensions mismatch");
  report.exports.push({ mode: "csv", path: csv, ...csvShape });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await nav("External data");
  await stamp(page, "external");
  report.series = await invoke("list_series");
  await nav("Project");
  await stamp(page, "project");
  const historyText = await page.locator(".history-row").allTextContents();
  if (historyText.some((text) => text.length > 2000))
    throw Error("History is rendering a large payload");
  await nav("Start");
  await page.getByRole("button", { name: /Import legacy project/ }).click();
  const legacyDir =
    process.env.FFR_CAPTURE_LEGACY ||
    String.raw`C:\Users\fnk\PycharmProjects\ffr_analysis_new_ai\Users\Capture`;
  const rawDir =
    process.env.FFR_CAPTURE_RAW ||
    String.raw`C:\Users\fnk\OneDrive - Norwegian University of Life Sciences\1-Prosjekter\2022-FFR\Resultater\raw_data - Trygve Fredriksen's files`;
  await page.getByLabel("Legacy folder", { exact: true }).fill(legacyDir);
  await page.getByRole("button", { name: "Scan inputs" }).click();
  await expect(
    page.getByRole("button", { name: "Import project", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  report.legacy.scan = await invoke("legacy_scan", { dir: legacyDir });
  report.legacy.prefilled = {
    raw: await page.getByLabel("Raw data folder", { exact: true }).inputValue(),
    manual: await page.getByLabel("Manual flux file (optional)").inputValue(),
    logger: await page.getByLabel("Logger file (optional)").inputValue(),
  };
  await page.getByLabel("Raw data folder", { exact: true }).fill(rawDir);
  await page
    .getByLabel("Output project", { exact: true })
    .fill(join(out, "legacy-import.ffr"));
  await stamp(page, "legacy-scan");
  await page.evaluate(() => {
    window.__ffrImportProgress = [];
    window.__ffrFrames = 0;
    const tick = () => {
      window.__ffrFrames++;
      window.__ffrFrame = requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new MutationObserver(() => {
      const text = document.querySelector(".operation-progress")?.textContent;
      if (text && window.__ffrImportProgress.at(-1) !== text)
        window.__ffrImportProgress.push(text);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  started = performance.now();
  await page
    .getByRole("button", { name: "Import project", exact: true })
    .click();
  await expect(page.locator(".operation-progress")).toBeVisible({
    timeout: 15000,
  });
  await stamp(page, "legacy-progress");
  await expect(page.locator(".review-heading")).toBeVisible({
    timeout: 180000,
  });
  report.timings.legacyImportMs = performance.now() - started;
  report.legacy.imported = await invoke("project_info");
  report.legacy.responsiveness = await page.evaluate(() => ({
    frames: window.__ffrFrames,
    progress: window.__ffrImportProgress,
  }));
  if (
    !report.legacy.responsiveness.progress.length ||
    report.legacy.responsiveness.frames < 20
  )
    throw Error("Legacy import did not show progress or allow rendering");
  await stamp(page, "legacy-complete");
  if (report.consoleErrors.length)
    throw Error("Console errors: " + report.consoleErrors.join("; "));
  report.ok = true;
} catch (error) {
  report.ok = false;
  if (page) {
    await page.screenshot({ path: join(out, "failure.png") });
    report.failureState = await page.evaluate(() => ({
      focus: document.activeElement?.outerHTML.slice(0, 500),
      heading: document.querySelector(".review-heading")?.textContent,
    }));
  }
  report.error = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      ok: report.ok,
      output: out,
      counts: report.counts,
      timings: report.timings,
      backendDifferences: report.backendDifferences,
      error: report.error,
    }),
  );
  await browser?.close();
  child?.kill();
}
