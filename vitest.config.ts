import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "packages/web_legacy/src"),
    },
  },
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
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
        // New Vite SPA — tests deferred until business UI is ported (plan §12)
        "packages/web/**",
      ],
      thresholds: {
        statements: 90,
        branches: 86,
        functions: 90,
        lines: 90,
      },
    },
  },
});
