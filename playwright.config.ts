import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const localBaseUrl = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  outputDir: "test-results/playwright",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["json", { outputFile: "test-results/browser-results.json" }], ["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    // An ignored, origin-scoped protection cookie can authenticate hosted verification.
    storageState: process.env.PLAYWRIGHT_STORAGE_STATE,
    trace: externalBaseUrl ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
        // Fixed screenshot fixtures use classic scrollbar metrics for native select arrows.
        launchOptions: { args: ["--disable-features=OverlayScrollbar"] },
      },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run preview:test",
        url: localBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
