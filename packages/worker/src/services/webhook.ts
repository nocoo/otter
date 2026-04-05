/**
 * Validate webhook token and return webhook row if valid
 */
export function validateWebhookToken<T>(db: D1Database, token: string): Promise<T | null> {
  return db
    .prepare(`SELECT id, user_id, token, is_active FROM webhooks WHERE token = ?1`)
    .bind(token)
    .first<T>();
}
