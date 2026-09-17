import { Archive, ArrowRight, Laptop, ShieldCheck, Terminal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { coverageLabel, type RecoveryMeta } from "@/lib/recovery";
import { formatDateTime, formatTimeAgo } from "@/lib/utils";

export function DashboardPage() {
  const { data, error, isLoading, mutate } = useApi<{ devices: RecoveryMeta[] }>(
    "/api/snapshots/devices",
  );
  const [search, setSearch] = useState("");
  const devices = (data?.devices ?? []).filter((d) =>
    `${d.hostname} ${d.platform}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-primary">
            Configuration recovery
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Your machines</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Find the configuration you need, even when the original machine is unavailable.
          </p>
        </div>
        <Link to="/snapshots" className="inline-flex items-center gap-2 text-sm text-primary">
          All snapshots <ArrowRight size={16} />
        </Link>
      </div>
      <div className="rounded-xl bg-primary/5 border border-primary/15 p-5 flex flex-wrap items-center gap-4">
        <ShieldCheck className="text-primary" size={28} />
        <div className="flex-1 min-w-52">
          <p className="font-medium">Historical records, with recovery coverage</p>
          <p className="text-sm text-muted-foreground mt-1">
            Each card shows the latest captured state. Live Git and link checks are available in the
            Mac App.
          </p>
        </div>
        <span className="rounded-full bg-background px-3 py-1 text-sm">
          {data?.devices.length ?? 0} machines
        </span>
      </div>
      <Input
        aria-label="Search machines"
        placeholder="Search machines…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      {isLoading ? (
        <p role="status">Loading machines…</p>
      ) : error ? (
        <div role="alert">
          <p>Unable to load machines.</p>
          <Button variant="outline" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <article key={device.deviceKey} className="rounded-xl bg-secondary p-5 space-y-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg p-2 bg-background">
                  <Laptop className="text-primary" size={24} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold truncate">{device.hostname}</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {device.platform} · {device.arch}
                    {!device.deviceId && " · Legacy identity"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">{coverageLabel(device.complete)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Captured {formatTimeAgo(device.snapshotAt)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Received {formatDateTime(device.uploadedAt)}
                </p>
              </div>
              <div className="flex gap-5 text-sm">
                <span>{device.summary?.sourceCount ?? "–"} sources</span>
                <span>{device.summary?.agentCount ?? "–"} agent profiles</span>
                <span>{device.fileCount} files</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
                <Link
                  to={`/devices/${encodeURIComponent(device.deviceKey ?? "")}`}
                  className="text-sm text-primary font-medium"
                >
                  Browse machine →
                </Link>
                {device.latestCompleteId && (
                  <Link
                    to={`/snapshots/${device.latestCompleteId}`}
                    className="text-xs text-muted-foreground underline"
                  >
                    Latest complete snapshot
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!isLoading && !error && devices.length === 0 && (
        <div className="rounded-xl bg-secondary text-center p-10">
          <Archive className="mx-auto mb-3 text-muted-foreground" />
          <p>No matching machines yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Create a snapshot with Otter on your Mac, or use the CLI below.
          </p>
        </div>
      )}
      <div className="rounded-xl border border-border p-5">
        <h2 className="flex items-center gap-2 font-medium">
          <Terminal size={18} /> Connect a machine
        </h2>
        <p className="text-sm text-muted-foreground my-3">
          Register your shared folders, then save and upload a complete configuration snapshot.
        </p>
        <pre className="text-sm overflow-auto rounded-lg bg-secondary p-4">
          {"otter source add /absolute/path/to/workflow\notter login\notter backup"}
        </pre>
        <p className="text-xs text-muted-foreground mt-3">
          Snapshots are saved locally before upload. The original machine can also export files
          without a network connection.
        </p>
      </div>
    </div>
  );
}
