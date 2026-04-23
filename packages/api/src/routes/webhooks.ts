import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
  WorkerError,
} from "../lib/worker-client.js";
import { type AuthUser, authMiddleware } from "../middleware/auth.js";

// biome-ignore lint/style/useNamingConvention: Hono requires `Variables` key
const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use("*", authMiddleware);

app.get("/", async (c) => {
  const user = c.get("user");
  try {
    const result = await listWebhooks(user.id);
    return c.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error("GET /v1/webhooks Worker error:", err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("GET /v1/webhooks failed:", err);
    return c.json({ error: "Failed to fetch webhooks" }, 500);
  }
});

app.post("/", async (c) => {
  const user = c.get("user");

  const options: { label?: string } = {};
  try {
    const body = (await c.req.json()) as { label?: unknown };
    if (body.label && typeof body.label === "string") {
      options.label = body.label.trim().slice(0, 100);
    }
  } catch {
    // Empty body is fine, use default label
  }

  try {
    const result = await createWebhook(user.id, options);
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error("POST /v1/webhooks Worker error:", err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("POST /v1/webhooks failed:", err);
    return c.json({ error: "Failed to create webhook" }, 500);
  }
});

app.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  let body: { label?: unknown; isActive?: unknown };
  try {
    body = (await c.req.json()) as { label?: unknown; isActive?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const data: { label?: string; isActive?: boolean } = {};
  if (typeof body.label === "string") {
    data.label = body.label.trim().slice(0, 100);
  }
  if (typeof body.isActive === "boolean") {
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  try {
    const result = await updateWebhook(user.id, id, data);
    return c.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`PATCH /v1/webhooks/${id} Worker error:`, err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error(`PATCH /v1/webhooks/${id} failed:`, err);
    return c.json({ error: "Failed to update webhook" }, 500);
  }
});

app.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  try {
    const result = await deleteWebhook(user.id, id);
    return c.json(result);
  } catch (err) {
    if (err instanceof WorkerError) {
      console.error(`DELETE /v1/webhooks/${id} Worker error:`, err.status, err.body);
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error(`DELETE /v1/webhooks/${id} failed:`, err);
    return c.json({ error: "Failed to delete webhook" }, 500);
  }
});

export default app;
