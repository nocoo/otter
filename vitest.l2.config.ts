import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    include: ["packages/**/e2e/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: ["./vitest.l2.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
