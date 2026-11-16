import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.test.ts",
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1500, height: 960 },
  },
  webServer: {
    command: "npm run dev -- --mode mock",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
