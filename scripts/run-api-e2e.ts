import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalServer } from "./environments/server";

export async function startApiE2eServer() {
  const server = await startLocalServer({
    mode: "e2e",
    automated: true,
    hosted: true,
    built: true,
    port: 0,
  });
  return { baseUrl: server.url, email: server.runtime?.email, stop: server.close };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? ".")) {
  const server = await startApiE2eServer();
  console.log(`Local E2E ready on ${server.baseUrl}`);
  const cleanup = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
