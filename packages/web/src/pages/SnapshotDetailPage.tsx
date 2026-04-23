import { Link, useParams } from "react-router";
import { useApi } from "@/api";

interface SnapshotDetailResponse {
  snapshot: {
    id: string;
    hostname: string | null;
    platform: string | null;
    snapshotAt: number;
    sizeBytes: number;
    collectorCount: number;
    fileCount: number;
  };
  data: unknown;
}

export function SnapshotDetailPage() {
  const { id } = useParams();
  const { data, error, isLoading } = useApi<SnapshotDetailResponse>(
    id ? `/api/snapshots/${id}` : null,
  );

  return (
    <section>
      <Link to="/snapshots" className="text-sm text-blue-500 hover:underline">
        ← Snapshots
      </Link>
      <h1 className="text-2xl font-semibold mt-2 mb-4">Snapshot {id}</h1>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-500">Failed to load snapshot</p>}
      {data && (
        <dl className="grid grid-cols-2 gap-2 text-sm max-w-md">
          <dt className="text-gray-500">Host</dt>
          <dd>{data.snapshot.hostname ?? "—"}</dd>
          <dt className="text-gray-500">Platform</dt>
          <dd>{data.snapshot.platform ?? "—"}</dd>
          <dt className="text-gray-500">Collectors</dt>
          <dd>{data.snapshot.collectorCount}</dd>
          <dt className="text-gray-500">Files</dt>
          <dd>{data.snapshot.fileCount}</dd>
        </dl>
      )}
      <p className="mt-6 text-sm text-gray-500">
        Collectors / files / lists tabs land in a follow-up.
      </p>
    </section>
  );
}
