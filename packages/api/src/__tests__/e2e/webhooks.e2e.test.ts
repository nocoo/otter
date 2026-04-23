/**
 * L3 API E2E: Webhooks CRUD
 *
 * Tests the full webhooks lifecycle:
 *  - List webhooks
 *  - Create a webhook
 *  - Update (toggle / rename) a webhook
 *  - Delete a webhook
 *
 * All created resources are cleaned up at the end.
 */

import { afterAll, describe, expect, it } from "bun:test";

const BASE_URL = `http://localhost:${process.env.E2E_PORT || "17019"}`;

// Track created webhook IDs for cleanup
const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: sequential test cleanup with error isolation
      await fetch(`${BASE_URL}/api/webhooks/${id}`, { method: "DELETE" });
    } catch {
      // Best-effort cleanup
    }
  }
});

describe("L3 API E2E: Webhooks CRUD", () => {
  it("GET /api/webhooks returns 200 with webhooks array", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("webhooks");
    expect(Array.isArray(data.webhooks)).toBe(true);
  });

  it("POST /api/webhooks creates a webhook", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-test-webhook" }),
    });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data).toHaveProperty("webhook");
    expect(data.webhook.label).toBe("e2e-test-webhook");
    expect(data.webhook.isActive).toBe(true);
    expect(typeof data.webhook.id).toBe("string");
    expect(typeof data.webhook.token).toBe("string");
    expect(typeof data.webhook.createdAt).toBe("number");

    createdIds.push(data.webhook.id);
  });

  it("PATCH /api/webhooks/:id toggles active state", async () => {
    // Create a webhook to patch
    const createRes = await fetch(`${BASE_URL}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-toggle-test" }),
    });
    const { webhook } = await createRes.json();
    createdIds.push(webhook.id);

    // Toggle off
    const patchRes = await fetch(`${BASE_URL}/api/webhooks/${webhook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(patchRes.status).toBe(200);

    const patchData = await patchRes.json();
    expect(patchData.webhook.isActive).toBe(false);
  });

  it("PATCH /api/webhooks/:id updates label", async () => {
    // Create a webhook to rename
    const createRes = await fetch(`${BASE_URL}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-rename-before" }),
    });
    const { webhook } = await createRes.json();
    createdIds.push(webhook.id);

    const patchRes = await fetch(`${BASE_URL}/api/webhooks/${webhook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-rename-after" }),
    });
    expect(patchRes.status).toBe(200);

    const patchData = await patchRes.json();
    expect(patchData.webhook.label).toBe("e2e-rename-after");
  });

  it("DELETE /api/webhooks/:id removes a webhook", async () => {
    // Create a webhook to delete
    const createRes = await fetch(`${BASE_URL}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "e2e-delete-test" }),
    });
    const { webhook } = await createRes.json();

    const deleteRes = await fetch(`${BASE_URL}/api/webhooks/${webhook.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    const deleteData = await deleteRes.json();
    expect(deleteData).toHaveProperty("success", true);

    // No need to track for cleanup — already deleted
  });

  it("PATCH /api/webhooks/:id returns 404 for non-existent webhook", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/00000000-0000-0000-0000-000000000000`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/webhooks/:id returns 404 for non-existent webhook", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
