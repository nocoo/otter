import type { CaptureRoot, WorkspaceResource } from "@otter/core";
import { Download, FolderGit2, Link2, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <p role="alert" className="text-sm text-destructive mt-2">
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
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{resource.name}</DialogTitle>
          <DialogDescription>
            {resource.path} · {relationshipNames[resource.relationship] ?? resource.relationship}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <RecoveryDownload data={data} resource={resource} />
          <span className="text-xs text-muted-foreground">{resource.fileCount} saved files</span>
          {resource.counterpart && (
            <span className="text-xs text-muted-foreground">Source: {resource.counterpart}</span>
          )}
        </div>
        {issues.length > 0 && (
          <section
            className="rounded-lg border border-border p-3 text-sm"
            aria-label="Resource coverage"
          >
            {issues.map((issue) => (
              <p key={`${issue.path}:${issue.status}`}>
                <strong>{issue.status}</strong> · {issue.reason}
                <code className="block text-xs text-muted-foreground break-all">{issue.path}</code>
              </p>
            ))}
          </section>
        )}
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <section
            className="rounded-lg bg-secondary p-2 overflow-auto max-h-[52vh]"
            aria-label="Package files"
          >
            {files
              .filter((f) => f.kind !== "directory")
              .map((f) => (
                <button
                  type="button"
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  className={`block text-left text-xs font-mono w-full p-2 rounded break-all ${file?.path === f.path ? "bg-background text-primary" : "hover:bg-background/70"}`}
                >
                  {f.relativePath ?? f.path}
                </button>
              ))}
          </section>
          <div className="min-w-0">
            {file ? (
              <>
                <div className="flex flex-wrap gap-2 items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">
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
                </div>
                {file.links?.length ? (
                  <details className="text-xs text-muted-foreground mb-3">
                    <summary>Link chain at capture time</summary>
                    <pre className="overflow-auto p-2">
                      {file.links.map((l) => `${l.path} → ${l.target}`).join("\n")}
                    </pre>
                  </details>
                ) : null}
                {file.encoding === "base64" ? (
                  <p className="p-6 bg-secondary rounded-lg text-sm">
                    Binary asset preserved. Download to view it.
                  </p>
                ) : (
                  <pre className="whitespace-pre-wrap break-words overflow-auto max-h-[45vh] bg-secondary p-4 rounded-lg text-xs font-mono">
                    {file.content.slice(0, 512000)}
                    {file.content.length > 512000 &&
                      "\n…Preview truncated. Download the complete file."}
                  </pre>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No readable file content. Inspect the coverage report.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceGitState({ root }: { root: CaptureRoot }) {
  const git = root.git;
  if (!git?.repository)
    return <p className="text-sm text-muted-foreground">{git?.error ?? "Folder without Git"}</p>;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {git.detached ? "Detached HEAD" : git.unborn ? "No initial commit" : git.branch} ·{" "}
        {git.commit?.slice(0, 10)}
      </p>
      <p className="text-muted-foreground">
        {git.staged} staged · {git.unstaged} unstaged · {git.untracked} untracked · {git.conflicts}{" "}
        conflicts
      </p>
      <p>
        {git.upstream
          ? `${git.upstream} · ${git.ahead} ahead / ${git.behind} behind`
          : "No upstream configured"}
      </p>
      <p className="text-xs text-muted-foreground">
        {git.remoteCheckedAt
          ? `Remote checked ${git.remoteCheckedAt}`
          : "Remote not checked; tracking refs may be stale"}
      </p>
      {(git.fetchError || git.error) && (
        <p className="text-destructive">{git.fetchError || git.error}</p>
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
      <div className="rounded-xl border border-border bg-secondary p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-medium">{coverageLabel(w.coverage.complete)}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {w.coverage.files} files · {formatSize(w.coverage.bytes)} · {w.coverage.issues.length}{" "}
            coverage notes
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Observed {w.observedAt}. Git and link states describe this capture.
          </p>
        </div>
        <RecoveryDownload data={data} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="agents">Agents & profiles</TabsTrigger>
          <TabsTrigger value="resources">Files & resources</TabsTrigger>
          <TabsTrigger value="environment">Software & environment</TabsTrigger>
          <TabsTrigger value="coverage">Coverage report</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <div className="grid gap-4 lg:grid-cols-2">
            {w.roots
              .filter((r) => r.role === "source")
              .map((root) => (
                <article key={root.id} className="p-5 rounded-xl bg-secondary space-y-3">
                  <h2 className="font-medium flex items-center gap-2">
                    <FolderGit2 size={18} />
                    {root.label}
                  </h2>
                  <p className="text-xs text-muted-foreground break-all">{root.path}</p>
                  <p className="text-sm">
                    {root.status === "complete" ? "Captured within policy" : "Partial coverage"} ·{" "}
                    {w.resources.filter((r) => r.sourceId === root.id).length} resources
                  </p>
                  <SourceGitState root={root} />
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
                </article>
              ))}
            {!w.roots.some((r) => r.role === "source") && (
              <p className="p-5 text-sm text-muted-foreground">
                No registered sources. Independent Agent configurations remain included below.
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="agents">
          <div className="grid gap-4 lg:grid-cols-3">
            {w.agents.map((agent) => (
              <article key={agent.id} className="rounded-xl bg-secondary p-5 space-y-3">
                <h2 className="flex items-center gap-2 font-medium">
                  <Terminal size={18} />
                  {agent.kind} <span className="text-primary">{agent.profile}</span>
                </h2>
                <p className="text-xs text-muted-foreground break-all">{agent.configPath}</p>
                <p className="text-sm">{agent.version ?? "Version not recorded"}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {["instruction", "skill", "command", "rule", "hook", "configuration"].map(
                    (kind) => (
                      <span key={kind} className="rounded bg-background px-2 py-1">
                        {
                          w.resources.filter(
                            (r) => r.agentIds.includes(agent.id) && r.kind === kind,
                          ).length
                        }{" "}
                        {kind}
                      </span>
                    ),
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
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
              </article>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="resources">
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
              <span className="text-sm text-muted-foreground self-center">
                {resources.length} resources
              </span>
            </div>
            <div className="rounded-xl bg-secondary overflow-auto">
              <table className="w-full text-sm" aria-label="Configuration resources">
                <thead>
                  <tr className="text-left border-b border-border">
                    {["Resource", "Kind", "Profiles", "Relationship", "Saved files"].map((t) => (
                      <th className="p-3 font-medium text-muted-foreground text-xs" key={t}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resources.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="p-3">
                        <button
                          type="button"
                          className="text-primary font-medium text-left hover:underline"
                          onClick={() => setResource(r)}
                        >
                          {r.name}
                        </button>
                        <p
                          className="text-xs text-muted-foreground mt-1 max-w-md truncate"
                          title={r.path}
                        >
                          {r.path}
                        </p>
                      </td>
                      <td className="p-3">{r.kind}</td>
                      <td className="p-3 text-xs">
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
                      </td>
                      <td className="p-3 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Link2 size={12} />
                          {relationshipNames[r.relationship] ?? r.relationship}
                        </span>
                      </td>
                      <td className="p-3">{r.fileCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="environment">
          <CollectorsTab collectors={data.collectors} category="environment" />
        </TabsContent>
        <TabsContent value="coverage">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
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
                  className="rounded-lg bg-secondary p-3 text-sm"
                >
                  <span className="font-medium">{issue.status}</span>
                  <p className="mt-1">{issue.reason}</p>
                  <code className="block text-xs mt-1 text-muted-foreground break-all">
                    {issue.path}
                  </code>
                </li>
              ))}
            </ul>
          </div>
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
