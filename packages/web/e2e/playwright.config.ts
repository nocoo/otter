import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_SPA_PORT ?? 27019);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  reporter: process.env.CI ? "github" : [["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: "bun run scripts/run-e2e-spa.ts",
    cwd: REPO_ROOT,
    url: `${BASE_URL}/api/me`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { E2E_SPA_PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
