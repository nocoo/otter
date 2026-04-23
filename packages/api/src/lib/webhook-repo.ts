// WebhookRepo — SQL access for the `webhooks` D1 table.
import type { DbDriver } from "./db/driver";

export interface WebhookRow {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
  token: string;
  label: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  is_active: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  created_at: number;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  last_used_at: number | null;
}

const SELECT_COLS = "id, user_id, token, label, is_active, created_at, last_used_at";

export function listWebhooks(driver: DbDriver, userId: string): Promise<WebhookRow[]> {
  return driver.query<WebhookRow>(
    `SELECT ${SELECT_COLS} FROM webhooks WHERE user_id = ?1 ORDER BY created_at DESC`,
    [userId],
  );
}

export function getWebhookByIdForUser(
  driver: DbDriver,
  userId: string,
  webhookId: string,
): Promise<WebhookRow | null> {
  return driver.queryFirst<WebhookRow>(
    `SELECT ${SELECT_COLS} FROM webhooks WHERE id = ?1 AND user_id = ?2`,
    [webhookId, userId],
  );
}

export interface WebhookOwnership {
  id: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  user_id: string;
}

export function getWebhookOwnership(
  driver: DbDriver,
  webhookId: string,
): Promise<WebhookOwnership | null> {
  return driver.queryFirst<WebhookOwnership>("SELECT id, user_id FROM webhooks WHERE id = ?1", [
    webhookId,
  ]);
}

export function getWebhookByToken(driver: DbDriver, token: string): Promise<WebhookRow | null> {
  return driver.queryFirst<WebhookRow>(`SELECT ${SELECT_COLS} FROM webhooks WHERE token = ?1`, [
    token,
  ]);
}

export interface CreateWebhookInput {
  id: string;
  userId: string;
  token: string;
  label: string;
  createdAt: number;
}

export async function createWebhook(
  driver: DbDriver,
  input: CreateWebhookInput,
): Promise<WebhookRow> {
  await driver.execute(
    `INSERT INTO webhooks (id, user_id, token, label, is_active, created_at, last_used_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, NULL)`,
    [input.id, input.userId, input.token, input.label, input.createdAt],
  );
  return {
    id: input.id,
    // biome-ignore lint/style/useNamingConvention: D1 column name
    user_id: input.userId,
    token: input.token,
    label: input.label,
    // biome-ignore lint/style/useNamingConvention: D1 column name
    is_active: 1,
    // biome-ignore lint/style/useNamingConvention: D1 column name
    created_at: input.createdAt,
    // biome-ignore lint/style/useNamingConvention: D1 column name
    last_used_at: null,
  };
}

export interface UpdateWebhookInput {
  label?: string;
  isActive?: boolean;
}

export async function updateWebhook(
  driver: DbDriver,
  webhookId: string,
  input: UpdateWebhookInput,
): Promise<WebhookRow | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (typeof input.label === "string") {
    updates.push(`label = ?${idx++}`);
    values.push(input.label);
  }
  if (typeof input.isActive === "boolean") {
    updates.push(`is_active = ?${idx++}`);
    values.push(input.isActive ? 1 : 0);
  }
  if (updates.length === 0) return null;

  values.push(webhookId);
  await driver.execute(`UPDATE webhooks SET ${updates.join(", ")} WHERE id = ?${idx}`, values);

  return driver.queryFirst<WebhookRow>(`SELECT ${SELECT_COLS} FROM webhooks WHERE id = ?1`, [
    webhookId,
  ]);
}

export async function deleteWebhook(driver: DbDriver, webhookId: string): Promise<void> {
  await driver.execute("DELETE FROM webhooks WHERE id = ?1", [webhookId]);
}

export function touchLastUsedAtStatement(
  webhookId: string,
  now: number,
): { sql: string; params: unknown[] } {
  return {
    sql: "UPDATE webhooks SET last_used_at = ?1 WHERE id = ?2",
    params: [now, webhookId],
  };
}
