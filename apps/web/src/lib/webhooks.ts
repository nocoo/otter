export interface WebhookResponse {
  id: string;
  token: string;
  label: string;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
}

export function webhookView(row: WebhookResponse) {
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
