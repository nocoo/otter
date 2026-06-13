import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/bdd",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  use: {
    baseURL: "http://localhost:27019",
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: "bun run --cwd packages/web dev -- --port 27019",
    port: 27019,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
