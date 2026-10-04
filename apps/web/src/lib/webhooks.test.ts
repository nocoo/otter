import { expect, it } from "vitest";
import { webhookView } from "./webhooks";

it("maps real D1 webhook fields without changing token, dates or state", () => {
  const row = {
    id: "fixture",
    token: "fixture-token",
    label: "Studio",
    is_active: 1,
    created_at: 123,
    last_used_at: 456,
  };
  expect(webhookView(row)).toEqual({
    id: "fixture",
    token: "fixture-token",
    label: "Studio",
    isActive: true,
    createdAt: 123,
    lastUsedAt: 456,
  });
  expect(webhookView({ ...row, is_active: 0, last_used_at: null })).toMatchObject({
    isActive: false,
    lastUsedAt: null,
  });
});
