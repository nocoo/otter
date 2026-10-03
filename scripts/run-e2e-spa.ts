import { spawnSync } from "node:child_process";
import { assertTestCredentials, ROOT } from "./environments/runtime";
import { startLocalServer } from "./environments/server";

assertTestCredentials();
const build = spawnSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) throw new Error("SPA build failed");
const server = await startLocalServer({
  mode: "e2e",
  automated: true,
  hosted: !!process.env.CI,
  built: true,
  port: Number(process.env.E2E_SPA_PORT ?? 27019),
});
console.log(`Local E2E ready on ${server.url}`);
const cleanup = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
