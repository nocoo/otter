import { Hono } from "hono";
import live from "./routes/live.js";
import snapshots from "./routes/snapshots.js";
import webhooks from "./routes/webhooks.js";

export function createApp() {
  const app = new Hono();

  app.route("/v1/snapshots", snapshots);
  app.route("/v1/webhooks", webhooks);
  app.route("/v1/live", live);

  return app;
}

const app = createApp();
export default app;
