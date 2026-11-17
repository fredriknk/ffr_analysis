import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, join } from "node:path";
import process from "node:process";
import console from "node:console";
const source = process.env.FFR_REAL_PROJECT;
if (!source) {
  console.log("Skipped startup smoke: FFR_REAL_PROJECT unset");
  process.exit(0);
}
const out = resolve("../local/startup-smoke");
await mkdir(out, { recursive: true });
const project = join(out, "launch.ffr");
await copyFile(source, project);
const exe = resolve("src-tauri/target/release/ffr-analyzer.exe");
async function launch(path, fail) {
  const child = spawn(exe, [path], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9334",
    },
  });
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        browser = await chromium.connectOverCDP("http://127.0.0.1:9334");
        break;
      } catch {
        await delay(500);
      }
    }
    if (!browser) throw Error("CDP unavailable");
    const page = browser.contexts()[0].pages()[0],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (e.type() === "error") errors.push(e.text());
    });
    if (fail) {
      await expect(page.getByRole("alert")).toContainText(
        "Could not open the startup project",
        { timeout: 60000 },
      );
      await expect(
        page.getByRole("heading", { name: "Make sense of every measurement." }),
      ).toBeVisible();
    } else {
      await expect(page.getByLabel("Valve offset seconds")).toBeVisible({
        timeout: 120000,
      });
      await expect(page.getByLabel("Queue sort")).toHaveValue("attention");
      await expect(page.getByLabel("Quick filter")).toHaveValue("attention");
    }
    expect(errors).toEqual([]);
    await page.screenshot({
      path: join(out, fail ? "error.png" : "opened.png"),
    });
    return { ok: true, mode: fail ? "corrupt" : "valid" };
  } finally {
    await browser?.close();
    child.kill();
    await delay(1000);
  }
}
const results = [await launch(project, false)];
const corrupt = join(out, "corrupt.ffr");
await writeFile(corrupt, "synthetic invalid database");
results.push(await launch(corrupt, true));
await writeFile(join(out, "report.json"), JSON.stringify(results, null, 2));
console.log(results);
