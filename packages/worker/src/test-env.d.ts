import type { Env } from "./types.js";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
