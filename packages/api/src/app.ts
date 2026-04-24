// createApp — single Hono factory used by every consumer:
//   - new worker:  createApp({ basePath: "/api", driver, bucket, auth: { access: true } })
//                  → mounts /live, /me, /auth/cli, /snapshots, /webhooks at basePath
//                  with driver/bucket injection + accessAuth + apiKeyAuth middleware.
//   - /v1/live is always mounted as a public health probe.
//
// Keeping every wiring decision in one place means docs, tests and the runtime
// share a single source of truth — there is no longer a hand-assembled api app
// inside the worker.

import { type Context, Hono } from "hono";
import type { AppEnv } from "./lib/app-env";
import type { DbDriver } from "./lib/db/driver";
import type { R2BucketLike } from "./lib/r2";
import { APP_VERSION } from "./lib/version";
import { accessAuth } from "./middleware/access-auth";
import { createApiKeyAuth } from "./middleware/api-key-auth";
import { createApiSnapshotsRoute } from "./routes/api-snapshots";
import { createApiWebhooksRoute } from "./routes/api-webhooks";
import { createAuthCliRoute } from "./routes/auth-cli";
import live from "./routes/live";
import meRoute from "./routes/me";

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

  // /v1/live is always mounted as a public health probe (no driver needed —
  // it short-circuits to a static OK response when the http D1 client errors).
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

    apiApp.get("/live", (c) => c.json({ ok: true, version: APP_VERSION }));
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
