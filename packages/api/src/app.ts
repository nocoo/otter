import { Hono } from "hono";
import live from "./routes/live";
import snapshots from "./routes/snapshots";
import webhooks from "./routes/webhooks";

export function createApp() {
  const app = new Hono();

  app.route("/v1/snapshots", snapshots);
  app.route("/v1/webhooks", webhooks);
  app.route("/v1/live", live);

  return app;
}
