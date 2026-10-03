import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMode, ROOT, startLocalRuntime } from "./environments/runtime";
import { startLocalServer } from "./environments/server";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--reset-demo")) {
  const runtime = await startLocalRuntime("demo", { reset: true });
  await runtime.verifyMarker();
  await runtime.stop(true);
  console.log("Owned Demo reset; the next launch will seed the catalog.");
} else {
  const index = args.indexOf("--mode");
  const mode = index < 0 ? undefined : args[index + 1];
  if (mode !== undefined && !isMode(mode)) throw new Error("Mode must be demo, e2e or prod");
  if (args.includes("--built")) await readFile(join(ROOT, "apps/web/dist/index.html"));
  const server = await startLocalServer({
    ...(mode ? { mode } : {}),
    built: args.includes("--built"),
    port: 7019,
  });
  console.log("Otter local dashboard: https://otter.dev.hexly.ai");
  const cleanup = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
