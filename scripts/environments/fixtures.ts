import { readFile } from "node:fs/promises";
import type { Snapshot } from "../../packages/core/src/index";

export const FIXTURE_VERSION = 1;
export const FIXTURE_ANCHOR = "2026-09-17T00:00:00.000Z";

export async function demoSnapshots(): Promise<Snapshot[]> {
  const original = JSON.parse(
    await readFile(new URL("../fixtures/snapshot-v2.json", import.meta.url), "utf8"),
  ) as Snapshot;
  return [
    ["studio", "Studio Mac", "2026-09-15T00:00:00.000Z", true],
    ["studio", "Studio Mac", FIXTURE_ANCHOR, false],
    ["travel", "Travel MacBook", "2026-09-16T00:00:00.000Z", true],
  ].map(([device, hostname, date, complete]) => {
    const snapshot = structuredClone(original);
    snapshot.id = `demo-${device}-${complete ? "complete" : "partial"}`;
    snapshot.machine.hostname = String(hostname);
    snapshot.createdAt = String(date);
    if (!snapshot.workspace) throw new Error("Demo requires a workspace fixture");
    snapshot.workspace.deviceId = `demo-${device}`;
    snapshot.workspace.observedAt = snapshot.createdAt;
    snapshot.workspace.coverage.complete = Boolean(complete);
    if (!complete) {
      snapshot.workspace.coverage.issues.push({
        rootId: "claude:default",
        path: "/Users/fixture/.claude/skills/offline",
        status: "error",
        reason: "Synthetic external drive unavailable during capture",
      });
    }
    return snapshot;
  });
}
