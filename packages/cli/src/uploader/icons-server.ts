import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Configuration for server-side icon upload */
export interface IconUploadConfig {
  /** Full URL to the icon upload endpoint, e.g. https://otter.hexly.ai/api/webhook/{token}/icons */
  iconsUrl: string;
  /** Optional timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

/** Result of an icon upload batch */
export interface IconUploadResult {
  success: boolean;
  /** Number of icons stored by server */
  stored: number;
  /** Total icons sent */
  total: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Hashes of icons that failed server-side */
  errors?: string[];
}

/** A single icon to upload */
export interface IconEntry {
  appName: string;
  pngPath: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Generate a deterministic hash from an app name.
 * Returns the first 12 hex chars of SHA-256(appName).
 */
export function hashAppName(appName: string): string {
  return createHash("sha256").update(appName).digest("hex").slice(0, 12);
}

/**
 * Upload app icons to the server endpoint.
 * Reads each PNG file, base64-encodes it, and POSTs
 * the batch to /api/webhook/[token]/icons.
 */
export async function uploadIconsToServer(
  icons: IconEntry[],
  config: IconUploadConfig,
): Promise<IconUploadResult> {
  if (icons.length === 0) {
    return { success: true, stored: 0, total: 0, durationMs: 0 };
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = performance.now();

  try {
    // Read and encode all icons in parallel
    const payload = await Promise.all(
      icons.map(async (icon) => {
        const buffer = await readFile(icon.pngPath);
        return {
          hash: hashAppName(icon.appName),
          data: buffer.toString("base64"),
        };
      }),
    );

    const response = await fetch(config.iconsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icons: payload }),
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - start);
    const body = (await response.json()) as {
      stored?: number;
      error?: string;
      errors?: string[];
    };

    if (response.ok || response.status === 207) {
      return {
        success: response.ok,
        stored: body.stored ?? 0,
        total: icons.length,
        durationMs,
        ...(body.errors ? { errors: body.errors } : {}),
      };
    }

    return {
      success: false,
      stored: 0,
      total: icons.length,
      error: body.error ?? `Server returned ${response.status}`,
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? `Icon upload timed out after ${timeoutMs}ms`
        : (err as Error).message;

    return {
      success: false,
      stored: 0,
      total: icons.length,
      error: message,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
