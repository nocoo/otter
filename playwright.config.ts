import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/bdd",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:27019",
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: "bun scripts/run-e2e-spa.ts",
    url: "http://127.0.0.1:27019/api/me",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
    timeout: 60_000,
  },
});
