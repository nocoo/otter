/** Cloudflare Worker environment bindings */
export interface Env {
  // D1 Database
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
  DB: D1Database;

  // R2 Buckets
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
  SNAPSHOTS: R2Bucket;
  // biome-ignore lint/style/useNamingConvention: Cloudflare binding name
  ICONS: R2Bucket;

  // Environment variables (SCREAMING_SNAKE_CASE is standard for env vars)
  // biome-ignore lint/style/useNamingConvention: env var naming
  ENVIRONMENT: "production" | "staging" | "test";
  // biome-ignore lint/style/useNamingConvention: env var naming
  D1_DATABASE_NAME: string;
  // biome-ignore lint/style/useNamingConvention: env var naming
  R2_BUCKET_NAME: string;
  // biome-ignore lint/style/useNamingConvention: env var naming
  ICON_PREFIX: string;
  // biome-ignore lint/style/useNamingConvention: env var naming
  CF_ACCESS_TEAM_DOMAIN?: string;
  // biome-ignore lint/style/useNamingConvention: env var naming
  CF_ACCESS_AUD?: string;
}

/** Hono context variables (currently unused; kept for future per-request state). */
export type Variables = Record<string, never>;
