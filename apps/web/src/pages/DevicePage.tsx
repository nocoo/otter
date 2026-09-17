import { Link, useParams } from "react-router";
import { useApi } from "@/api";
import type { SnapshotData } from "@/components/snapshot/types";
import { WorkspaceSnapshot } from "@/components/snapshot/workspace-snapshot";
import { coverageLabel, type RecoveryMeta } from "@/lib/recovery";
import { formatDateTime } from "@/lib/utils";

export function DevicePage() {
  const { deviceId } = useParams();
  const { data, error, isLoading } = useApi<{ devices: RecoveryMeta[] }>("/api/snapshots/devices");
  const device = data?.devices.find((d) => d.deviceKey === deviceId);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-primary font-medium uppercase tracking-widest mb-2">
          Machine history
        </p>
        <h1 className="text-3xl font-semibold">{device?.hostname ?? "Machine"}</h1>
      </div>
      {isLoading ? (
        <p role="status">Loading machine…</p>
      ) : error || !device ? (
        <p role="alert">Machine record unavailable.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              <p>
                {coverageLabel(device.complete)} · captured {formatDateTime(device.snapshotAt)}
              </p>
              <p className="mt-1">
                Cloud received {formatDateTime(device.uploadedAt)} · {device.platform}/{device.arch}
              </p>
            </div>
            <div className="flex gap-4 text-sm">
              <Link
                className="text-primary"
                to={`/snapshots?device=${encodeURIComponent(deviceId ?? "")}`}
              >
                All versions →
              </Link>
              {device.latestCompleteId && (
                <Link className="text-primary" to={`/snapshots/${device.latestCompleteId}`}>
                  Latest complete →
                </Link>
              )}
            </div>
          </div>
          <LatestSnapshot device={device} />
        </>
      )}
    </div>
  );
}

function LatestSnapshot({ device }: { device: RecoveryMeta }) {
  const detail = useApi<{ data: SnapshotData }>(`/api/snapshots/${device.id}`);
  if (detail.error) return <p role="alert">Could not load the latest snapshot.</p>;
  if (!detail.data) return <p role="status">Loading configuration…</p>;
  if (detail.data.data.workspace) return <WorkspaceSnapshot data={detail.data.data} />;
  return (
    <div className="p-5 rounded-xl bg-secondary">
      <p>
        Legacy identity, grouped by historical hostname. This does not establish a stable device
        identity.
      </p>
      <Link className="block mt-3 text-primary" to={`/snapshots/${device.id}`}>
        Browse legacy snapshot →
      </Link>
    </div>
  );
}
