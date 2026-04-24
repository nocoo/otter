import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "packages/web/src"),
    },
  },
  test: {
    globals: true,
    pool: "threads",
    poolOptions: {
      threads: {
        // isolate: true (default) keeps module/global state per test file so
        // vi.mock factories don't leak across files; threads pool still cuts
        // worker startup vs the default forks pool by ~50%.
        useAtomics: true,
      },
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/__tests__/e2e/**",
      "**/e2e/**",
      // Worker tests require @cloudflare/vitest-pool-workers, run separately
      "packages/worker/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/*.tsx",
        "**/index.ts",
        "**/bin.ts",
        "**/cli.ts",
        "**/types.ts",
        "**/lib/app-env.ts",
        "**/lib/db/driver.ts",
        "**/lib/r2.ts",
        // createApp() wiring factory — exercised by create-app.test.ts integration
        // suite, but v8 source-map mapping reports 0 functions on this file.
        "packages/api/src/app.ts",
        "**/hooks/**",
        "**/lib/palette.ts",
        "**/lib/utils.ts",
        "**/lib/version.ts",
        "**/auth.ts",
        "**/proxy.ts",
        "**/api/auth/**",
        // Worker has its own vitest config with cloudflare pool
        "packages/worker/**",
        // New Vite SPA UI components — covered via E2E later (plan §12)
        "packages/web/src/components/**",
        "packages/web/src/pages/**",
        "packages/web/src/AppShell.tsx",
        "packages/web/src/main.tsx",
        "packages/web/src/api.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 94,
        functions: 95,
        lines: 95,
      },
    },
  },
});
