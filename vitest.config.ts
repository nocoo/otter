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
    pool: "vmThreads",
    poolOptions: {
      vmThreads: {
        // vmThreads runs each test file in a node:vm context inside a thread:
        // ~15% faster than the threads pool while keeping per-file isolation
        // (vi.mock factories don't leak across files).
        useAtomics: true,
        // Default on macOS is hw.ncpu/2 (=8 on a 16-core box). Bumping to 12
        // squeezes ~30ms out of file collection without contending too hard
        // with the parallel pre-commit typecheck stage.
        maxThreads: 12,
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
      // experimentalAstAwareRemapping intentionally omitted — enabling it on vitest 3.x
      // causes coverage variance that drops functions below the 95% threshold.
      // Re-evaluate when upgrading to vitest v4 (where AST remapping is the default).
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        // Test files themselves
        "**/*.test.ts",
        // Type declarations — no runtime code
        "**/*.d.ts",
        // React components — covered via E2E
        "**/*.tsx",
        // Module entry points — mostly barrel re-exports; files with
        // significant logic (e.g. Worker app wiring, collector registry) are
        // covered via integration tests.
        "**/index.ts",
        // CLI entry points — exercised manually / via integration scripts
        "**/bin.ts",
        "**/cli.ts",
        // Pure type modules
        "**/types.ts",
        // Environment / infra glue — exercised by integration tests
        "**/lib/app-env.ts",
        "**/lib/db/driver.ts",
        "**/lib/r2.ts",
        // createApp() wiring factory — exercised by create-app.test.ts integration
        // suite, but v8 source-map mapping reports 0 functions on this file.
        "packages/api/src/app.ts",
        // React hooks — covered via E2E with the SPA
        "**/hooks/**",
        // Trivial helpers / constants
        "**/lib/palette.ts",
        "**/lib/utils.ts",
        "**/lib/version.ts",
        // Auth surface — covered by integration / E2E flows
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
