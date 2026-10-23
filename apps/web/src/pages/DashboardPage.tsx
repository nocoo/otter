import { Badge, Button, DescriptionList, Input, LayerCard } from "@nocoo/basalt";
import { CodeBlock } from "@nocoo/basalt/components/code";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { Archive, ArrowRight, Laptop, ShieldCheck, Terminal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "@/api";
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
    <div className="space-y-basalt-layout-lg">
      <PageHeader
        title="Your machines"
        description="Find the configuration you need, even when the original machine is unavailable."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/snapshots">
              All snapshots <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      <LayerCard className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-basalt-primary" strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Historical records, with recovery coverage</p>
          <p className="mt-1 text-xs text-basalt-muted-foreground">
            Each card shows the latest captured state. Live Git and link checks are available in the
            Mac App.
          </p>
        </div>
        <Badge variant="secondary">{data?.devices.length ?? 0} machines</Badge>
      </LayerCard>
      <SectionRule
        title="Machines"
        actions={
          <Input
            aria-label="Search machines"
            placeholder="Search machines…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="sm"
            className="w-full max-w-72"
          />
        }
      >
        {isLoading ? (
          <LayerCard.Loading label="Loading machines…" />
        ) : error ? (
          <LayerCard role="alert">
            <LayerCard.Empty
              title="Unable to load machines."
              action={
                <Button variant="outline" onClick={() => void mutate()}>
                  Retry
                </Button>
              }
            />
          </LayerCard>
        ) : devices.length === 0 ? (
          <LayerCard>
            <LayerCard.Empty
              icon={<Archive strokeWidth={1.5} />}
              title="No matching machines yet"
              description="Create a snapshot with Otter on your Mac, or use the CLI below."
            />
          </LayerCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => (
              <article key={device.deviceKey}>
                <LayerCard>
                  <LayerCard.Header>
                    <div className="flex items-center gap-3">
                      <Laptop
                        className="h-5 w-5 text-basalt-primary"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold">{device.hostname}</h2>
                        <p className="mt-1 text-xs text-basalt-muted-foreground">
                          {device.platform} · {device.arch}
                          {!device.deviceId && " · Legacy identity"}
                        </p>
                      </div>
                    </div>
                  </LayerCard.Header>
                  <LayerCard.Body className="space-y-3">
                    <Badge variant={device.complete ? "success" : "warning"}>
                      {coverageLabel(device.complete)}
                    </Badge>
                    <div className="space-y-1 text-xs text-basalt-muted-foreground">
                      <p>Captured {formatTimeAgo(device.snapshotAt)}</p>
                      <p>Received {formatDateTime(device.uploadedAt)}</p>
                    </div>
                    <DescriptionList columns={3} className="grid-cols-3 gap-x-3">
                      <DescriptionList.Item term="Sources">
                        {device.summary?.sourceCount ?? "–"}
                      </DescriptionList.Item>
                      <DescriptionList.Item term="Agent profiles">
                        {device.summary?.agentCount ?? "–"}
                      </DescriptionList.Item>
                      <DescriptionList.Item term="Files">{device.fileCount}</DescriptionList.Item>
                    </DescriptionList>
                  </LayerCard.Body>
                  <LayerCard.Footer className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/devices/${encodeURIComponent(device.deviceKey ?? "")}`}>
                        Browse machine →
                      </Link>
                    </Button>
                    {device.latestCompleteId && (
                      <Button asChild variant="link" size="sm">
                        <Link to={`/snapshots/${device.latestCompleteId}`}>
                          Latest complete snapshot
                        </Link>
                      </Button>
                    )}
                  </LayerCard.Footer>
                </LayerCard>
              </article>
            ))}
          </div>
        )}
      </SectionRule>
      <SectionRule
        title={
          <span className="flex items-center gap-2">
            <Terminal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Connect a machine
          </span>
        }
      >
        <LayerCard>
          <LayerCard.Body>
            <p className="text-sm text-basalt-muted-foreground">
              Register your shared folders, then save and upload a complete configuration snapshot.
            </p>
          </LayerCard.Body>
          <LayerCard.Well>
            <CodeBlock>
              {"otter source add /absolute/path/to/workflow\notter login\notter backup"}
            </CodeBlock>
          </LayerCard.Well>
          <LayerCard.Footer>
            <p className="text-xs text-basalt-muted-foreground">
              Snapshots are saved locally before upload. The original machine can also export files
              without a network connection.
            </p>
          </LayerCard.Footer>
        </LayerCard>
      </SectionRule>
    </div>
  );
}
