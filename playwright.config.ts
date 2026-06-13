import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.BDD_PORT ?? 27019);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/bdd",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? "github" : [["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: `bun run --cwd packages/web dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
