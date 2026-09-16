import type { Env as WorkerEnv } from "./types.js";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
