import { gzipSync } from "node:zlib";
import type { Snapshot, UploaderConfig, UploadResult } from "@otter/core";
import { digest } from "../workspace/files.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Upload a snapshot to the configured URL via HTTP POST.
 * The payload is gzip-compressed to reduce transfer size and
 * authenticated with a Bearer token.
 */
export async function uploadSnapshot(
  snapshot: Snapshot,
  config: UploaderConfig,
): Promise<UploadResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = performance.now();

  try {
    const jsonBody = JSON.stringify(snapshot);
    const compressed = gzipSync(jsonBody);

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        // biome-ignore lint/style/useNamingConvention: HTTP header
        Authorization: `Bearer ${config.token}`,
      },
      body: compressed,
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - start);

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        receipt?: import("@otter/core").RemoteReceipt;
      };
      if (
        snapshot.version === 2 &&
        (body.receipt?.snapshotId !== snapshot.id ||
          body.receipt.sha256 !== digest(jsonBody) ||
          !body.receipt.account ||
          !body.receipt.receivedAt)
      ) {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          error:
            "Server acceptance is unconfirmed: receipt missing or digest mismatch. Upgrade the server, then verify or retry this saved snapshot.",
        };
      }
      return {
        success: true,
        statusCode: response.status,
        durationMs,
        ...(body.receipt ? { receipt: body.receipt } : {}),
      };
    }

    return {
      success: false,
      statusCode: response.status,
      error: `Upload failed with status ${response.status} ${response.statusText}`,
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? `Upload timed out after ${timeoutMs}ms`
        : (err as Error).message;

    return {
      success: false,
      error: message,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
