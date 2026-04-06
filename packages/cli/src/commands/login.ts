import { openBrowser, performLogin } from "@nocoo/cli-base";
import type { ConfigManager } from "../config/manager.js";

export const DEFAULT_HOST = "https://otter.hexly.ai";
export const DEV_HOST = "https://otter.dev.hexly.ai";

/**
 * Default Worker API URL for ingest endpoints.
 * CLI uploads now go directly to the Worker by default.
 */
export const DEFAULT_WORKER_URL = "https://otter.worker.hexly.ai";

const TIMEOUT_MS = 30_000;

/**
 * Get Worker API URL for ingest endpoints.
 * Returns OTTER_API_URL env if set, otherwise the default Worker URL.
 * Set OTTER_API_URL to override or use legacy Next.js endpoints.
 */
export function getWorkerApiUrl(): string {
  return process.env.OTTER_API_URL ?? DEFAULT_WORKER_URL;
}

export interface LoginOptions {
  /** Use the dev host instead of production */
  dev?: boolean;
}

export interface LoginResult {
  success: boolean;
  /** The host that was used */
  host?: string;
  /** The token obtained from the dashboard */
  token?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Determine the host URL based on the --dev flag.
 * No longer reads from config — host is purely determined at runtime.
 */
export function resolveHost(options: LoginOptions): string {
  return options.dev ? DEV_HOST : DEFAULT_HOST;
}

/**
 * Build a webhook URL from host and token.
 * Uses Worker URL format by default (/ingest/{token}).
 * The host parameter is now only used for login flow, not for uploads.
 */
export function buildWebhookUrl(_host: string, token: string): string {
  const workerUrl = getWorkerApiUrl();
  // Worker URL format: https://otter-api.nocoo.workers.dev/ingest/{token}
  return `${workerUrl}/ingest/${token}`;
}

/**
 * Execute the login flow using cli-base performLogin.
 *
 * The flow:
 * 1. Start local HTTP server on a random available port
 * 2. Open browser to the connect page
 * 3. Wait for callback with token
 * 4. Save token to config and close server
 */
export async function executeLogin(
  configManager: ConfigManager,
  options: LoginOptions,
  callbacks?: {
    onPortReady?: (port: number) => void;
    onBrowserOpen?: (url: string) => void;
    onSuccess?: (token: string) => void;
    onError?: (error: string) => void;
    onTimeout?: () => void;
    openBrowser?: (url: string) => void;
  },
): Promise<LoginResult> {
  const host = resolveHost(options);

  const result = await performLogin({
    apiUrl: host,
    timeoutMs: TIMEOUT_MS,
    tokenParam: "token",
    loginPath: "/cli/connect",
    accentColor: "#f97316", // Otter orange
    openBrowser: async (url) => {
      callbacks?.onBrowserOpen?.(url);
      const opener = callbacks?.openBrowser;
      if (opener) {
        opener(url);
      } else {
        await openBrowser(url);
      }
    },
    onSaveToken: (token) => {
      configManager.write({ token });
      callbacks?.onSuccess?.(token);
    },
    log: (msg) => {
      // Log fallback URL if browser fails to open
      console.log(msg);
    },
  });

  if (!result.success) {
    if (result.error?.includes("timeout")) {
      callbacks?.onTimeout?.();
    } else if (result.error) {
      callbacks?.onError?.(result.error);
    }
    const failResult: LoginResult = {
      success: false,
      host,
    };
    if (result.error) {
      failResult.error = result.error;
    }
    return failResult;
  }

  const successResult: LoginResult = {
    success: true,
    host,
  };
  const token = configManager.getToken();
  if (token) {
    successResult.token = token;
  }
  return successResult;
}
