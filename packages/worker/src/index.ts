// Cloudflare Worker entry — single Worker hosts:
//   - /api/*  : new D1-binding-backed routes (CF Access + Bearer token auth)
//   - /v1/*   : legacy API key + X-User-ID routes (for web_legacy bridge,
//                kept until we cut traffic over)
//   - all other paths fall through to the [assets] binding (SPA static files)

import type { AppEnv as ApiAppEnv } from "@otter/api/lib/app-env";
// New /api/* stack
import { createBindingDriver } from "@otter/api/lib/db/d1-binding";
import type { DbDriver } from "@otter/api/lib/db/driver";
import { accessAuth } from "@otter/api/middleware/access-auth";
import { createApiKeyAuth } from "@otter/api/middleware/api-key-auth";
import { createAuthCliRoute } from "@otter/api/routes/auth-cli";
import meRoute from "@otter/api/routes/me";
import { Hono } from "hono";
import { logger } from "hono/logger";
// Legacy /v1/* stack (untouched)
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { envGuardMiddleware } from "./middleware/env-guard.js";
import { createApiSnapshotsRoute, createApiWebhooksRoute } from "./routes/api-snapshots.js";
import { healthRoutes } from "./routes/health.js";
import { iconsRoutes } from "./routes/icons.js";
import { ingestRoutes } from "./routes/ingest.js";
import { snapshotsRoutes } from "./routes/snapshots.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import type { Env, Variables } from "./types.js";

// Legacy app — preserves /health, /ingest, /v1/* surface for web_legacy.
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

// New /api/* app — driver from D1 binding, auth via CF Access JWT or Bearer.
// biome-ignore lint/style/useNamingConvention: Hono generic key
type ApiBindings = Env & { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };
type CombinedEnv = ApiAppEnv & {
  // biome-ignore lint/style/useNamingConvention: Hono key
  Bindings: ApiBindings;
};
const apiApp = new Hono<CombinedEnv>();

apiApp.use("*", async (c, next) => {
  const driver: DbDriver = createBindingDriver(c.env.DB);
  c.set("driver", driver);
  await next();
});
apiApp.use("*", accessAuth);
apiApp.use(
  "*",
  createApiKeyAuth({
    getDriver: (c) => {
      const d = c.get("driver");
      if (!d) throw new Error("driver not initialized");
      return d;
    },
  }),
);

apiApp.get("/live", (c) => c.json({ ok: true }));
apiApp.route("/me", meRoute);
apiApp.route(
  "/auth/cli",
  createAuthCliRoute({
    getDriver: (c) => {
      const d = c.get("driver");
      if (!d) throw new Error("driver not initialized");
      return d;
    },
  }),
);
apiApp.route(
  "/snapshots",
  createApiSnapshotsRoute({
    getDriver: (c) => {
      const d = c.get("driver");
      if (!d) throw new Error("driver not initialized");
      return d;
    },
    getBucket: (c) => (c.env as ApiBindings).SNAPSHOTS,
  }),
);
apiApp.route(
  "/webhooks",
  createApiWebhooksRoute({
    getDriver: (c) => {
      const d = c.get("driver");
      if (!d) throw new Error("driver not initialized");
      return d;
    },
  }),
);

// Top-level dispatcher: /api/* → apiApp, everything else → legacyApp.
// biome-ignore lint/style/useNamingConvention: Hono generic key
const app = new Hono<{ Bindings: ApiBindings; Variables: Variables }>();
app.route("/api", apiApp);
app.all("*", (c) => legacyApp.fetch(c.req.raw, c.env, c.executionCtx));

export default app;
