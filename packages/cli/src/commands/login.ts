import { createServer } from "node:http";
import { exec } from "node:child_process";
import { createConnection } from "node:net";
import type { OtterConfig } from "@otter/core";
import type { ConfigManager } from "../config/manager.js";

const DEFAULT_HOST = "https://otter.hexly.ai";
const DEV_HOST = "https://otter.dev.hexly.ai";
const TIMEOUT_MS = 30_000;
const PORT_RANGE_START = 49152;
const PORT_RANGE_END = 65535;

export interface LoginOptions {
  /** Use the dev host instead of production */
  dev?: boolean;
}

export interface LoginResult {
  success: boolean;
  /** The host that was used */
  host?: string;
  /** The webhook URL that was configured */
  webhookUrl?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Check if a port is available by attempting to connect to it.
 * Returns true if the port is free.
 */
export function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false); // port is in use
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(true); // port is free
    });
  });
}

/**
 * Find a random available port in the ephemeral range.
 */
export async function findAvailablePort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port =
      PORT_RANGE_START +
      Math.floor(Math.random() * (PORT_RANGE_END - PORT_RANGE_START));
    if (await checkPortAvailable(port)) {
      return port;
    }
  }
  throw new Error("Could not find an available port after 20 attempts");
}

/**
 * Open a URL in the default browser (macOS only for now).
 */
function openBrowser(url: string): void {
  exec(`open "${url}"`);
}

/**
 * Parse callback query parameters from the URL.
 * Expected: /callback?token=<uuid>&webhookUrl=<encoded-url>
 */
export function parseCallbackParams(
  url: string
): { token: string; webhookUrl: string } | { error: string } {
  try {
    const parsed = new URL(url, "http://localhost");
    const token = parsed.searchParams.get("token");
    const webhookUrl = parsed.searchParams.get("webhookUrl");
    const error = parsed.searchParams.get("error");

    if (error) {
      return { error };
    }
    if (!token || !webhookUrl) {
      return { error: "Missing token or webhookUrl in callback" };
    }
    return { token, webhookUrl };
  } catch {
    return { error: `Invalid callback URL: ${url}` };
  }
}

/**
 * Determine the host URL based on options and existing config.
 */
export function resolveHost(
  config: OtterConfig,
  options: LoginOptions
): string {
  if (options.dev) return DEV_HOST;
  if (config.host) return config.host;
  return DEFAULT_HOST;
}

/**
 * Execute the login flow:
 * 1. Start local HTTP server on a random available port
 * 2. Open browser to the connect page
 * 3. Wait for callback with token + webhookUrl
 * 4. Save config and close server
 */
export async function executeLogin(
  configManager: ConfigManager,
  options: LoginOptions,
  callbacks?: {
    onPortReady?: (port: number) => void;
    onBrowserOpen?: (url: string) => void;
    onSuccess?: (webhookUrl: string) => void;
    onError?: (error: string) => void;
    onTimeout?: () => void;
    openBrowser?: (url: string) => void;
  }
): Promise<LoginResult> {
  const config = await configManager.load();
  const host = resolveHost(config, options);
  const port = await findAvailablePort();
  const callbackBase = `http://localhost:${port}`;

  callbacks?.onPortReady?.(port);

  return new Promise<LoginResult>((resolve) => {
    let settled = false;

    const server = createServer(async (req, res) => {
      const reqUrl = req.url ?? "";

      // Only handle GET /callback
      if (!reqUrl.startsWith("/callback")) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const params = parseCallbackParams(reqUrl);

      if ("error" in params) {
        // Return error page
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(params.error));

        if (!settled) {
          settled = true;
          callbacks?.onError?.(params.error);
          server.close();
          resolve({ success: false, host, error: params.error });
        }
        return;
      }

      // Save the webhook URL and host to config
      const updatedConfig = await configManager.load();
      updatedConfig.webhookUrl = params.webhookUrl;
      updatedConfig.host = host;
      await configManager.save(updatedConfig);

      // Return success page
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successHtml());

      if (!settled) {
        settled = true;
        callbacks?.onSuccess?.(params.webhookUrl);
        server.close();
        resolve({
          success: true,
          host,
          webhookUrl: params.webhookUrl,
        });
      }
    });

    // Start server
    server.listen(port, "127.0.0.1", () => {
      const connectUrl = `${host}/cli/connect?callback=${encodeURIComponent(callbackBase)}`;
      callbacks?.onBrowserOpen?.(connectUrl);
      const opener = callbacks?.openBrowser ?? openBrowser;
      opener(connectUrl);
    });

    // Timeout after 30 seconds
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        callbacks?.onTimeout?.();
        server.close();
        resolve({
          success: false,
          host,
          error: "Login timed out (30s). Please try again.",
        });
      }
    }, TIMEOUT_MS);

    // Clean up timer when server closes
    server.on("close", () => clearTimeout(timer));
  });
}

// ---------------------------------------------------------------------------
// HTML templates for callback responses
// ---------------------------------------------------------------------------

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Otter CLI Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .card { text-align: center; padding: 3rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    p { color: #a1a1aa; font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connected!</h1>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;
}

function errorHtml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head>
  <title>Otter CLI - Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .card { text-align: center; padding: 3rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #ef4444; }
    p { color: #a1a1aa; font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connection Failed</h1>
    <p>${escaped}</p>
  </div>
</body>
</html>`;
}
