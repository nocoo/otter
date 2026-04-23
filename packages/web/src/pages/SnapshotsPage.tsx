import { Link } from "react-router";
import { useApi } from "@/api";

interface SnapshotSummary {
  id: string;
  hostname: string | null;
  platform: string | null;
  snapshotAt: number;
  sizeBytes: number;
}

interface SnapshotsResponse {
  snapshots: SnapshotSummary[];
  total: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SnapshotsPage() {
  const { data, error, isLoading } = useApi<SnapshotsResponse>("/api/snapshots");

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-4">Snapshots</h1>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-500">Failed to load snapshots</p>}
      {data && (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-2">Host</th>
              <th>Platform</th>
              <th>Captured</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.snapshots.map((s) => (
              <tr key={s.id} className="border-t border-black/5 dark:border-white/10">
                <td className="py-2">{s.hostname ?? "—"}</td>
                <td>{s.platform ?? "—"}</td>
                <td>{new Date(s.snapshotAt).toLocaleString()}</td>
                <td>{formatSize(s.sizeBytes)}</td>
                <td>
                  <Link to={`/snapshots/${s.id}`} className="text-blue-500 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
