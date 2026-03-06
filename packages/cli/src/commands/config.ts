import type { OtterConfig } from "@otter/core";
import type { ConfigManager } from "../config/manager.js";

export type ConfigAction =
  | { action: "set"; key: keyof OtterConfig; value: string }
  | { action: "get"; key: keyof OtterConfig }
  | { action: "show" };

/**
 * Execute a config operation. Pure logic, decoupled from CLI I/O.
 */
export async function executeConfig(
  manager: ConfigManager,
  params: ConfigAction
): Promise<string | OtterConfig | undefined> {
  switch (params.action) {
    case "set": {
      const config = await manager.load();
      (config as Record<string, string>)[params.key] = params.value;
      await manager.save(config);
      return params.value;
    }
    case "get": {
      const config = await manager.load();
      return config[params.key];
    }
    case "show": {
      return await manager.load();
    }
  }
}
