import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
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
      <PageHeader
        title={device?.hostname ?? "Machine"}
        description="Machine history and captured configuration."
        actions={
          device && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to={`/snapshots?device=${encodeURIComponent(deviceId ?? "")}`}>
                  All versions →
                </Link>
              </Button>
              {device.latestCompleteId && (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/snapshots/${device.latestCompleteId}`}>Latest complete →</Link>
                </Button>
              )}
            </>
          )
        }
      />
      {isLoading ? (
        <LayerCard.Loading label="Loading machine…" />
      ) : error || !device ? (
        <LayerCard role="alert">
          <LayerCard.Empty title="Machine record unavailable." />
        </LayerCard>
      ) : (
        <>
          <LayerCard className="flex flex-wrap items-center gap-3">
            <Badge variant={device.complete ? "success" : "warning"}>
              {coverageLabel(device.complete)}
            </Badge>
            <div className="text-xs text-basalt-muted-foreground">
              <p>Captured {formatDateTime(device.snapshotAt)}</p>
              <p className="mt-1">
                Cloud received {formatDateTime(device.uploadedAt)} · {device.platform}/{device.arch}
              </p>
            </div>
          </LayerCard>
          <LatestSnapshot device={device} />
        </>
      )}
    </div>
  );
}
function LatestSnapshot({ device }: { device: RecoveryMeta }) {
  const detail = useApi<{ data: SnapshotData }>(`/api/snapshots/${device.id}`);
  if (detail.error)
    return (
      <LayerCard role="alert">
        <LayerCard.Empty title="Could not load the latest snapshot." />
      </LayerCard>
    );
  if (!detail.data) return <LayerCard.Loading label="Loading configuration…" />;
  if (detail.data.data.workspace) return <WorkspaceSnapshot data={detail.data.data} />;
  return (
    <LayerCard>
      <LayerCard.Body>
        <p className="text-sm text-basalt-muted-foreground">
          Legacy identity, grouped by historical hostname. This does not establish a stable device
          identity.
        </p>
      </LayerCard.Body>
      <LayerCard.Footer>
        <Button asChild variant="outline" size="sm">
          <Link to={`/snapshots/${device.id}`}>Browse legacy snapshot →</Link>
        </Button>
      </LayerCard.Footer>
    </LayerCard>
  );
}
