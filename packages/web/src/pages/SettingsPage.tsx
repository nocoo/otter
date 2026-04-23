import { useApi } from "@/api";

interface Webhook {
  id: string;
  token: string;
  label: string;
  // biome-ignore lint/style/useNamingConvention: D1 column name
  created_at: number;
}

interface WebhooksResponse {
  webhooks: Webhook[];
}

export function SettingsPage() {
  const { data, isLoading } = useApi<WebhooksResponse>("/api/webhooks");
  return (
    <section>
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
      <h2 className="text-lg font-medium mt-6 mb-2">Webhook tokens</h2>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <ul className="space-y-2 text-sm">
          {data.webhooks.map((w) => (
            <li key={w.id} className="flex justify-between border-b border-black/5 py-2">
              <span>{w.label}</span>
              <code className="text-gray-500">{w.token.slice(0, 8)}…</code>
            </li>
          ))}
          {data.webhooks.length === 0 && <p className="text-gray-500">No webhooks yet.</p>}
        </ul>
      )}
    </section>
  );
}
