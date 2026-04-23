import { serve } from "@hono/node-server";
import app from "./app.js";

const port = Number(process.env.PORT ?? 7020);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[api] listening on http://${hostname}:${info.port}`);
});
