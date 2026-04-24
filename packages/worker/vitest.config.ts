import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ENVIRONMENT: "test",
            D1_DATABASE_NAME: "otter-db-test",
            R2_BUCKET_NAME: "otter-snapshots-test",
            ICON_PREFIX: "apps/otter",
          },
        },
      },
    },
  },
});
