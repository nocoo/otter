import { randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  assertTestCredentials,
  isMode,
  type LocalRuntime,
  type Mode,
  ROOT,
  startLocalRuntime,
} from "./runtime";

const PROD_ORIGIN = "https://otter.worker.hexly.ai";
const INSTANCE_PATH = /^\/__local\/instances\/([^/]+)(\/(?:api|ingest)\/.*|\/health)$/;
export type Descriptor = {
  local: boolean;
  mode: Mode | null;
  automated: boolean;
  locked: boolean;
  instanceId: string | null;
  csrfToken: string;
  ingestBase: string | null;
};
type Target = { mode: Mode; instanceId: string; url: string; runtime?: LocalRuntime };
type Options = {
  mode?: Mode;
  automated?: boolean;
  hosted?: boolean;
  built?: boolean;
  port?: number;
  catalog?: "demo" | "empty";
};

function localOrigin(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  if (!host || !["otter.dev.hexly.ai", `127.0.0.1:${port}`, `localhost:${port}`].includes(host))
    return false;
  const origin = req.headers.origin;
  return (
    req.headers["sec-fetch-site"] !== "cross-site" &&
    (!origin || origin === `http://${host}` || origin === `https://${host}`)
  );
}
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error("Request body exceeds local limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function authorizedSelection(req: IncomingMessage, csrfToken: string): boolean {
  const csrf = req.headers["x-otter-local-csrf"];
  return (
    req.method === "POST" &&
    !!req.headers.origin &&
    typeof csrf === "string" &&
    Buffer.byteLength(csrf) === Buffer.byteLength(csrfToken) &&
    timingSafeEqual(Buffer.from(csrf), Buffer.from(csrfToken))
  );
}

export async function startLocalServer(options: Options = {}) {
  if (options.automated) {
    assertTestCredentials();
    if (options.mode !== "e2e") throw new Error("Automated launches require E2E");
  }
  const csrfToken = randomUUID();
  let target: Target | undefined;
  let selection: Promise<Descriptor> | undefined;
  let closing = false;
  let closed: Promise<void> | undefined;
  let port = options.port ?? 7019;
  const owned = new Set<LocalRuntime>();
  const require = createRequire(resolve(ROOT, "apps/web/package.json"));
  const { createServer: createVite, loadEnv } =
    require("vite") as typeof import("../../apps/web/node_modules/vite/dist/node/index");
  const prodToken = options.automated
    ? ""
    : (loadEnv("development", resolve(ROOT, "apps/web"), "OTTER_").OTTER_DEV_API_TOKEN ?? "");
  let vite: Awaited<ReturnType<typeof createVite>> | undefined;
  const descriptor = (): Descriptor => ({
    local: !options.hosted,
    mode: target?.mode ?? null,
    automated: !!options.automated,
    locked: !!options.automated,
    instanceId: target?.instanceId ?? null,
    csrfToken,
    ingestBase: target
      ? target.mode === "prod"
        ? PROD_ORIGIN
        : `/__local/instances/${target.instanceId}`
      : null,
  });
  const release = async (runtime: LocalRuntime | undefined) => {
    if (!runtime) return;
    await runtime.stop();
    owned.delete(runtime);
  };
  const select = async (mode: Mode) => {
    if (closing) throw new Error("Local environments are shutting down");
    if (options.automated && mode !== "e2e") throw new Error("Automated E2E is locked");
    if (target?.mode === mode) return descriptor();
    if (selection) throw new Error("Environment switch already in progress");
    selection = (async () => {
      const previous = target;
      const runtime =
        mode === "prod"
          ? undefined
          : await startLocalRuntime(mode, {
              catalog: options.catalog,
              automated: options.automated,
            });
      if (runtime) owned.add(runtime);
      try {
        if (closing) throw new Error("Local environments are shutting down");
        await release(previous?.runtime);
        if (closing) throw new Error("Local environments are shutting down");
        target = {
          mode,
          instanceId: runtime?.instanceId ?? randomUUID(),
          url: runtime?.url ?? PROD_ORIGIN,
          runtime,
        };
        return descriptor();
      } catch (error) {
        await release(runtime);
        throw error;
      }
    })().finally(() => {
      selection = undefined;
    });
    return await selection;
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (!localOrigin(req, port)) {
        json(res, 403, { error: "Local origin required" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://local.invalid");
      if (url.pathname === "/__local/environment" && req.method === "GET") {
        json(res, 200, descriptor());
        return;
      }
      if (url.pathname === "/__local/environment/select") {
        if (options.hosted || !authorizedSelection(req, csrfToken)) {
          json(res, 403, { error: "Invalid local selection" });
          return;
        }
        const input = JSON.parse((await readBody(req)).toString()) as {
          mode?: unknown;
          instanceId?: unknown;
        };
        if (
          !isMode(input.mode) ||
          input.instanceId !== (target?.instanceId ?? null) ||
          (options.automated && input.mode !== "e2e")
        ) {
          json(res, 409, { error: "Invalid, locked or expired environment instance" });
          return;
        }
        json(res, 200, await select(input.mode));
        return;
      }
      const match = INSTANCE_PATH.exec(url.pathname);
      if (match) {
        const captured = target;
        if (!captured || match[1] !== captured.instanceId) {
          json(res, 409, { error: "Environment instance expired. Reload explicitly." });
          return;
        }
        await proxy(req, res, captured, `${match[2]}${url.search}`, prodToken);
        return;
      }
      if (
        options.automated &&
        (url.pathname.startsWith("/api/") ||
          url.pathname.startsWith("/ingest/") ||
          url.pathname === "/health")
      ) {
        if (!target) throw new Error("E2E runtime unavailable");
        await proxy(req, res, target, `${url.pathname}${url.search}`, "");
        return;
      }
      if (
        url.pathname.startsWith("/__local/") ||
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/ingest/")
      ) {
        json(res, 404, { error: "Not found" });
        return;
      }
      if (vite) {
        vite.middlewares(req, res);
        return;
      }
      await serveBuilt(url.pathname, req.method, res, !options.hosted);
    })().catch((error: unknown) => {
      if (!res.headersSent)
        json(res, 503, {
          error: error instanceof Error ? error.message : "Local environment unavailable",
        });
      else res.destroy();
    });
  });
  const close = () =>
    (closed ??= (async () => {
      closing = true;
      await selection?.catch(() => undefined);
      server.closeAllConnections();
      const listener = server.listening
        ? new Promise<void>((done, reject) =>
            server.close((error) => (error ? reject(error) : done())),
          )
        : Promise.resolve();
      const results = await Promise.allSettled([
        listener,
        vite?.close(),
        ...Array.from(owned, release),
      ]);
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, "Local cleanup failed");
      target = undefined;
    })().catch((error: unknown) => {
      closed = undefined;
      throw error;
    }));
  try {
    if (options.mode) await select(options.mode);
    if (!options.built) {
      vite = await createVite({
        root: resolve(ROOT, "apps/web"),
        configFile: resolve(ROOT, "apps/web/vite.config.ts"),
        plugins: options.hosted
          ? []
          : [
              {
                name: "otter-local-capability",
                transformIndexHtml: () => [
                  {
                    tag: "script",
                    children: "window.__OTTER_LOCAL__=true",
                    injectTo: "head-prepend",
                  },
                ],
              },
            ],
        server: { middlewareMode: true, hmr: { server }, watch: { ignored: ["**/.wrangler/**"] } },
      });
    }
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Local listener missing");
    port = address.port;
    return {
      url: `http://127.0.0.1:${port}`,
      descriptor,
      get runtime() {
        return target?.runtime;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function proxy(
  req: IncomingMessage,
  res: ServerResponse,
  captured: Target,
  path: string,
  prodToken: string,
) {
  if (captured.mode === "prod" && !prodToken) {
    json(res, 401, {
      error:
        "Production sign-in required. Set OTTER_DEV_API_TOKEN in apps/web/.env, then restart the local launcher.",
    });
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      value &&
      ![
        "host",
        "cookie",
        "authorization",
        "connection",
        "content-length",
        "origin",
        "sec-fetch-site",
      ].includes(name) &&
      !name.startsWith("cf-") &&
      !name.startsWith("x-otter-local-")
    )
      headers.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  const token = captured.mode === "prod" ? prodToken : captured.runtime?.token;
  if (req.headers.authorization && captured.mode !== "prod")
    headers.set("authorization", req.headers.authorization);
  else if (token) headers.set("authorization", `Bearer ${token}`);
  headers.set("origin", captured.url);
  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await readBody(req));
  const response = await fetch(`${captured.url}${path}`, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(180_000),
  });
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (
      ![
        "set-cookie",
        "content-encoding",
        "content-length",
        "transfer-encoding",
        "connection",
      ].includes(name)
    )
      res.setHeader(name, value);
  });
  res.setHeader("cache-control", "no-store");
  if (response.body)
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
  else res.end();
}

async function serveBuilt(
  pathname: string,
  method: string | undefined,
  res: ServerResponse,
  local: boolean,
) {
  if (method !== "GET" && method !== "HEAD") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }
  const root = await realpath(resolve(ROOT, "apps/web/dist"));
  const requested = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!requested.startsWith(`${root}/`) && requested !== root) {
    json(res, 404, { error: "Not found" });
    return;
  }
  let path = await realpath(requested).catch(() => "");
  if (!path || !extname(path)) {
    if (extname(pathname)) {
      json(res, 404, { error: "Asset not found" });
      return;
    }
    path = resolve(root, "index.html");
  }
  if (!path.startsWith(`${root}/`)) {
    json(res, 404, { error: "Not found" });
    return;
  }
  const bytes = await readFile(path);
  const extension = extname(path);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".json": "application/json",
  };
  const body =
    extension === ".html" && local
      ? bytes.toString().replace("<head>", "<head><script>window.__OTTER_LOCAL__=true</script>")
      : bytes;
  res.writeHead(200, {
    "content-type": types[extension] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(method === "HEAD" ? undefined : body);
}
