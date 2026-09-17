import { Archive, GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { coverageLabel, type RecoveryMeta } from "@/lib/recovery";
import { formatDateTime, formatSize } from "@/lib/utils";

export function SnapshotsPage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [selected, setSelected] = useState<{ id: string; capturedAt: number }[]>([]);
  const chronological = [...selected].sort(
    (a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id),
  );
  const device = params.get("device") ?? "";
  const query = new URLSearchParams({
    limit: "20",
    ...(device ? { device } : {}),
    ...(search ? { search } : {}),
    ...(cursors.at(-1) ? { cursor: cursors.at(-1) as string } : {}),
  });
  const { data, error, isLoading, mutate } = useApi<{
    snapshots: RecoveryMeta[];
    total: number;
    nextCursor: string | null;
  }>(`/api/snapshots?${query}`);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Snapshots</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Capture time, coverage and cloud receipt are recorded separately.
          </p>
        </div>
        <Input
          aria-label="Search snapshots"
          placeholder="Search machines or resource names…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCursors([""]);
          }}
          className="max-w-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {data?.total ?? 0} records{device && " · selected machine"}
        </span>
        {selected.length === 2 ? (
          <Link
            className="inline-flex items-center gap-2 text-sm text-primary"
            to={`/compare?before=${chronological[0]?.id}&after=${chronological[1]?.id}`}
          >
            <GitCompareArrows size={16} />
            Compare selected
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Select two snapshots to compare</span>
        )}
      </div>
      {isLoading ? (
        <p role="status">Loading snapshots…</p>
      ) : error ? (
        <div role="alert">
          <p>Failed to load snapshots</p>
          <Button variant="outline" onClick={() => void mutate()}>
            Retry
          </Button>
        </div>
      ) : !data?.snapshots.length ? (
        <div className="p-12 text-center rounded-xl bg-secondary">
          <Archive className="mx-auto mb-3" />
          <p>No snapshots yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Run otter backup to save your configuration and environment.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
          <table className="w-full text-sm" aria-label="Snapshots list">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                {[
                  "Compare",
                  "Machine / snapshot",
                  "Captured",
                  "Coverage",
                  "Files / items",
                  "Size",
                  "Received",
                ].map((h) => (
                  <th className="p-3 font-medium" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.snapshots.map((snapshot) => (
                <tr className="border-b border-border/50 last:border-0" key={snapshot.id}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Compare ${snapshot.id}`}
                      checked={selected.some((s) => s.id === snapshot.id)}
                      disabled={
                        selected.length === 2 && !selected.some((s) => s.id === snapshot.id)
                      }
                      onChange={(e) =>
                        setSelected((previous) =>
                          e.target.checked
                            ? [...previous, { id: snapshot.id, capturedAt: snapshot.snapshotAt }]
                            : previous.filter((s) => s.id !== snapshot.id),
                        )
                      }
                    />
                  </td>
                  <td className="p-3">
                    <Link to={`/snapshots/${snapshot.id}`} className="font-medium text-primary">
                      {snapshot.hostname}
                    </Link>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {snapshot.id.slice(0, 8)} · {snapshot.platform}/{snapshot.arch}
                    </div>
                  </td>
                  <td className="p-3 whitespace-nowrap">{formatDateTime(snapshot.snapshotAt)}</td>
                  <td className="p-3">{coverageLabel(snapshot.complete)}</td>
                  <td className="p-3 tabular-nums">
                    {snapshot.fileCount} / {snapshot.listCount}
                  </td>
                  <td className="p-3 whitespace-nowrap">{formatSize(snapshot.sizeBytes)}</td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(snapshot.uploadedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={cursors.length === 1}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {cursors.length}</span>
        <Button
          variant="outline"
          disabled={!data?.nextCursor}
          onClick={() => {
            if (data?.nextCursor) setCursors([...cursors, data.nextCursor]);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
