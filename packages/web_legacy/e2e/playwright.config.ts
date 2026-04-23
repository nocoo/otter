import { defineConfig, devices } from "@playwright/test";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27019";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }]],
  timeout: 30_000,

  use: {
    baseURL: `http://localhost:${E2E_UI_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
