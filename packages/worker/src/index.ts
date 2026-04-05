import { Hono } from "hono";
import { logger } from "hono/logger";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { envGuardMiddleware } from "./middleware/env-guard.js";
import { healthRoutes } from "./routes/health.js";
import type { Env, Variables } from "./types.js";

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use("*", envGuardMiddleware);
app.use("*", logger());

// Public routes
app.route("/health", healthRoutes);

// Protected routes (API key required)
app.use("/v1/*", apiKeyMiddleware);
// TODO: Add routes in Phase 2-4
// app.route("/v1/snapshots", snapshotRoutes);
// app.route("/v1/webhooks", webhookRoutes);
// app.route("/v1/analytics", analyticsRoutes);

// Ingest routes (token-based auth in route handler)
// TODO: Add in Phase 2
// app.route("/ingest", ingestRoutes);

export default app;
