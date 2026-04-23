// HTTP D1 driver — wraps the existing module-scoped functions in lib/cf/d1.ts.
// Keeping cf/d1.ts intact lets web_legacy keep importing it directly while
// new code routes through this DbDriver-shaped facade.
import { batch, execute, query, queryFirst } from "../cf/d1";
import type { DbDriver } from "./driver";

export function createHttpDriver(): DbDriver {
  return {
    query,
    queryFirst,
    async execute(sql, params) {
      const result = await execute(sql, params);
      return { changes: result.changes, lastRowId: result.lastRowId };
    },
    batch,
  };
}
