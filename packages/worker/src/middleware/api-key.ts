import type { Context, Next } from "hono";
import type { Env, Variables } from "../types.js";

/**
 * API Key 验证中间件
 *
 * 验证 X-API-Key header 并提取 X-User-ID
 * 仅用于 /v1/* 受保护路由
 */
export async function apiKeyMiddleware(
  // biome-ignore lint/style/useNamingConvention: Hono generic parameter names
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<Response | undefined> {
  const apiKey = c.req.header("X-API-Key");
  if (apiKey !== c.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = c.req.header("X-User-ID");
  if (!userId) {
    return c.json({ error: "Missing X-User-ID" }, 400);
  }

  c.set("userId", userId);
  await next();
}
