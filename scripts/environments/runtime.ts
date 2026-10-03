import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { generateRawToken, hashToken } from "../../packages/api/src/lib/api-token-repo";
import { demoSnapshots, FIXTURE_VERSION } from "./fixtures";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const STATE_ROOT = join(ROOT, "apps/api/.wrangler/environments");
const require = createRequire(join(ROOT, "apps/api/package.json"));
const WRANGLER = resolve(dirname(require.resolve("wrangler")), "../bin/wrangler.js");
const parseToml = createRequire(join(ROOT, "apps/cli/package.json"))("smol-toml").parse as (
  text: string,
) => Record<string, unknown>;
export type Mode = "demo" | "e2e" | "prod";
export function isMode(value: unknown): value is Mode {
  return value === "demo" || value === "e2e" || value === "prod";
}

export function isolatedEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    OTTER_AUTOMATED_E2E: "true",
  };
}

const PROD_CREDENTIAL =
  /^(CF_(API_TOKEN|API_KEY|ACCOUNT_ID|D1_API_TOKEN|D1_DATABASE_ID)|CLOUDFLARE_(API_TOKEN|API_KEY|ACCOUNT_ID)|CF_ACCESS_CLIENT_(ID|SECRET)|OTTER_DEV_API_TOKEN)$/;
export function assertTestCredentials(source = process.env): void {
  const found = Object.keys(source).filter((name) => source[name] && PROD_CREDENTIAL.test(name));
  if (found.length) throw new Error(`E2E refuses production credentials: ${found.join(", ")}`);
}

export async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port allocated");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

export async function runWrangler(args: string[], cwd: string): Promise<string> {
  const child = spawn("node", [WRANGLER, ...args], {
    cwd,
    env: isolatedEnv(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let diagnostic = "";
  child.stdout.on("data", (data) => {
    output += String(data);
  });
  child.stderr.on("data", (data) => {
    diagnostic = (diagnostic + String(data)).slice(-6000);
  });
  const timer = setTimeout(() => {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  }, 90_000);
  try {
    const [code] = await once(child, "exit");
    if (code !== 0)
      throw new Error(`Local Wrangler failed (${code}): ${diagnostic} ${output.slice(-2000)}`);
    return output;
  } finally {
    clearTimeout(timer);
  }
}

type Owner = {
  version: 1;
  id: string;
  mode: "demo" | "e2e";
  initialized: boolean;
  fixtureVersion: number;
};
export type OwnedState = { path: string; owner: Owner };
export async function validateOwned(state: OwnedState): Promise<void> {
  const root = await realpath(STATE_ROOT);
  const path = await realpath(state.path);
  if (
    root !== STATE_ROOT ||
    path !== state.path ||
    dirname(path) !== root ||
    (await lstat(path)).isSymbolicLink()
  )
    throw new Error("Refusing foreign or symlinked environment path");
  const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as Owner;
  if (JSON.stringify(owner) !== JSON.stringify(state.owner))
    throw new Error("Environment ownership mismatch");
}

async function createOwned(mode: "demo" | "e2e"): Promise<OwnedState> {
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  if ((await realpath(STATE_ROOT)) !== STATE_ROOT)
    throw new Error("Environment root must not be symlinked");
  const path = mode === "demo" ? join(STATE_ROOT, "demo") : await mkdtemp(join(STATE_ROOT, "e2e-"));
  if (mode === "demo" && existsSync(path)) {
    const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as Owner;
    if (owner.version !== 1 || owner.mode !== mode || !owner.id)
      throw new Error("Invalid Demo owner");
    const state = { path, owner };
    await validateOwned(state);
    return state;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  const owner: Owner = {
    version: 1,
    id: randomUUID(),
    mode,
    initialized: false,
    fixtureVersion: 0,
  };
  await writeFile(join(path, "owner.json"), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  return { path, owner };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.pid && child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
  }, 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function startLocalRuntime(
  mode: "demo" | "e2e",
  options: { port?: number; catalog?: "demo" | "empty"; automated?: boolean; reset?: boolean } = {},
) {
  if (options.automated) assertTestCredentials();
  const state = await createOwned(mode);
  await validateOwned(state);
  if (state.owner.initialized && !state.owner.fixtureVersion && !options.reset)
    throw new Error("Demo seed incomplete; explicitly reset owned Demo");
  const lock = join(state.path, "active.lock");
  await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  const runDir = await mkdtemp(join(state.path, "runtime-")).catch(async (error: unknown) => {
    await rm(lock);
    throw error;
  });
  const config = join(runDir, "wrangler.json");
  const persist = join(state.path, "storage");
  const instanceId = randomUUID();
  const email = mode === "demo" ? "demo@otter.test" : `e2e-${instanceId}@otter.test`;
  const token = generateRawToken();
  const tokenId = randomUUID();
  let child: ChildProcess | undefined;
  let markerCreated = state.owner.initialized;
  let stopping: Promise<void> | undefined;
  let configText = "";
  const sql = async (query: string) => {
    await validateOwned(state);
    if ((await readFile(config, "utf8")) !== configText)
      throw new Error("Local runtime configuration changed");
    const output = await runWrangler(
      [
        "d1",
        "execute",
        "DB",
        "--local",
        "--config",
        config,
        "--persist-to",
        persist,
        "--command",
        query,
        "--json",
      ],
      runDir,
    );
    return JSON.parse(output) as Array<{ results: Array<Record<string, unknown>> }>;
  };
  const verifyMarker = async () => {
    const result = await sql("SELECT key,value FROM _test_marker");
    const marker = Object.fromEntries(
      (result[0]?.results ?? []).map((row) => [row.key, row.value]),
    );
    if (marker.owner !== state.owner.id || marker.env !== mode)
      throw new Error("D1 ownership marker mismatch");
  };
  const stop = (resetDemo = false) =>
    (stopping ??= (async () => {
      if (child) {
        await stopChild(child);
        child = undefined;
      }
      await validateOwned(state);
      if (markerCreated) {
        await verifyMarker();
        await sql(`DELETE FROM api_tokens WHERE id='${tokenId}'`);
      }
      await validateOwned(state);
      if (mode === "e2e" || resetDemo) await rm(state.path, { recursive: true });
      else {
        await rm(runDir, { recursive: true });
        await rm(lock);
      }
    })().catch((error: unknown) => {
      stopping = undefined;
      throw error;
    }));
  try {
    const production = parseToml(await readFile(join(ROOT, "apps/api/wrangler.toml"), "utf8"));
    configText = JSON.stringify({
      name: `otter-local-${instanceId}`,
      main: join(ROOT, "apps/api/src/index.ts"),
      compatibility_date: production.compatibility_date,
      compatibility_flags: production.compatibility_flags,
      workers_dev: false,
      preview_urls: false,
      vars: {
        ...(production.vars as object),
        ENVIRONMENT: "test",
        D1_DATABASE_NAME: "otter-local-test",
        R2_BUCKET_NAME: "otter-local-test",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "otter-local-test",
          database_id: state.owner.id,
          remote: false,
          migrations_dir: join(ROOT, "apps/api/migrations"),
        },
      ],
      r2_buckets: [
        { binding: "SNAPSHOTS", bucket_name: "otter-local-test", remote: false },
        { binding: "ICONS", bucket_name: "otter-icons-test", remote: false },
      ],
      assets: { ...(production.assets as object), directory: join(ROOT, "apps/web/dist") },
    });
    await writeFile(config, configText, { mode: 0o600 });
    await writeFile(join(runDir, ".dev.vars"), "", { mode: 0o600 });
    if (state.owner.initialized) await verifyMarker();
    await runWrangler(
      ["d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", persist],
      runDir,
    );
    if (!state.owner.initialized) {
      await sql(
        `CREATE TABLE _test_marker (key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO _test_marker VALUES ('owner','${state.owner.id}'),('env','${mode}');`,
      );
      markerCreated = true;
      state.owner.initialized = true;
      await writeFile(join(state.path, "owner.json"), JSON.stringify(state.owner), { mode: 0o600 });
    }
    await verifyMarker();
    const hash = await hashToken(token);
    await sql(
      `INSERT INTO api_tokens (id,token_hash,token_prefix,email,label,created_at,expires_at) VALUES ('${tokenId}','${hash}','${token.slice(0, 12)}','${email}','Local fixture',${Date.now()},${Date.now() + 24 * 60 * 60 * 1000});`,
    );
    const port = options.port ?? (await availablePort());
    child = spawn(
      "node",
      [
        WRANGLER,
        "dev",
        "--local",
        "--config",
        config,
        "--persist-to",
        persist,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--inspector-port",
        "0",
        "--log-level",
        "error",
        "--show-interactive-dev-session=false",
      ],
      { cwd: runDir, env: isolatedEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (data) => {
        log = (log + String(data)).slice(-12000);
      });
    const url = `http://127.0.0.1:${port}`;
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
      return fetch(`${url}${path}`, {
        ...init,
        headers,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(60_000),
      });
    };
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Worker exited before readiness: ${log}`);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: readiness polling is sequential
        const response = await request("/api/me", { signal: AbortSignal.timeout(1000) });
        if (response.ok && ((await response.json()) as { email: string }).email === email) {
          ready = true;
          break;
        }
      } catch {
        /* Readiness retries are bounded by the deadline. */
      }
      await delay(200);
    }
    if (!ready) throw new Error(`Worker failed authenticated readiness: ${log}`);
    if (!state.owner.fixtureVersion && !options.reset) {
      if (mode === "demo" || options.catalog === "demo") {
        for (const snapshot of await demoSnapshots()) {
          // biome-ignore lint/performance/noAwaitInLoops: preserve fixture history order
          const response = await request("/api/snapshots", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot),
          });
          if (!response.ok)
            throw new Error(`Demo seed failed: ${response.status} ${await response.text()}`);
        }
        for (const label of ["Studio backups", "Travel backups"]) {
          // biome-ignore lint/performance/noAwaitInLoops: deterministic seed order
          const response = await request("/api/webhooks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label }),
          });
          if (!response.ok) throw new Error(`Webhook seed failed: ${response.status}`);
        }
      }
      state.owner.fixtureVersion = FIXTURE_VERSION;
      await writeFile(join(state.path, "owner.json"), JSON.stringify(state.owner), { mode: 0o600 });
    }
    return { mode, instanceId, email, token, url, state, request, sql, verifyMarker, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
export type LocalRuntime = Awaited<ReturnType<typeof startLocalRuntime>>;
