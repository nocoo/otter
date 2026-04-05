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

// biome-ignore lint/style/useNamingConvention: Hono generic parameter names
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use("*", envGuardMiddleware);
app.use("*", logger());

// Public routes
app.route("/health", healthRoutes);

// Ingest routes (token-based auth in route handler)
app.route("/ingest", ingestRoutes);
app.route("/ingest", iconsRoutes);

// Protected routes (API key required)
app.use("/v1/*", apiKeyMiddleware);
app.route("/v1/snapshots", snapshotsRoutes);
app.route("/v1/webhooks", webhooksRoutes);
// TODO: Add analytics routes in Phase 4
// app.route("/v1/analytics", analyticsRoutes);

export default app;
