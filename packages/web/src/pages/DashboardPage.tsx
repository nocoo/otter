import { useApi } from "@/api";

interface MeResponse {
  email: string;
  sub?: string;
}

export function DashboardPage() {
  const { data, error, isLoading } = useApi<MeResponse>("/api/me");
  return (
    <section>
      <h1 className="text-2xl font-semibold mb-4">Dashboard</h1>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-500">Failed to load /api/me</p>}
      {data && (
        <p className="text-sm">
          Signed in as <strong>{data.email}</strong>
        </p>
      )}
      <p className="mt-6 text-sm text-gray-500">
        Snapshots overview, charts, and recent activity will land here in a follow-up.
      </p>
    </section>
  );
}
