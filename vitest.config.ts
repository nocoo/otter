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
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/__tests__/e2e/**",
      "**/e2e/**",
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
        "**/hooks/**",
        "**/lib/palette.ts",
        "**/lib/utils.ts",
        "**/lib/version.ts",
        "**/auth.ts",
        "**/proxy.ts",
        "**/api/auth/**",
      ],
      thresholds: {
        statements: 90,
        branches: 89,
        functions: 90,
        lines: 90,
      },
    },
  },
});
