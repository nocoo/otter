import { Button, Checkbox, Input, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nocoo/basalt/components/table";
import { Archive, GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi } from "@/api";
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
    <div className="space-y-basalt-layout-lg">
      <PageHeader
        title="Snapshots"
        description="Capture time, coverage and cloud receipt are recorded separately."
        actions={
          <Input
            aria-label="Search snapshots"
            placeholder="Search machines or resource names…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursors([""]);
            }}
            className="w-full max-w-sm"
          />
        }
      />
      <SectionRule
        title={`${data?.total ?? 0} records${device ? " · selected machine" : ""}`}
        actions={
          selected.length === 2 ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/compare?before=${chronological[0]?.id}&after=${chronological[1]?.id}`}>
                <GitCompareArrows aria-hidden="true" />
                Compare selected
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-basalt-muted-foreground">
              Select two snapshots to compare
            </span>
          )
        }
      >
        {isLoading ? (
          <LayerCard.Loading label="Loading snapshots…" />
        ) : error ? (
          <LayerCard role="alert">
            <LayerCard.Empty
              title="Failed to load snapshots"
              action={
                <Button variant="outline" onClick={() => void mutate()}>
                  Retry
                </Button>
              }
            />
          </LayerCard>
        ) : !data?.snapshots.length ? (
          <LayerCard>
            <LayerCard.Empty
              icon={<Archive strokeWidth={1.5} />}
              title="No snapshots yet"
              description="Run otter backup to save your configuration and environment."
            />
          </LayerCard>
        ) : (
          <LayerCard padding="none">
            <Table aria-label="Snapshots list">
              <TableHeader>
                <TableRow>
                  {[
                    "Compare",
                    "Machine / snapshot",
                    "Captured",
                    "Coverage",
                    "Files / items",
                    "Size",
                    "Received",
                  ].map((title) => (
                    <TableHead key={title}>{title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.snapshots.map((snapshot) => (
                  <TableRow
                    key={snapshot.id}
                    variant={selected.some((s) => s.id === snapshot.id) ? "selected" : "default"}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Compare ${snapshot.id}`}
                        checked={selected.some((s) => s.id === snapshot.id)}
                        disabled={
                          selected.length === 2 && !selected.some((s) => s.id === snapshot.id)
                        }
                        onCheckedChange={(checked) =>
                          setSelected((previous) =>
                            checked === true
                              ? [...previous, { id: snapshot.id, capturedAt: snapshot.snapshotAt }]
                              : previous.filter((s) => s.id !== snapshot.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="link" size="sm">
                        <Link to={`/snapshots/${snapshot.id}`}>{snapshot.hostname}</Link>
                      </Button>
                      <p className="text-xs text-basalt-muted-foreground">
                        {snapshot.id.slice(0, 8)} · {snapshot.platform}/{snapshot.arch}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(snapshot.snapshotAt)}
                    </TableCell>
                    <TableCell>{coverageLabel(snapshot.complete)}</TableCell>
                    <TableCell className="tabular-nums">
                      {snapshot.fileCount} / {snapshot.listCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatSize(snapshot.sizeBytes)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-basalt-muted-foreground tabular-nums">
                      {formatDateTime(snapshot.uploadedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </LayerCard>
        )}
      </SectionRule>
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={cursors.length === 1}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          Previous
        </Button>
        <span className="text-xs text-basalt-muted-foreground tabular-nums">
          Page {cursors.length}
        </span>
        <Button
          variant="outline"
          size="sm"
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
