import type { Env } from "./types.js";

declare module "cloudflare:workers" {
  interface CloudflareEnv extends Env {}
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
