/**
 * otter update — update CLI to latest version.
 *
 * Uses cli-base createUpdateCommand for standard update behavior.
 */

// CLI_VERSION is defined in cli.ts, we need to import it
// For now, read from package.json at runtime
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUpdateCommand } from "@nocoo/cli-base";

function getVersion(): string {
  try {
    // In dist, __dirname is packages/cli/dist/commands
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export default createUpdateCommand({
  packageName: "@nocoo/otter",
  currentVersion: getVersion(),
  cliName: "otter",
});
