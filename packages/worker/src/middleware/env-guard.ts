import type { Context, Next } from "hono";
import type { Env, Variables } from "../types.js";

/**
 * 资源隔离守卫 — 防止测试流量写入生产资源
 *
 * 强制规则：
 * - test 环境必须使用 *-test 后缀的 D1/R2 资源（remote mode only）
 * - 生产环境禁止使用 *-test 资源
 * - 校验失败立即 500，不执行任何业务逻辑
 *
 * Skipped when E2E_SKIP_AUTH=true (local miniflare mode — all resources
 * are local SQLite files, no remote prod/test distinction applies).
 */
export async function envGuardMiddleware(
  // biome-ignore lint/style/useNamingConvention: Hono generic parameter names
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<Response | undefined> {
  const env = c.env.ENVIRONMENT ?? "production";

  // Local E2E: all bindings are miniflare SQLite — resource naming is irrelevant.
  const e2eLocal = (c.env as Record<string, string | undefined>).E2E_SKIP_AUTH === "true";
  if (e2eLocal) {
    await next();
    return;
  }

  // 仅对 test 环境强制校验
  if (env === "test") {
    const dbName = c.env.D1_DATABASE_NAME;
    const bucketName = c.env.R2_BUCKET_NAME;

    if (!dbName?.endsWith("-test")) {
      console.error(`[env-guard] FATAL: test env but D1 is "${dbName}", expected *-test`);
      return c.json({ error: "Resource isolation violation: D1" }, 500);
    }

    if (!bucketName?.endsWith("-test")) {
      console.error(`[env-guard] FATAL: test env but R2 is "${bucketName}", expected *-test`);
      return c.json({ error: "Resource isolation violation: R2" }, 500);
    }
  }

  // 生产环境反向校验：禁止使用测试资源
  if (env === "production") {
    const dbName = c.env.D1_DATABASE_NAME;
    const bucketName = c.env.R2_BUCKET_NAME;

    if (dbName?.includes("-test") || bucketName?.includes("-test")) {
      console.error("[env-guard] FATAL: production env using test resource");
      return c.json({ error: "Resource isolation violation: test resource in prod" }, 500);
    }
  }

  await next();
}
