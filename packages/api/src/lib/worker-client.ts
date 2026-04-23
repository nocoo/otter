/**
 * Worker API Client
 *
 * Typed fetch wrapper for calling the Otter Worker API.
 * Adds X-API-Key and X-User-ID headers automatically.
 *
 * IMPORTANT: This client should ONLY be used in server-side code (API routes, Server Components).
 * Never expose WORKER_API_KEY to the browser.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getWorkerUrl(): string {
  const url = process.env.WORKER_API_URL;
  if (!url) {
    throw new Error("WORKER_API_URL environment variable is not set");
  }
  return url;
}

function getApiKey(): string {
  const key = process.env.WORKER_API_KEY;
  if (!key) {
    throw new Error("WORKER_API_KEY environment variable is not set");
  }
  return key;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

export class WorkerError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Make a request to the Worker API
 *
 * @param path - API path (e.g., "/v1/snapshots")
 * @param userId - The authenticated user's ID
 * @param options - Fetch options
 * @returns Parsed JSON response
 * @throws WorkerError if the request fails
 */
export async function workerFetch<T>(
  path: string,
  userId: string,
  options: WorkerFetchOptions = {},
): Promise<T> {
  const workerUrl = getWorkerUrl();
  const apiKey = getApiKey();

  const url = `${workerUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      "X-API-Key": apiKey,
      "X-User-ID": userId,
    },
  });

  // Handle non-2xx responses
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }

    const errorMessage =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Worker API error: ${res.status}`;

    throw new WorkerError(errorMessage, res.status, body);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Typed API methods
// ---------------------------------------------------------------------------

// Snapshot types
export interface SnapshotMeta {
  id: string;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  username: string | null;
  collectorCount: number;
  fileCount: number;
  listCount: number;
  sizeBytes: number;
  snapshotAt: number;
  uploadedAt: number;
}

export interface SnapshotsListResponse {
  snapshots: SnapshotMeta[];
  total: number;
  nextBefore: number | null;
}

export interface SnapshotDetailResponse {
  snapshot: SnapshotMeta;
  data: unknown;
}

// Webhook types
export interface Webhook {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface WebhooksListResponse {
  webhooks: Webhook[];
}

export interface WebhookResponse {
  webhook: Webhook;
}

// ---------------------------------------------------------------------------
// Snapshots API
// ---------------------------------------------------------------------------

export function listSnapshots(
  userId: string,
  options?: { limit?: number; before?: number },
): Promise<SnapshotsListResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", String(options.before));

  const query = params.toString();
  const path = query ? `/v1/snapshots?${query}` : "/v1/snapshots";

  return workerFetch<SnapshotsListResponse>(path, userId);
}

export function getSnapshot(userId: string, id: string): Promise<SnapshotDetailResponse> {
  return workerFetch<SnapshotDetailResponse>(`/v1/snapshots/${encodeURIComponent(id)}`, userId);
}

export function deleteSnapshot(userId: string, id: string): Promise<{ success: boolean }> {
  return workerFetch<{ success: boolean }>(`/v1/snapshots/${encodeURIComponent(id)}`, userId, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Webhooks API
// ---------------------------------------------------------------------------

export function listWebhooks(userId: string): Promise<WebhooksListResponse> {
  return workerFetch<WebhooksListResponse>("/v1/webhooks", userId);
}

export function createWebhook(
  userId: string,
  options?: { label?: string },
): Promise<WebhookResponse> {
  return workerFetch<WebhookResponse>("/v1/webhooks", userId, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export function getWebhook(userId: string, id: string): Promise<WebhookResponse> {
  return workerFetch<WebhookResponse>(`/v1/webhooks/${encodeURIComponent(id)}`, userId);
}

export function updateWebhook(
  userId: string,
  id: string,
  data: { label?: string; isActive?: boolean },
): Promise<WebhookResponse> {
  return workerFetch<WebhookResponse>(`/v1/webhooks/${encodeURIComponent(id)}`, userId, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWebhook(userId: string, id: string): Promise<{ success: boolean }> {
  return workerFetch<{ success: boolean }>(`/v1/webhooks/${encodeURIComponent(id)}`, userId, {
    method: "DELETE",
  });
}
