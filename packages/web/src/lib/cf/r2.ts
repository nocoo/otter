import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";

// --- Environment validation ---

const r2EnvSchema = z.object({
  CF_R2_ENDPOINT: z.string().url(),
  CF_R2_ACCESS_KEY_ID: z.string().min(1),
  CF_R2_SECRET_ACCESS_KEY: z.string().min(1),
  CF_R2_BUCKET: z.string().min(1),
});

let _client: S3Client | null = null;
let _bucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
  if (_client && _bucket) return { client: _client, bucket: _bucket };

  const result = r2EnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Missing Cloudflare R2 env vars: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }

  _client = new S3Client({
    region: "auto",
    endpoint: result.data.CF_R2_ENDPOINT,
    credentials: {
      accessKeyId: result.data.CF_R2_ACCESS_KEY_ID,
      secretAccessKey: result.data.CF_R2_SECRET_ACCESS_KEY,
    },
  });
  _bucket = result.data.CF_R2_BUCKET;

  return { client: _client, bucket: _bucket };
}

// --- Public API ---

/** Store a JSON snapshot in R2 */
export async function putSnapshot(
  key: string,
  data: unknown,
): Promise<void> {
  const { client, bucket } = getClient();
  const body = JSON.stringify(data);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );
}

/** Retrieve a JSON snapshot from R2 */
export async function getSnapshot<T = unknown>(
  key: string,
): Promise<T | null> {
  const { client, bucket } = getClient();

  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!result.Body) return null;
    const text = await result.Body.transformToString("utf-8");
    return JSON.parse(text) as T;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "name" in error &&
      error.name === "NoSuchKey"
    ) {
      return null;
    }
    throw error;
  }
}

/** Delete a snapshot from R2 */
export async function deleteSnapshot(key: string): Promise<void> {
  const { client, bucket } = getClient();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

/** Check if a snapshot exists in R2 */
export async function snapshotExists(key: string): Promise<boolean> {
  const { client, bucket } = getClient();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NotFound") {
      return false;
    }
    throw error;
  }
}

/** Generate the R2 object key for a snapshot */
export function snapshotKey(userId: string, snapshotId: string): string {
  return `${userId}/${snapshotId}.json`;
}

// --- Icon storage ---

/** Default R2 key prefix for app icons */
const ICON_PREFIX = "apps/otter";

/** Generate the R2 object key for an app icon */
export function iconKey(hash: string): string {
  return `${ICON_PREFIX}/${hash}.png`;
}

/** Store a PNG icon in R2 with immutable caching */
export async function putIcon(
  hash: string,
  data: Buffer,
): Promise<void> {
  const { client, bucket } = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: iconKey(hash),
      Body: data,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/** Check if an icon already exists in R2 */
export async function iconExists(hash: string): Promise<boolean> {
  const { client, bucket } = getClient();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: iconKey(hash),
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NotFound") {
      return false;
    }
    throw error;
  }
}
