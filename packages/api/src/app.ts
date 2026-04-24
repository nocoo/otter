// createApp — single Hono factory used by every consumer:
//   - new worker:  createApp({ basePath: "/api", driver, bucket, auth: { access: true } })
//                  → mounts /live, /me, /auth/cli, /snapshots, /webhooks at basePath
//                  with driver/bucket injection + accessAuth + apiKeyAuth middleware.
//   - legacy /v1/* surface (worker-client based) is always mounted for any
//     remaining HTTP-D1 consumers.
//
// Keeping every wiring decision in one place means docs, tests and the runtime
// share a single source of truth — there is no longer a hand-assembled api app
// inside the worker.

import { type Context, Hono } from "hono";
import type { AppEnv } from "./lib/app-env";
import type { DbDriver } from "./lib/db/driver";
import type { R2BucketLike } from "./lib/r2";
import { accessAuth } from "./middleware/access-auth";
import { createApiKeyAuth } from "./middleware/api-key-auth";
import { createApiSnapshotsRoute } from "./routes/api-snapshots";
import { createApiWebhooksRoute } from "./routes/api-webhooks";
import { createAuthCliRoute } from "./routes/auth-cli";
import live from "./routes/live";
import meRoute from "./routes/me";
import legacySnapshots from "./routes/snapshots";
import legacyWebhooks from "./routes/webhooks";

export interface CreateAppOptions {
  /** Mount prefix for the new D1-binding routes. Defaults to "/api". */
  basePath?: string;
  /** D1 driver injected into context for new /api/* routes. */
  driver?: DbDriver;
  /** R2 bucket for snapshot bodies. Required when mounting /api/snapshots. */
  bucket?: R2BucketLike;
  /** Auth toggles. */
  auth?: {
    /** Enable Cloudflare Access JWT verification. Default false. */
    access?: boolean;
    /** Enable Bearer token (api_tokens) verification. Default true when driver present. */
    bearer?: boolean;
  };
}

export function createApp(opts: CreateAppOptions = {}) {
  const app = new Hono<AppEnv>();

  // Always mount the legacy /v1/* surface (kept for any non-binding HTTP-D1
  // consumers; the new worker only routes /api/* through the binding stack).
  app.route("/v1/snapshots", legacySnapshots);
  app.route("/v1/webhooks", legacyWebhooks);
  app.route("/v1/live", live);

  // The new D1-binding-backed surface only mounts when a driver is supplied.
  if (opts.driver) {
    const basePath = opts.basePath ?? "/api";
    const driver = opts.driver;
    const apiApp = new Hono<AppEnv>();

    apiApp.use("*", async (c, next) => {
      c.set("driver", driver);
      await next();
    });

    if (opts.auth?.access ?? false) {
      apiApp.use("*", accessAuth);
    }
    if (opts.auth?.bearer ?? true) {
      apiApp.use("*", createApiKeyAuth({ getDriver: () => driver }));
    }

    apiApp.get("/live", (c) => c.json({ ok: true }));
    apiApp.route("/me", meRoute);
    apiApp.route("/auth/cli", createAuthCliRoute({ getDriver: () => driver }));
    apiApp.route("/webhooks", createApiWebhooksRoute({ getDriver: () => driver }));

    if (opts.bucket) {
      const bucket = opts.bucket;
      apiApp.route(
        "/snapshots",
        createApiSnapshotsRoute({
          getDriver: () => driver,
          getBucket: () => bucket,
        }),
      );
    }

    app.route(basePath, apiApp);
  }

  return app;
}

// Re-export so worker callers can build their own context shapes if needed.
export type { Context };
