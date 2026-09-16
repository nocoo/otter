import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.toml" },
			miniflare: {
				bindings: {
					ENVIRONMENT: "test",
					D1_DATABASE_NAME: "otter-db-test",
					R2_BUCKET_NAME: "otter-snapshots-test",
					ICON_PREFIX: "apps/otter",
				},
			},
		}),
	],
	test: {
		globals: true,
	},
});
