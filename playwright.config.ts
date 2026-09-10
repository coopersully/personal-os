import { defineConfig, devices } from "@playwright/test";

const e2eWebPort = process.env.ILO_E2E_WEB_PORT ?? "5174";
const e2eWebUrl = `http://127.0.0.1:${e2eWebPort}`;

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "e2e",
  timeout: 45_000,
  use: {
    baseURL: e2eWebUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec tsx e2e/serve.ts",
    reuseExistingServer: false,
    timeout: 120_000,
    url: e2eWebUrl,
  },
  workers: 1,
});
