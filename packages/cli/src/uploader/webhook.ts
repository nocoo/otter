import type { Snapshot, UploaderConfig, UploadResult } from "@otter/core";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Upload a snapshot to the configured webhook URL via HTTP POST.
 */
export async function uploadSnapshot(
  snapshot: Snapshot,
  config: UploaderConfig
): Promise<UploadResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = performance.now();

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - start);

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
        durationMs,
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
