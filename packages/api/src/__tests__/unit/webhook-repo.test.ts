import { describe, expect, it } from "vitest";
import {
  createWebhook,
  deleteWebhook,
  getWebhookByIdForUser,
  getWebhookByToken,
  getWebhookOwnership,
  listWebhooks,
  touchLastUsedAtStatement,
  updateWebhook,
} from "../../lib/webhook-repo";
import { createMockDriver } from "./_mock-driver";

describe("webhook-repo", () => {
  it("listWebhooks selects by user_id ordered by created_at DESC", async () => {
    const { driver, calls } = createMockDriver();
    await listWebhooks(driver, "u1");
    expect(calls[0]?.sql).toContain("ORDER BY created_at DESC");
    expect(calls[0]?.params).toEqual(["u1"]);
  });

  it("getWebhookByIdForUser scopes by user_id", async () => {
    const { driver, calls } = createMockDriver();
    await getWebhookByIdForUser(driver, "u1", "w1");
    expect(calls[0]?.params).toEqual(["w1", "u1"]);
  });

  it("getWebhookOwnership returns id+user_id", async () => {
    const { driver, calls } = createMockDriver({
      responses: [
        { match: "SELECT id, user_id FROM webhooks", rows: [{ id: "w1", user_id: "u1" }] },
      ],
    });
    const row = await getWebhookOwnership(driver, "w1");
    expect(row).toEqual({ id: "w1", user_id: "u1" });
    expect(calls[0]?.params).toEqual(["w1"]);
  });

  it("getWebhookByToken matches by token", async () => {
    const { driver, calls } = createMockDriver();
    await getWebhookByToken(driver, "tok-abc");
    expect(calls[0]?.params).toEqual(["tok-abc"]);
  });

  it("createWebhook inserts and returns full row", async () => {
    const { driver, calls } = createMockDriver();
    const row = await createWebhook(driver, {
      id: "w1",
      userId: "u1",
      token: "tok",
      label: "Default",
      createdAt: 1000,
    });
    expect(row.is_active).toBe(1);
    expect(row.last_used_at).toBe(null);
    expect(calls[0]?.sql).toContain("INSERT INTO users");
    expect(calls[0]?.params).toEqual(["u1"]);
    expect(calls[1]?.sql).toContain("INSERT INTO webhooks");
    expect(calls[1]?.params).toEqual(["w1", "u1", "tok", "Default", 1000]);
  });

  it("updateWebhook with label only builds single-field UPDATE", async () => {
    const { driver, calls } = createMockDriver({
      responses: [
        {
          match: "FROM webhooks WHERE id = ?1",
          rows: [
            {
              id: "w1",
              user_id: "u1",
              token: "tok",
              label: "X",
              is_active: 1,
              created_at: 0,
              last_used_at: null,
            },
          ],
        },
      ],
    });
    const row = await updateWebhook(driver, "w1", { label: "X" });
    expect(row?.label).toBe("X");
    const update = calls.find((c) => c.method === "execute");
    expect(update?.sql).toMatch(/UPDATE webhooks SET label = \?1 WHERE id = \?2/);
    expect(update?.params).toEqual(["X", "w1"]);
  });

  it("updateWebhook with both fields builds two-field UPDATE", async () => {
    const { driver, calls } = createMockDriver();
    await updateWebhook(driver, "w1", { label: "Y", isActive: false });
    const update = calls.find((c) => c.method === "execute");
    expect(update?.sql).toMatch(/UPDATE webhooks SET label = \?1, is_active = \?2 WHERE id = \?3/);
    expect(update?.params).toEqual(["Y", 0, "w1"]);
  });

  it("updateWebhook with isActive=true encodes 1", async () => {
    const { driver, calls } = createMockDriver();
    await updateWebhook(driver, "w1", { isActive: true });
    const update = calls.find((c) => c.method === "execute");
    expect(update?.params).toEqual([1, "w1"]);
  });

  it("updateWebhook with no fields returns null without executing", async () => {
    const { driver, calls } = createMockDriver();
    const row = await updateWebhook(driver, "w1", {});
    expect(row).toBe(null);
    expect(calls.find((c) => c.method === "execute")).toBeUndefined();
  });

  it("deleteWebhook runs DELETE", async () => {
    const { driver, calls } = createMockDriver();
    await deleteWebhook(driver, "w1");
    expect(calls[0]?.sql).toContain("DELETE FROM webhooks");
    expect(calls[0]?.params).toEqual(["w1"]);
  });

  it("touchLastUsedAtStatement formats UPDATE for batch", () => {
    const stmt = touchLastUsedAtStatement("w1", 1234);
    expect(stmt.sql).toContain("UPDATE webhooks SET last_used_at");
    expect(stmt.params).toEqual([1234, "w1"]);
  });
});
