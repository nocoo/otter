// Minimal subset of the Cloudflare Workers R2Bucket type we depend on.
// Re-declared here to avoid pulling @cloudflare/workers-types into
// @otter/api's runtime types (the legacy HTTP-D1 path doesn't need them).

export interface R2ObjectBodyLike {
  text(): Promise<string>;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<unknown>;
  delete(key: string): Promise<void>;
}
