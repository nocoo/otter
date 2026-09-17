import { homedir } from "node:os";
import { join } from "node:path";
import type { Collector, CollectorResult, Snapshot } from "@otter/core";
import { redactCapturedText } from "../utils/redact.js";
import { discoverWorkspace } from "../workspace/discovery.js";
import { digest, FileCapture } from "../workspace/files.js";
import { observeGit } from "../workspace/git.js";
import { deviceIdentity, readRegistry } from "../workspace/registry.js";
import { resourceInventory } from "../workspace/resources.js";

export class AgentWorkspaceCollector implements Collector {
  readonly id = "agent-workspace";
  readonly label = "Agent configurations and sources";
  readonly category = "config";
  constructor(
    private readonly home: string,
    private readonly configDirectory = join(home, ".config/otter"),
  ) {}
  async collect(): Promise<CollectorResult> {
    const started = performance.now();
    const savedRegistry = await readRegistry(this.configDirectory);
    const registry = {
      version: savedRegistry.version,
      sources: savedRegistry.sources,
      projects: savedRegistry.projects,
      bindings: savedRegistry.bindings,
    };
    const deviceId = await deviceIdentity(this.configDirectory);
    const discovered = await discoverWorkspace(this.home, registry, this.home === homedir());
    const capture = new FileCapture();
    capture.issues.push(...discovered.issues);
    for (const plan of discovered.plans) {
      // biome-ignore lint/performance/noAwaitInLoops: one global capture budget, deterministic priority of registered sources
      await capture.capture(plan);
      if (plan.root.role === "source")
        plan.root.git = await observeGit(plan.root.path, this.configDirectory, plan.root.id);
    }
    const resources = resourceInventory(
      discovered.plans,
      capture.files,
      registry,
      capture.originalHashes,
    );
    for (const resource of resources) {
      if (
        resource.kind === "skill" &&
        !capture.files.some((f) => f.path === join(resource.path, "SKILL.md"))
      )
        capture.issues.push({
          rootId: resource.rootId,
          path: resource.path,
          status: "invalid",
          reason: "Skill has no SKILL.md; eligible package files are still saved",
        });
      if (capture.issues.some((i) => i.path === resource.path && i.status === "error"))
        resource.relationship = "broken";
    }
    const workspace: NonNullable<Snapshot["workspace"]> = {
      schemaVersion: 2,
      deviceId,
      observedAt: new Date().toISOString(),
      registry,
      roots: discovered.plans.map((p) => p.root),
      agents: discovered.agents,
      resources,
      scopeFingerprint: digest(
        JSON.stringify([
          registry,
          discovered.plans.map((p) => [p.root.id, p.root.path, p.include, p.consumers]),
          capture.policy,
        ]),
      ),
      contentFingerprint: "",
      configurationFingerprint: "",
      coverage: {
        complete: !capture.issues.some((i) => ["error", "limit", "unstable"].includes(i.status)),
        files: capture.files.filter((f) => !!f.sha256).length,
        bytes: capture.bytes,
        issues: capture.issues,
        policy: capture.policy,
      },
    };
    return {
      id: this.id,
      label: this.label,
      category: this.category,
      workspace,
      files: capture.files,
      lists: [],
      errors: capture.issues
        .filter((i) => ["error", "limit", "unstable"].includes(i.status))
        .map((i) => `${i.path}: ${i.reason}`),
      skipped: [],
      durationMs: Math.round(performance.now() - started),
    };
  }
}

/** Promotes collector inventory, then fingerprints saved content (never timestamps/UUIDs/durations). */
export function finalizeSnapshot(snapshot: Snapshot): Snapshot {
  const inventory = snapshot.collectors.find((c) => c.workspace);
  if (!inventory && snapshot.collectors.some((c) => c.id === "agent-workspace"))
    throw new Error(
      "Agent workspace capture failed; check the registry and scan diagnostics before backing up",
    );
  if (!inventory?.workspace) return snapshot;
  snapshot.version = 2;
  snapshot.workspace = inventory.workspace;
  // biome-ignore lint/performance/noDelete: omit the internal handoff from the serialized collector
  delete inventory.workspace;
  const workspace = snapshot.workspace;
  workspace.configurationFingerprint = digest(
    JSON.stringify([
      workspace.scopeFingerprint,
      inventory.files.map((f) => [
        f.rootId,
        f.relativePath,
        f.sha256,
        f.kind,
        f.mode,
        f.linkTarget,
        f.links,
      ]),
    ]),
  );
  for (const collector of snapshot.collectors.filter((c) => c.id !== "agent-workspace")) {
    for (const file of collector.files) {
      const content = redactCapturedText(file.content, file.path);
      if (content !== file.content) {
        file.content = content;
        file.sizeBytes = Buffer.byteLength(content);
        file.redacted = true;
        workspace.coverage.issues.push({
          rootId: collector.id,
          path: file.path,
          status: "redacted",
          reason: "Credential values removed from environment configuration",
        });
      }
    }
    for (const error of collector.errors)
      workspace.coverage.issues.push({
        rootId: collector.id,
        path: collector.id,
        status: "error",
        reason: error,
      });
    if (collector.lists.length)
      workspace.coverage.issues.push({
        rootId: collector.id,
        path: collector.id,
        status: "list-only",
        reason: `${collector.lists.length} inventory items; reinstall using this list`,
      });
  }
  workspace.coverage.complete &&= snapshot.collectors.every((c) => c.errors.length === 0);
  workspace.contentFingerprint = digest(
    JSON.stringify([
      workspace.scopeFingerprint,
      snapshot.collectors
        .map((c) => ({
          id: c.id,
          files: c.files
            .map((f) => [
              f.rootId ?? c.id,
              f.relativePath ?? f.path.replace(snapshot.machine.homeDir, "~"),
              f.sha256 ?? digest(f.content),
              f.mode,
              f.linkTarget,
              f.links?.map((l) => [l.path, l.target]),
            ])
            .sort(),
          lists: c.lists
            .map((l) => [l.name, l.version, Object.entries(l.meta ?? {}).sort()])
            .sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
  return snapshot;
}
