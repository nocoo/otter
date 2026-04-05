/**
 * Generate the R2 object key for a snapshot
 * Format: {userId}/{snapshotId}.json
 */
export function snapshotKey(userId: string, snapshotId: string): string {
  return `${userId}/${snapshotId}.json`;
}

/**
 * Store a JSON snapshot in R2
 */
export async function putSnapshot(
  bucket: R2Bucket,
  key: string,
  jsonString: string,
): Promise<void> {
  await bucket.put(key, jsonString, {
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/**
 * Retrieve a JSON snapshot from R2
 */
export async function getSnapshot<T = unknown>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;

  const text = await object.text();
  return JSON.parse(text) as T;
}

/**
 * Delete a snapshot from R2
 */
export async function deleteSnapshot(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}
