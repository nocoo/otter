import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { deleteSnapshot, getSnapshot, listSnapshots, WorkerError } from "../lib/worker-client.js";
import { type AuthUser, authMiddleware } from "../middleware/auth.js";

// biome-ignore lint/style/useNamingConvention: Hono requires `Variables` key
const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use("*", authMiddleware);

app.get("/", async (c) => {
  const user = c.get("user");
  const limitParam = c.req.query("limit");
  const beforeParam = c.req.query("before");

  const options: { limit?: number; before?: number } = {};
  if (limitParam) options.limit = Number.parseInt(limitParam, 10);
  if (beforeParam) options.before = Number.parseInt(beforeParam, 10);

  try {
    const result = await listSnapshots(user.id, options);
    return c.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error("GET /v1/snapshots Worker error:", err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("GET /v1/snapshots failed:", err);
    return c.json({ error: "Failed to fetch snapshots" }, 500);
  }
});

app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  try {
    const result = await getSnapshot(user.id, id);
    return c.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`GET /v1/snapshots/${id} Worker error:`, err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error(`GET /v1/snapshots/${id} failed:`, err);
    return c.json({ error: "Failed to fetch snapshot" }, 500);
  }
});

app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  try {
    const result = await deleteSnapshot(user.id, id);
    return c.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`DELETE /v1/snapshots/${id} Worker error:`, err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error(`DELETE /v1/snapshots/${id} failed:`, err);
    return c.json({ error: "Failed to delete snapshot" }, 500);
  }
});

export default app;
