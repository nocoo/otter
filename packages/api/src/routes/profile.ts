import { Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import { publicAvatar } from "../lib/public-avatar";

const app = new Hono<AppEnv>();
app.get("/", async (c) => {
  const email = c.get("accessEmail");
  if (!email) return c.json({ error: "Unauthorized" }, 401);
  c.header("Cache-Control", "no-store");
  return c.json({ avatar: await publicAvatar(email) });
});
export default app;
