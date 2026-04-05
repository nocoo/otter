/**
 * Generate the R2 object key for an app icon
 * Format: {prefix}/{hash}.png
 */
export function iconKey(hash: string, prefix: string): string {
  return `${prefix}/${hash}.png`;
}

/**
 * Store a PNG icon in R2 with immutable caching
 */
export async function putIcon(bucket: R2Bucket, key: string, data: Uint8Array): Promise<void> {
  await bucket.put(key, data, {
    httpMetadata: {
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

/**
 * Check if an icon already exists in R2
 */
export async function iconExists(bucket: R2Bucket, key: string): Promise<boolean> {
  const object = await bucket.head(key);
  return object !== null;
}
