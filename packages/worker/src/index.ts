// Cloudflare Worker entry — single Worker hosts:
//   - /api/*  : new D1-binding-backed routes (CF Access + Bearer token auth)
//   - /v1/*   : legacy API key + X-User-ID routes (kept for any remaining
//                HTTP-D1 consumers; not currently wired to the SPA)
//   - all other paths fall through to the [assets] binding (SPA static files)
//
// All /api/* wiring lives in @otter/api's createApp(); this file only injects
// CF bindings (D1 + R2) and preserves the legacy /v1/* + /ingest/* + /health
// stack.

import { createApp } from "@otter/api";
import { createBindingDriver } from "@otter/api/lib/db/d1-binding";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { envGuardMiddleware } from "./middleware/env-guard.js";
import { healthRoutes } from "./routes/health.js";
import { iconsRoutes } from "./routes/icons.js";
import { ingestRoutes } from "./routes/ingest.js";
import { snapshotsRoutes } from "./routes/snapshots.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import type { Env, Variables } from "./types.js";

// Legacy app — preserves /health, /ingest, /v1/* surface.
// biome-ignore lint/style/useNamingConvention: Hono generic key
const legacyApp = new Hono<{ Bindings: Env; Variables: Variables }>();
legacyApp.use("*", envGuardMiddleware);
legacyApp.use("*", logger());
legacyApp.route("/health", healthRoutes);
legacyApp.route("/ingest", ingestRoutes);
legacyApp.route("/ingest", iconsRoutes);
legacyApp.use("/v1/*", apiKeyMiddleware);
legacyApp.route("/v1/snapshots", snapshotsRoutes);
legacyApp.route("/v1/webhooks", webhooksRoutes);

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
