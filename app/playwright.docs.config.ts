import { defineConfig } from "@playwright/test";
// Regenerates the documentation screenshots in ../docs/images from the synthetic mock.
// Run with `npm run docs:screenshots`. Kept apart from `npm run smoke`.
export default defineConfig({
  testDir: "./tests/docs",
  testMatch: "**/*.docs.ts",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1500, height: 960 },
    colorScheme: "light",
  },
  webServer: {
    command: "npm run dev -- --mode mock",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
