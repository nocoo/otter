// Shared icon storage helpers used by both /api/icons (Bearer) and legacy
// /ingest/:token/icons (webhook token) routes.

import type { R2BucketLike } from "./r2";

export const DEFAULT_ICON_PREFIX = "apps/otter";

/**
 * Generate the R2 object key for an app icon.
 * Format: {prefix}/{hash}.png
 */
export function iconKey(hash: string, prefix: string): string {
  return `${prefix}/${hash}.png`;
}

/**
 * Store a PNG icon in R2 with immutable caching.
 */
export async function putIcon(bucket: R2BucketLike, key: string, data: Uint8Array): Promise<void> {
  await bucket.put(key, data, {
    httpMetadata: {
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}
