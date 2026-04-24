// Cloudflare Worker entry — single Worker hosts:
//   - /api/*  : D1-binding-backed routes (CF Access + Bearer token auth)
//   - /ingest : webhook-token snapshot/icon ingest (CLI uploads)
//   - /health : public probe
//   - all other paths fall through to the [assets] binding (SPA static files)
//
// All /api/* wiring lives in @otter/api's createApp(); this file only injects
// CF bindings (D1 + R2) and keeps the legacy /ingest/* + /health stack the CLI
// still depends on.

import { createApp } from "@otter/api";
import { createBindingDriver } from "@otter/api/lib/db/d1-binding";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { envGuardMiddleware } from "./middleware/env-guard.js";
import { healthRoutes } from "./routes/health.js";
import { iconsRoutes } from "./routes/icons.js";
import { ingestRoutes } from "./routes/ingest.js";
import type { Env, Variables } from "./types.js";

// Legacy app — preserves /health and /ingest for CLI uploads.
// biome-ignore lint/style/useNamingConvention: Hono generic key
const legacyApp = new Hono<{ Bindings: Env; Variables: Variables }>();
legacyApp.use("*", envGuardMiddleware);
legacyApp.use("*", logger());
legacyApp.route("/health", healthRoutes);
legacyApp.route("/ingest", ingestRoutes);
legacyApp.route("/ingest", iconsRoutes);

// Top-level dispatcher: /api/* via @otter/api createApp, everything else
// → legacyApp.
// biome-ignore lint/style/useNamingConvention: Hono generic key
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.all("/api/*", (c) => {
  const driver = createBindingDriver(c.env.DB);
  const apiApp = createApp({
    basePath: "/api",
    driver,
    bucket: c.env.SNAPSHOTS,
    auth: { access: true, bearer: true },
  });
  return apiApp.fetch(c.req.raw, c.env, c.executionCtx);
});

app.all("*", (c) => legacyApp.fetch(c.req.raw, c.env, c.executionCtx));

export default app;
