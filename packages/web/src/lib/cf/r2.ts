import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";

// --- Environment validation ---

const snapshotR2EnvSchema = z.object({
  CF_R2_ENDPOINT: z.string().url(),
  CF_R2_ACCESS_KEY_ID: z.string().min(1),
  CF_R2_SECRET_ACCESS_KEY: z.string().min(1),
  CF_R2_BUCKET: z.string().min(1),
});

const iconR2EnvSchema = z.object({
  CF_ICON_R2_ENDPOINT: z.string().url().optional(),
  CF_ICON_R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  CF_ICON_R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  CF_ICON_R2_BUCKET: z.string().min(1).optional(),
  CF_ICON_R2_PREFIX: z.string().min(1).optional(),
});

interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

interface IconStorageConfig extends R2Config {
  prefix: string;
}

let _snapshotClient: S3Client | null = null;
let _snapshotBucket: string | null = null;
let _iconClient: S3Client | null = null;
let _iconBucket: string | null = null;
let _iconPrefix: string | null = null;

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

function parseSnapshotConfig(): R2Config {
  const result = snapshotR2EnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Missing Cloudflare R2 env vars: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }

  return {
    endpoint: result.data.CF_R2_ENDPOINT,
    accessKeyId: result.data.CF_R2_ACCESS_KEY_ID,
    secretAccessKey: result.data.CF_R2_SECRET_ACCESS_KEY,
    bucket: result.data.CF_R2_BUCKET,
  };
}

function parseIconConfig(): IconStorageConfig {
  const snapshot = parseSnapshotConfig();
  const result = iconR2EnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid icon R2 env vars: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }

  return {
    endpoint: result.data.CF_ICON_R2_ENDPOINT ?? snapshot.endpoint,
    accessKeyId: result.data.CF_ICON_R2_ACCESS_KEY_ID ?? snapshot.accessKeyId,
    secretAccessKey:
      result.data.CF_ICON_R2_SECRET_ACCESS_KEY ?? snapshot.secretAccessKey,
    bucket: result.data.CF_ICON_R2_BUCKET ?? snapshot.bucket,
    prefix: normalizePrefix(result.data.CF_ICON_R2_PREFIX ?? ICON_PREFIX),
  };
}

function createClient(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function getSnapshotClient(): { client: S3Client; bucket: string } {
  if (_snapshotClient && _snapshotBucket) {
    return { client: _snapshotClient, bucket: _snapshotBucket };
  }

  const config = parseSnapshotConfig();
  _snapshotClient = createClient(config);
  _snapshotBucket = config.bucket;

  return { client: _snapshotClient, bucket: _snapshotBucket };
}

function getIconClient(): { client: S3Client; bucket: string; prefix: string } {
  if (_iconClient && _iconBucket && _iconPrefix) {
    return { client: _iconClient, bucket: _iconBucket, prefix: _iconPrefix };
  }

  const config = parseIconConfig();
  _iconClient = createClient(config);
  _iconBucket = config.bucket;
  _iconPrefix = config.prefix;

  return { client: _iconClient, bucket: _iconBucket, prefix: _iconPrefix };
}

export function __resetR2ClientsForTests(): void {
  _snapshotClient = null;
  _snapshotBucket = null;
  _iconClient = null;
  _iconBucket = null;
  _iconPrefix = null;
}

// --- Public API ---

/** Store a JSON snapshot in R2 */
export async function putSnapshot(
  key: string,
  data: unknown,
): Promise<void> {
  const { client, bucket } = getSnapshotClient();
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
  const { client, bucket } = getSnapshotClient();

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
  const { client, bucket } = getSnapshotClient();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

/** Check if a snapshot exists in R2 */
export async function snapshotExists(key: string): Promise<boolean> {
  const { client, bucket } = getSnapshotClient();

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
export function iconKey(hash: string, prefix: string = ICON_PREFIX): string {
  return `${normalizePrefix(prefix)}/${hash}.png`;
}

export function resolveIconStorageConfigForTests(env: NodeJS.ProcessEnv): {
  bucket: string;
  prefix: string;
} {
  const snapshot = snapshotR2EnvSchema.parse(env);
  const icon = iconR2EnvSchema.parse(env);

  return {
    bucket: icon.CF_ICON_R2_BUCKET ?? snapshot.CF_R2_BUCKET,
    prefix: normalizePrefix(icon.CF_ICON_R2_PREFIX ?? ICON_PREFIX),
  };
}

/** Store a PNG icon in R2 with immutable caching */
export async function putIcon(
  hash: string,
  data: Buffer,
): Promise<void> {
  const { client, bucket, prefix } = getIconClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: iconKey(hash, prefix),
      Body: data,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/** Check if an icon already exists in R2 */
export async function iconExists(hash: string): Promise<boolean> {
  const { client, bucket, prefix } = getIconClient();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: iconKey(hash, prefix),
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
