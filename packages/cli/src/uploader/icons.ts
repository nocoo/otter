import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

/** Configuration for icon uploads to R2 */
export interface IconUploadConfig {
  r2Endpoint: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  /** Public domain for the R2 bucket (e.g. "https://s.zhe.to") */
  r2PublicDomain: string;
  /** R2 key prefix (default: "apps/otter") */
  prefix?: string;
}

/** Result of uploading a single icon */
export interface IconUploadResult {
  appName: string;
  key: string;
  publicUrl: string;
  /** Whether the file was actually uploaded (false = already existed) */
  uploaded: boolean;
}

/**
 * Generate a deterministic hash from an app name.
 * Returns the first 12 hex chars of SHA-256(appName).
 */
export function hashAppName(appName: string): string {
  return createHash("sha256").update(appName).digest("hex").slice(0, 12);
}

let _client: S3Client | null = null;

function getClient(config: IconUploadConfig): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
  return _client;
}

/** Reset the cached S3 client (for testing). */
export function resetIconUploadClient(): void {
  _client = null;
}

/**
 * Check if an object already exists in R2.
 */
async function objectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload a single icon PNG to R2.
 * Key format: {prefix}/{hash}.png
 * Skips upload if the object already exists (same app name = same key).
 */
export async function uploadIcon(
  pngPath: string,
  appName: string,
  config: IconUploadConfig,
): Promise<IconUploadResult> {
  const prefix = config.prefix ?? "apps/otter";
  const hash = hashAppName(appName);
  const key = `${prefix}/${hash}.png`;
  const publicUrl = `${config.r2PublicDomain}/${key}`;

  const client = getClient(config);

  // Skip if already uploaded (same app name = same hash = same key)
  const exists = await objectExists(client, config.r2Bucket, key);
  if (exists) {
    return { appName, key, publicUrl, uploaded: false };
  }

  const body = await readFile(pngPath);

  await client.send(
    new PutObjectCommand({
      Bucket: config.r2Bucket,
      Key: key,
      Body: body,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return { appName, key, publicUrl, uploaded: true };
}

/**
 * Upload multiple icon PNGs to R2 in sequence.
 * Returns results for all successful exports.
 */
export async function uploadIcons(
  icons: Array<{ appName: string; pngPath: string }>,
  config: IconUploadConfig,
  onProgress?: (result: IconUploadResult) => void,
): Promise<IconUploadResult[]> {
  const results: IconUploadResult[] = [];

  for (const { appName, pngPath } of icons) {
    const result = await uploadIcon(pngPath, appName, config);
    results.push(result);
    onProgress?.(result);
  }

  return results;
}
