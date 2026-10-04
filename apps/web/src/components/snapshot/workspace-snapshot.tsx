import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  LayerCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nocoo/basalt";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nocoo/basalt/components/accordion";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nocoo/basalt/components/table";
import type { CaptureRoot, WorkspaceResource } from "@otter/core";
import { Download, FolderGit2, Link2, Terminal, X } from "lucide-react";
import { useState } from "react";
import { coverageLabel, fileBytes, materializedFiles, recoveryArchive } from "@/lib/recovery";
import { formatSize } from "@/lib/utils";
import { CollectorsTab } from "./collectors-tab";
import type { SnapshotData } from "./types";

function downloadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  type = "application/octet-stream",
) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RecoveryDownload({
  data,
  resource,
}: {
  data: SnapshotData;
  resource?: WorkspaceResource;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            downloadBytes(
              await recoveryArchive(data, resource),
              `${resource?.name ?? `otter-${data.id.slice(0, 8)}`}.zip`,
              "application/zip",
            );
          } catch (error) {
            setError(error instanceof Error ? error.message : "Export failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        {busy ? "Verifying files…" : resource ? "Download package" : "Download recovery ZIP"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-basalt-destructive mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
const relationshipNames: Record<string, string> = {
  source: "Source",
  independent: "Local independent",
  symlink: "Shared link",
  configurationReference: "Configuration reference",
  managedCopy: "Managed copy · equal",
  sourceChanged: "Source changed",
  localChanged: "Local copy changed",
  bothChanged: "Both changed",
  fork: "Fork",
  equalContent: "Independent · same content",
  unknownLineage: "Origin unconfirmed",
  broken: "Unreadable entry",
};

function ResourceContent({
  data,
  resource,
  close,
}: {
  data: SnapshotData;
  resource: WorkspaceResource;
  close: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const files = materializedFiles(data).filter(
    (f) =>
      f.rootId === resource.rootId &&
      (resource.relativePath === "." ||
        f.relativePath === resource.relativePath ||
        f.relativePath?.startsWith(`${resource.relativePath}/`)),
  );
  const file =
    files.find((f) => f.path === selected) ??
    files.find((f) => f.path.endsWith("SKILL.md")) ??
    files.find((f) => f.sha256);
  const issues =
    data.workspace?.coverage.issues.filter(
      (issue) =>
        issue.rootId === resource.rootId &&
        (issue.path === resource.path || issue.path.startsWith(`${resource.path}/`)),
    ) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        size="xl"
        className="flex max-h-[90vh] flex-col gap-4 overflow-auto p-4 text-sm sm:p-5"
      >
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3"
            aria-label="Close resource viewer"
          >
            <X strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </DialogClose>
        <DialogHeader className="space-y-1 pr-8">
          <DialogTitle className="break-words text-base leading-6">{resource.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5">
            <span className="min-w-0 break-all">{resource.path}</span>
            <span>· {relationshipNames[resource.relationship] ?? resource.relationship}</span>
          </DialogDescription>
        </DialogHeader>
        <div data-testid="resource-actions" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <RecoveryDownload data={data} resource={resource} />
          <span className="text-xs text-basalt-muted-foreground">
            {resource.fileCount} saved files
          </span>
          {resource.counterpart && (
            <span className="min-w-0 break-all text-xs leading-5 text-basalt-muted-foreground">
              Source: {resource.counterpart}
            </span>
          )}
        </div>
        {issues.length > 0 && (
          <LayerCard role="region" className="text-sm" aria-label="Resource coverage">
            <LayerCard.Header>Resource coverage</LayerCard.Header>
            <LayerCard.Body className="space-y-2">
              {issues.map((issue) => (
                <p key={`${issue.path}:${issue.status}`}>
                  <strong>{issue.status}</strong> · {issue.reason}
                  <code className="block text-xs text-basalt-muted-foreground break-all">
                    {issue.path}
                  </code>
                </p>
              ))}
            </LayerCard.Body>
          </LayerCard>
        )}
        <div className="grid min-w-0 items-start gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <LayerCard
            role="region"
            className="overflow-auto max-h-[52vh]"
            aria-label="Package files"
          >
            <LayerCard.Header className="text-sm font-medium">Package files</LayerCard.Header>
            <LayerCard.Body className="space-y-1 p-2">
              {files
                .filter((f) => f.kind !== "directory")
                .map((f) => (
                  <Button
                    size="sm"
                    variant={file?.path === f.path ? "secondary" : "ghost"}
                    aria-pressed={file?.path === f.path}
                    key={f.path}
                    onClick={() => setSelected(f.path)}
                    className="h-auto min-h-11 w-full justify-start whitespace-normal break-all px-3 py-2 text-left font-mono text-xs leading-5 sm:min-h-9"
                  >
                    {f.relativePath ?? f.path}
                  </Button>
                ))}
            </LayerCard.Body>
          </LayerCard>
          <LayerCard role="region" aria-label="Resource preview" className="min-w-0">
            {file ? (
              <>
                <LayerCard.Header className="flex-wrap items-center gap-2 py-2">
                  <span className="text-xs text-basalt-muted-foreground">
                    {formatSize(file.sizeBytes)} · mode {file.mode?.toString(8) ?? "unknown"}
                    {file.redacted && " · credentials redacted"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadBytes(fileBytes(file), file.path.split("/").at(-1) ?? "file")
                    }
                  >
                    Download file
                  </Button>
                </LayerCard.Header>
                <LayerCard.Well className="space-y-3 p-3">
                  {file.links?.length ? (
                    <Accordion type="single" collapsible>
                      <AccordionItem value="links">
                        <AccordionTrigger>Link chain at capture time</AccordionTrigger>
                        <AccordionContent>
                          <pre className="overflow-auto p-2">
                            {file.links.map((l) => `${l.path} → ${l.target}`).join("\n")}
                          </pre>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : null}
                  {file.encoding === "base64" ? (
                    <p className="text-sm">Binary asset preserved. Download to view it.</p>
                  ) : (
                    <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                      {file.content.slice(0, 512000)}
                      {file.content.length > 512000 &&
                        "\n…Preview truncated. Download the complete file."}
                    </pre>
                  )}
                </LayerCard.Well>
              </>
            ) : (
              <LayerCard.Empty
                title="No readable file content."
                description="Inspect the coverage report."
              />
            )}
          </LayerCard>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceGitState({ root }: { root: CaptureRoot }) {
  const git = root.git;
  if (!git?.repository)
    return (
      <p className="text-sm text-basalt-muted-foreground">{git?.error ?? "Folder without Git"}</p>
    );
  return (
    <div className="space-y-2 text-sm">
      <p>
        {git.detached ? "Detached HEAD" : git.unborn ? "No initial commit" : git.branch} ·{" "}
        {git.commit?.slice(0, 10)}
      </p>
      <p className="text-basalt-muted-foreground">
        {git.staged} staged · {git.unstaged} unstaged · {git.untracked} untracked · {git.conflicts}{" "}
        conflicts
      </p>
      <p>
        {git.upstream
          ? `${git.upstream} · ${git.ahead} ahead / ${git.behind} behind`
          : "No upstream configured"}
      </p>
      <p className="text-xs text-basalt-muted-foreground">
        {git.remoteCheckedAt
          ? `Remote checked ${git.remoteCheckedAt}`
          : "Remote not checked; tracking refs may be stale"}
      </p>
      {(git.fetchError || git.error) && (
        <p className="text-basalt-destructive">{git.fetchError || git.error}</p>
      )}
    </div>
  );
}

export function WorkspaceSnapshot({ data }: { data: SnapshotData }) {
  const [tab, setTab] = useState("sources"),
    [search, setSearch] = useState(""),
    [rootId, setRootId] = useState(""),
    [agentId, setAgentId] = useState("");
  const [resource, setResource] = useState<WorkspaceResource | null>(null);
  const w = data.workspace;
  if (!w) return null;
  const resources = w.resources.filter(
    (r) =>
      (!rootId || r.rootId === rootId || r.sourceId === rootId) &&
      (!agentId || r.agentIds.includes(agentId)) &&
      `${r.name} ${r.path} ${r.kind}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <LayerCard>
        <LayerCard.Header className="flex-wrap items-center">
          <h2 className="text-sm font-medium text-basalt-foreground">
            {coverageLabel(w.coverage.complete)}
          </h2>
          <RecoveryDownload data={data} />
        </LayerCard.Header>
        <LayerCard.Body>
          <p className="text-sm text-basalt-muted-foreground">
            {w.coverage.files} files · {formatSize(w.coverage.bytes)} · {w.coverage.issues.length}{" "}
            coverage notes
          </p>
          <p className="mt-1 text-xs leading-5 text-basalt-muted-foreground">
            Observed {w.observedAt}. Git and link states describe this capture.
          </p>
        </LayerCard.Body>
      </LayerCard>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="agents">Agents & profiles</TabsTrigger>
          <TabsTrigger value="resources">Files & resources</TabsTrigger>
          <TabsTrigger value="environment">Software & environment</TabsTrigger>
          <TabsTrigger value="coverage">Coverage report</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <SectionRule title="Sources">
            <div className="grid gap-4 lg:grid-cols-2">
              {w.roots
                .filter((r) => r.role === "source")
                .map((root) => (
                  <article key={root.id}>
                    <LayerCard>
                      <LayerCard.Header>
                        <h2 className="flex items-center gap-2 text-sm font-medium text-basalt-foreground">
                          <FolderGit2 size={18} />
                          {root.label}
                        </h2>
                      </LayerCard.Header>
                      <LayerCard.Body className="space-y-3">
                        <p className="text-xs text-basalt-muted-foreground break-all">
                          {root.path}
                        </p>
                        <p className="text-sm">
                          {root.status === "complete"
                            ? "Captured within policy"
                            : "Partial coverage"}{" "}
                          · {w.resources.filter((r) => r.sourceId === root.id).length} resources
                        </p>
                        <LayerCard.Well className="rounded-basalt-lg p-3">
                          <SourceGitState root={root} />
                        </LayerCard.Well>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRootId(root.id);
                            setAgentId("");
                            setTab("resources");
                          }}
                        >
                          Browse source and consumers
                        </Button>
                      </LayerCard.Body>
                    </LayerCard>
                  </article>
                ))}
              {!w.roots.some((r) => r.role === "source") && (
                <p className="p-5 text-sm text-basalt-muted-foreground">
                  No registered sources. Independent Agent configurations remain included below.
                </p>
              )}
            </div>
          </SectionRule>
        </TabsContent>
        <TabsContent value="agents">
          <SectionRule title="Agents & profiles">
            <div className="grid gap-4 lg:grid-cols-3">
              {w.agents.map((agent) => (
                <article key={agent.id}>
                  <LayerCard>
                    <LayerCard.Header>
                      <h2 className="flex items-center gap-2 text-sm font-medium text-basalt-foreground">
                        <Terminal size={18} />
                        {agent.kind} <span className="text-basalt-primary">{agent.profile}</span>
                      </h2>
                    </LayerCard.Header>
                    <LayerCard.Body className="space-y-3">
                      <p className="text-xs text-basalt-muted-foreground break-all">
                        {agent.configPath}
                      </p>
                      <p className="text-sm">{agent.version ?? "Version not recorded"}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {["instruction", "skill", "command", "rule", "hook", "configuration"].map(
                          (kind) => (
                            <Badge key={kind} variant="secondary">
                              {
                                w.resources.filter(
                                  (r) => r.agentIds.includes(agent.id) && r.kind === kind,
                                ).length
                              }{" "}
                              {kind}
                            </Badge>
                          ),
                        )}
                      </div>
                      <p className="text-xs text-basalt-muted-foreground">
                        Disk entries observed; existing session loading is unverified.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAgentId(agent.id);
                          setRootId("");
                          setTab("resources");
                        }}
                      >
                        Browse profile
                      </Button>
                    </LayerCard.Body>
                  </LayerCard>
                </article>
              ))}
            </div>
          </SectionRule>
        </TabsContent>
        <TabsContent value="resources">
          <SectionRule title="Files & resources">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Input
                  placeholder="Search paths, instructions, skills, rules…"
                  aria-label="Search resources"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-lg"
                />
                {(rootId || agentId) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRootId("");
                      setAgentId("");
                    }}
                  >
                    Clear scope filter
                  </Button>
                )}
                <span className="text-sm text-basalt-muted-foreground self-center">
                  {resources.length} resources
                </span>
              </div>
              <LayerCard padding="none">
                <Table aria-label="Configuration resources">
                  <TableHeader>
                    <TableRow>
                      {["Resource", "Kind", "Profiles", "Relationship", "Saved files"].map((t) => (
                        <TableHead key={t}>{t}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resources.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-left"
                            onClick={() => setResource(r)}
                          >
                            {r.name}
                          </Button>
                          <p
                            className="text-xs text-basalt-muted-foreground mt-1 max-w-md truncate"
                            title={r.path}
                          >
                            {r.path}
                          </p>
                        </TableCell>
                        <TableCell>{r.kind}</TableCell>
                        <TableCell className="text-xs">
                          {r.discovery?.length
                            ? r.discovery.map((d) => (
                                <p key={d.agentId} title={d.reason}>
                                  {d.agentId}
                                  {d.state === "disabled"
                                    ? " · disabled"
                                    : d.state === "unsupported"
                                      ? " · legacy / unverified"
                                      : d.state === "project-only"
                                        ? " · project"
                                        : ""}
                                </p>
                              ))
                            : r.agentIds.join(", ") || "Source only"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Link2 size={12} />
                            {relationshipNames[r.relationship] ?? r.relationship}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{r.fileCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </LayerCard>
            </div>
          </SectionRule>
        </TabsContent>
        <TabsContent value="environment">
          <CollectorsTab collectors={data.collectors} category="environment" />
        </TabsContent>
        <TabsContent value="coverage">
          <SectionRule title="Coverage report">
            <div className="space-y-4">
              <p className="text-sm text-basalt-muted-foreground">
                Policy {w.coverage.policy.version}: {formatSize(w.coverage.policy.maxFileBytes)} per
                file, {formatSize(w.coverage.policy.maxTotalBytes)} of unique source and Agent
                content, {w.coverage.policy.maxEntries.toLocaleString()} entries. Redactions,
                exclusions and failures are separate outcomes.
              </p>
              {!w.coverage.issues.length && <p>No omissions were reported within this policy.</p>}
              <ul className="space-y-2">
                {w.coverage.issues.map((issue) => (
                  <li
                    key={`${issue.rootId}:${issue.path}:${issue.status}:${issue.reason}`}
                    className="text-sm"
                  >
                    <LayerCard>
                      <LayerCard.Header>
                        <span className="font-medium">{issue.status}</span>
                      </LayerCard.Header>
                      <LayerCard.Body>
                        <p className="mt-1">{issue.reason}</p>
                        <code className="block text-xs mt-1 text-basalt-muted-foreground break-all">
                          {issue.path}
                        </code>
                      </LayerCard.Body>
                    </LayerCard>
                  </li>
                ))}
              </ul>
            </div>
          </SectionRule>
        </TabsContent>
      </Tabs>
      {resource && (
        <ResourceContent
          key={resource.id}
          data={data}
          resource={resource}
          close={() => setResource(null)}
        />
      )}
    </div>
  );
}
