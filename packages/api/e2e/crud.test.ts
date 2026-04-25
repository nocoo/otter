/**
 * L2 CRUD — webhooks lifecycle + ingest round-trip + snapshots listing.
 *
 * Runs as `dev@localhost` (accessAuth localhost auto-stamp). Each test
 * creates its own webhook with a unique label, so concurrent runs against
 * the shared otter-db-test do not collide. afterAll removes any rows we
 * created so the test DB stays close to empty between runs.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseUrl = (() => {
  const u = process.env.OTTER_L2_BASE_URL;
  if (!u) throw new Error("OTTER_L2_BASE_URL not set — globalSetup didn't run");
  return u;
})();

const RUN_TAG = `l2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Webhook {
  id: string;
  user_id: string;
  token: string;
  label: string;
  is_active: number;
  created_at: number;
}

const createdWebhookIds: string[] = [];
const createdSnapshotIds: string[] = [];

async function postWebhook(label: string): Promise<Webhook> {
  const res = await fetch(`${baseUrl}/api/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { webhook: Webhook };
  createdWebhookIds.push(body.webhook.id);
  return body.webhook;
}

async function deleteWebhook(id: string): Promise<void> {
  await fetch(`${baseUrl}/api/webhooks/${id}`, { method: "DELETE" });
}

async function deleteSnapshot(id: string): Promise<void> {
  await fetch(`${baseUrl}/api/snapshots/${id}`, { method: "DELETE" });
}

afterAll(async () => {
  for (const id of createdSnapshotIds) {
    // biome-ignore lint/performance/noAwaitInLoops: serial cleanup is fine
    await deleteSnapshot(id);
  }
  for (const id of createdWebhookIds) {
    // biome-ignore lint/performance/noAwaitInLoops: serial cleanup is fine
    await deleteWebhook(id);
  }
});

describe("L2 webhooks CRUD", () => {
  it("POST → GET → PATCH → DELETE round-trip", async () => {
    const created = await postWebhook(`${RUN_TAG}-roundtrip`);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(created.user_id).toBe("dev@localhost");

    const getRes = await fetch(`${baseUrl}/api/webhooks/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { webhook: Webhook };
    expect(got.webhook.id).toBe(created.id);
    expect(got.webhook.label).toBe(`${RUN_TAG}-roundtrip`);

    const patchRes = await fetch(`${baseUrl}/api/webhooks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: `${RUN_TAG}-renamed` }),
    });
    expect(patchRes.status).toBe(200);

    const afterPatch = await fetch(`${baseUrl}/api/webhooks/${created.id}`);
    const ap = (await afterPatch.json()) as { webhook: Webhook };
    expect(ap.webhook.label).toBe(`${RUN_TAG}-renamed`);

    const delRes = await fetch(`${baseUrl}/api/webhooks/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const afterDelete = await fetch(`${baseUrl}/api/webhooks/${created.id}`);
    expect(afterDelete.status).toBe(404);

    // Already removed — drop from cleanup list.
    const idx = createdWebhookIds.indexOf(created.id);
    if (idx >= 0) createdWebhookIds.splice(idx, 1);
  });

  it("GET /api/webhooks lists the caller's rows", async () => {
    const w = await postWebhook(`${RUN_TAG}-list`);
    const res = await fetch(`${baseUrl}/api/webhooks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { webhooks: Webhook[] };
    expect(body.webhooks.some((row) => row.id === w.id)).toBe(true);
  });
});

describe("L2 ingest + snapshots round-trip", () => {
  let webhook: Webhook;
  const snapshotId = `snap-${RUN_TAG}`;

  beforeAll(async () => {
    webhook = await postWebhook(`${RUN_TAG}-ingest`);
    createdSnapshotIds.push(snapshotId);
  });

  it("POST /ingest/:token writes a snapshot row visible via /api/snapshots", async () => {
    const snapshot = {
      version: 1 as const,
      id: snapshotId,
      createdAt: new Date().toISOString(),
      machine: {
        hostname: "l2-host",
        platform: "darwin",
        arch: "arm64",
        username: "l2",
      },
      collectors: [{ files: [{ path: "/tmp/x" }], lists: [] }],
    };

    const ingestRes = await fetch(`${baseUrl}/ingest/${webhook.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    expect(ingestRes.status).toBe(201);
    const ingestBody = (await ingestRes.json()) as { success: boolean; snapshotId: string };
    expect(ingestBody.success).toBe(true);
    expect(ingestBody.snapshotId).toBe(snapshotId);

    const listRes = await fetch(`${baseUrl}/api/snapshots`);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      snapshots: Array<{ id: string; fileCount: number; hostname: string }>;
    };
    const row = listBody.snapshots.find((s) => s.id === snapshotId);
    expect(row).toBeDefined();
    expect(row?.fileCount).toBe(1);
    expect(row?.hostname).toBe("l2-host");

    const detailRes = await fetch(`${baseUrl}/api/snapshots/${snapshotId}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      snapshot: { id: string };
      data: { id: string; machine: { hostname: string } };
    };
    expect(detail.data.id).toBe(snapshotId);
    expect(detail.data.machine.hostname).toBe("l2-host");
  });

  it("POST /ingest/:badtoken returns 401", async () => {
    const res = await fetch(`${baseUrl}/ingest/definitely-not-a-real-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("POST /ingest/:token with malformed JSON body returns 400", async () => {
    const res = await fetch(`${baseUrl}/ingest/${webhook.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});
