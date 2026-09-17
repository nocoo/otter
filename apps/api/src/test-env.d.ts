import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "./types.js";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      // biome-ignore lint/style/useNamingConvention: Cloudflare test binding
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
